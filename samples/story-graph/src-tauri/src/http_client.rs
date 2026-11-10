use std::{sync::Arc, time::Duration};

// reqwest 0.13 defaults to platform roots and a different crypto provider.
// Keep the WebPKI/ring trust policy used by our former rustls-tls feature.
fn tls_with_roots(roots: rustls::RootCertStore) -> Result<rustls::ClientConfig, ()> {
    Ok(rustls::ClientConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .map_err(|_| ())?
    .with_root_certificates(roots)
    .with_no_client_auth())
}

fn tls() -> Result<rustls::ClientConfig, ()> {
    tls_with_roots(rustls::RootCertStore {
        roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
    })
}

fn async_with_tls(tls: rustls::ClientConfig) -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .use_preconfigured_tls(tls)
        .connect_timeout(Duration::from_secs(15))
        .read_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(180))
        .redirect(reqwest::redirect::Policy::none())
}

fn blocking_with_tls(tls: rustls::ClientConfig) -> reqwest::blocking::ClientBuilder {
    reqwest::blocking::Client::builder()
        .use_preconfigured_tls(tls)
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
}

pub fn asynchronous() -> Result<reqwest::ClientBuilder, ()> {
    Ok(async_with_tls(tls()?))
}

pub fn blocking() -> Result<reqwest::blocking::ClientBuilder, ()> {
    Ok(blocking_with_tls(tls()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        thread,
    };

    const ROOT: &[u8] = include_bytes!("../test/fixtures/http-tls/ca.der");
    const CERT: &[u8] = include_bytes!("../test/fixtures/http-tls/server.der");
    const KEY: &[u8] = include_bytes!("../test/fixtures/http-tls/server-key.der");

    fn trusted_tls() -> rustls::ClientConfig {
        let mut roots = rustls::RootCertStore::empty();
        roots
            .add(rustls::pki_types::CertificateDer::from(ROOT.to_vec()))
            .unwrap();
        tls_with_roots(roots).unwrap()
    }

    fn server(response: &'static [u8]) -> (u16, thread::JoinHandle<Result<String, String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        let config = rustls::ServerConfig::builder_with_provider(Arc::new(
            rustls::crypto::ring::default_provider(),
        ))
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(
            vec![rustls::pki_types::CertificateDer::from(CERT.to_vec())],
            rustls::pki_types::PrivatePkcs8KeyDer::from(KEY.to_vec()).into(),
        )
        .unwrap();
        let join = thread::spawn(move || {
            let deadline = std::time::Instant::now() + Duration::from_secs(10);
            let socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        if std::time::Instant::now() >= deadline {
                            return Err("test server accept timeout".into());
                        }
                        thread::sleep(Duration::from_millis(10));
                    }
                    Err(error) => return Err(error.to_string()),
                }
            };
            socket.set_nonblocking(false).map_err(|e| e.to_string())?;
            socket
                .set_read_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            socket
                .set_write_timeout(Some(Duration::from_secs(10)))
                .unwrap();
            let mut stream = rustls::StreamOwned::new(
                rustls::ServerConnection::new(Arc::new(config)).unwrap(),
                socket,
            );
            let mut request = Vec::new();
            let mut buf = [0; 2048];
            loop {
                let count = stream.read(&mut buf).map_err(|e| e.to_string())?;
                if count == 0 {
                    return Err("client closed before HTTP request".into());
                }
                request.extend_from_slice(&buf[..count]);
                if request.len() > 65536 {
                    return Err("test request too large".into());
                }
                if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                    let head = String::from_utf8_lossy(&request[..end]).to_lowercase();
                    let length = head
                        .lines()
                        .find_map(|line| {
                            line.strip_prefix("content-length:")
                                .and_then(|v| v.trim().parse::<usize>().ok())
                        })
                        .unwrap_or(0);
                    if request.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            stream.write_all(response).map_err(|e| e.to_string())?;
            stream.flush().map_err(|e| e.to_string())?;
            Ok(String::from_utf8(request).unwrap())
        });
        (port, join)
    }

    const OK: &[u8] = b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok";

    #[test]
    fn production_blocking_roots_reject_an_untrusted_ca() {
        let (port, server) = server(OK);
        let error = blocking()
            .unwrap()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("https://localhost:{port}/"))
            .send()
            .unwrap_err();
        assert!(error.is_connect());
        assert!(server.join().unwrap().is_err());
    }

    #[tokio::test]
    async fn production_async_roots_reject_an_untrusted_ca() {
        let (port, server) = server(OK);
        let error = asynchronous()
            .unwrap()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("https://localhost:{port}/"))
            .send()
            .await
            .unwrap_err();
        assert!(error.is_connect());
        assert!(server.join().unwrap().is_err());
    }

    #[test]
    fn trusted_ca_still_requires_the_correct_hostname() {
        let (port, server) = server(OK);
        let error = blocking_with_tls(trusted_tls())
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("https://127.0.0.1:{port}/"))
            .send()
            .unwrap_err();
        assert!(error.is_connect());
        assert!(server.join().unwrap().is_err());
    }

    #[test]
    fn blocking_oauth_forms_are_encoded_and_redirects_are_not_followed() {
        let (port, server) = server(b"HTTP/1.1 302 Found\r\nLocation: https://localhost:1/not-followed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let response = blocking_with_tls(trusted_tls())
            .no_proxy()
            .build()
            .unwrap()
            .post(format!("https://localhost:{port}/token"))
            .form(&[
                ("grant_type", "refresh_token"),
                ("refresh_token", "test + /&"),
            ])
            .send()
            .unwrap();
        assert_eq!(response.status(), 302);
        let request = server.join().unwrap().unwrap();
        assert!(request.contains("grant_type=refresh_token&refresh_token=test+%2B+%2F%26"));
        assert!(
            request
                .to_lowercase()
                .contains("content-type: application/x-www-form-urlencoded")
        );
    }

    #[tokio::test]
    async fn async_json_and_chunk_reads_survive_the_tls_migration() {
        let (port, server) = server(OK);
        let mut response = async_with_tls(trusted_tls())
            .no_proxy()
            .build()
            .unwrap()
            .post(format!("https://localhost:{port}/response"))
            .json(&serde_json::json!({"text": "雨😀 简体中文"}))
            .send()
            .await
            .unwrap();
        let mut body = Vec::new();
        while let Some(chunk) = response.chunk().await.unwrap() {
            body.extend_from_slice(&chunk);
        }
        assert_eq!(body, b"ok");
        let request = server.join().unwrap().unwrap();
        assert!(request.contains("雨😀 简体中文"));
        assert!(
            request
                .to_lowercase()
                .contains("content-type: application/json")
        );
    }

    #[tokio::test]
    async fn async_redirects_are_not_followed() {
        let (port, server) = server(b"HTTP/1.1 302 Found\r\nLocation: https://localhost:1/not-followed\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let response = async_with_tls(trusted_tls())
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("https://localhost:{port}/response"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 302);
        assert!(server.join().unwrap().is_ok());
    }
}
