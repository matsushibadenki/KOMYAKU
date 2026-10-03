//! Public-client SIWC. Secrets never cross Tauri IPC or enter a story document.
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use reqwest::{Url, blocking::Client};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
    signature,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    net::TcpListener,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};
const ISSUER: &str = "https://auth.openai.com";
const RESOURCE: &str = "https://api.openai.com/v1";
const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
type Result<T> = std::result::Result<T, String>;
fn failure() -> String {
    "auth_failed".into()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}
fn random() -> Result<String> {
    let mut bytes = [0; 32];
    SystemRandom::new()
        .fill(&mut bytes)
        .map_err(|_| failure())?;
    Ok(B64.encode(bytes))
}
fn client() -> Result<Client> {
    Client::builder()
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| failure())
}
#[derive(Default, Serialize, Deserialize)]
struct Database {
    host: String,
    accounts: Vec<Account>,
}
#[derive(Serialize, Deserialize)]
struct Account {
    client_id: String,
    sub: String,
    email: String,
    session: Option<Session>,
}
#[derive(Serialize, Deserialize)]
struct Session {
    access_token: String,
    refresh_token: Option<String>,
    id_token: String,
    expires_at: u64,
    scopes: Vec<String>,
    #[serde(default)]
    earliest_refresh_at: Option<u64>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pending: bool,
    accounts: Vec<Profile>,
    error: Option<String>,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Profile {
    id: String,
    email: String,
    connected: bool,
    plan_enabled: bool,
    expires_at: Option<u64>,
}
struct Runtime {
    pending: Option<Arc<AtomicBool>>,
    error: Option<String>,
}
#[derive(Clone)]
pub struct Store {
    available: bool,
    directory: PathBuf,
    runtime: Arc<Mutex<Runtime>>,
}
// The file lock also protects separate processes opened with File > New.
impl Store {
    pub fn unavailable(directory: PathBuf) -> Self {
        Self {
            available: false,
            directory,
            runtime: Arc::new(Mutex::new(Runtime {
                pending: None,
                error: Some("auth_storage_failed".into()),
            })),
        }
    }
    pub fn load(directory: PathBuf) -> Result<Self> {
        #[cfg(not(unix))]
        {
            let _ = directory;
            return Err("auth_storage_unsupported".into());
        }
        #[cfg(unix)]
        {
            fs::create_dir_all(&directory).map_err(|_| failure())?;
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
                .map_err(|_| failure())?;
            let store = Self {
                available: true,
                directory,
                runtime: Arc::new(Mutex::new(Runtime {
                    pending: None,
                    error: None,
                })),
            };
            store.database(|db| {
                if db.host.is_empty() {
                    db.host = format!("urn:uuid:{}", unge_core::Id::new_v4());
                }
                Ok(())
            })?;
            Ok(store)
        }
    }
    fn database<T>(&self, action: impl FnOnce(&mut Database) -> Result<T>) -> Result<T> {
        if !self.available {
            return Err("auth_storage_failed".into());
        }
        let lock = private_file(self.directory.join("lock"), false)?;
        lock.lock().map_err(|_| failure())?;
        let path = self.directory.join("session.json");
        let mut db: Database = if path.exists() {
            let mut file = private_file(path.clone(), false)?;
            let mut data = Vec::new();
            Read::by_ref(&mut file)
                .take(1024 * 1024)
                .read_to_end(&mut data)
                .map_err(|_| failure())?;
            serde_json::from_slice(&data).map_err(|_| failure())?
        } else {
            Database::default()
        };
        let original = serde_json::to_vec(&db).map_err(|_| failure())?;
        let result = action(&mut db)?;
        if original == serde_json::to_vec(&db).map_err(|_| failure())? && path.exists() {
            return Ok(result);
        }
        let temp = self.directory.join("session.tmp");
        let mut file = private_file(temp.clone(), true)?;
        serde_json::to_writer(&mut file, &db).map_err(|_| failure())?;
        file.sync_all().map_err(|_| failure())?;
        fs::rename(temp, path).map_err(|_| failure())?;
        File::open(&self.directory)
            .and_then(|f| f.sync_all())
            .map_err(|_| failure())?;
        Ok(result)
    }
    fn status(&self) -> Result<Status> {
        let runtime = self.runtime.lock().map_err(|_| failure())?;
        let accounts = self.database(|db| {
            Ok(db
                .accounts
                .iter()
                .map(|a| Profile {
                    id: a.client_id.clone(),
                    email: a.email.clone(),
                    connected: a.session.is_some(),
                    plan_enabled: a.session.as_ref().is_some_and(|s| {
                        s.scopes.iter().any(|v| v == "chatgpt.tokens.use.direct")
                            && s.scopes.iter().any(|v| v == "resource.invoke")
                    }),
                    expires_at: a.session.as_ref().map(|s| s.expires_at),
                })
                .collect())
        });
        let (accounts, storage_error) = match accounts {
            Ok(a) => (a, None),
            Err(_) => (Vec::new(), Some("auth_storage_failed".to_owned())),
        };
        Ok(Status {
            pending: runtime.pending.is_some(),
            accounts,
            error: storage_error.or_else(|| runtime.error.clone()),
        })
    }
    fn publish(&self, app: &tauri::AppHandle) {
        if let Ok(status) = self.status() {
            let _ = app.emit("story://chatgpt", status);
        }
    }
    /// Serializes rotating refresh tokens across app processes. Never returns a token to IPC.
    pub(crate) fn access_token(&self, account_id: &str) -> Result<String> {
        self.database(|db| {
            let account = db
                .accounts
                .iter_mut()
                .find(|a| a.client_id == account_id)
                .ok_or_else(|| "ai_sign_in_required".to_owned())?;
            let session = account
                .session
                .as_mut()
                .ok_or_else(|| "ai_sign_in_required".to_owned())?;
            if !plan_granted(&session.scopes) {
                return Ok(Err("ai_plan_required".into()));
            }
            if !refresh_due(session, now()) {
                if session.expires_at <= now() {
                    return Ok(Err("ai_refresh_wait".into()));
                }
                return Ok(Ok(session.access_token.clone()));
            }
            let Some(refresh) = session.refresh_token.as_ref() else {
                return Ok(Err("ai_sign_in_required".into()));
            };
            let http = client()?;
            let d = discovery(&http)?;
            let response = http
                .post(&d.token_endpoint)
                .form(&[
                    ("grant_type", "refresh_token"),
                    ("client_id", account_id),
                    ("refresh_token", refresh.as_str()),
                    ("resource", RESOURCE),
                ])
                .send()
                .map_err(|_| "ai_network_error".to_owned())?;
            if !response.status().is_success() {
                let body: Value = response.json().unwrap_or(Value::Null);
                if terminal_refresh_error(&body) {
                    account.session = None;
                    return Ok(Err("ai_sign_in_required".into()));
                }
                return Ok(Err("ai_network_error".into()));
            }
            let tokens: RefreshTokens = response.json().map_err(|_| failure())?;
            if !tokens.token_type.eq_ignore_ascii_case("bearer")
                || tokens.access_token.is_empty()
                || tokens.refresh_token.is_empty()
                || tokens.expires_in == 0
                || tokens.expires_in > 86400
            {
                return Ok(Err(failure()));
            }
            if let Some(id_token) = &tokens.id_token {
                let a = Attempt {
                    state: String::new(),
                    nonce: String::new(),
                    verifier: String::new(),
                    redirect: String::new(),
                    client_id: Some(account_id.into()),
                    sub: Some(account.sub.clone()),
                    prompt_consent: false,
                };
                verify_id(&http, &d, id_token, &a, account_id)?;
                session.id_token = id_token.clone();
            }
            session.access_token = tokens.access_token;
            session.refresh_token = Some(tokens.refresh_token);
            session.expires_at = now() + tokens.expires_in;
            session.earliest_refresh_at = tokens.earliest_refresh_at;
            if let Some(scope) = tokens.scope {
                session.scopes = scope.split_whitespace().map(str::to_owned).collect();
            }
            if !plan_granted(&session.scopes) {
                return Ok(Err("ai_plan_required".into()));
            }
            Ok(Ok(session.access_token.clone()))
        })?
    }
}
fn plan_granted(scopes: &[String]) -> bool {
    ["resource.invoke", "chatgpt.tokens.use.direct"]
        .iter()
        .all(|s| scopes.iter().any(|v| v == s))
}
fn refresh_due(session: &Session, time: u64) -> bool {
    session.expires_at <= time.saturating_add(60)
        && session.earliest_refresh_at.is_none_or(|v| v <= time)
}
fn terminal_refresh_error(body: &Value) -> bool {
    let code = body["error"]
        .as_str()
        .or_else(|| body["error"]["code"].as_str());
    matches!(
        code,
        Some(
            "invalid_grant"
                | "invalid_refresh_token"
                | "token_expired"
                | "refresh_token_expired"
                | "refresh_token_invalidated"
                | "refresh_token_reused"
        )
    )
}
#[derive(Deserialize)]
struct RefreshTokens {
    access_token: String,
    refresh_token: String,
    id_token: Option<String>,
    token_type: String,
    expires_in: u64,
    scope: Option<String>,
    earliest_refresh_at: Option<u64>,
}
fn private_file(path: PathBuf, truncate: bool) -> Result<File> {
    if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        return Err(failure());
    }
    let mut options = OpenOptions::new();
    options
        .read(true)
        .write(true)
        .create(true)
        .truncate(truncate);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(path).map_err(|_| failure())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|_| failure())?;
    }
    Ok(file)
}
#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    revocation_endpoint: String,
    jwks_uri: String,
}
fn discovery(http: &Client) -> Result<Discovery> {
    let d: Discovery = http
        .get(format!("{ISSUER}/.well-known/openid-configuration"))
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|_| failure())?;
    if d.issuer != ISSUER
        || [
            &d.authorization_endpoint,
            &d.token_endpoint,
            &d.revocation_endpoint,
            &d.jwks_uri,
        ]
        .iter()
        .any(|v| !trusted_endpoint(v))
    {
        return Err(failure());
    }
    Ok(d)
}
fn trusted_endpoint(value: &str) -> bool {
    Url::parse(value).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str() == Some("auth.openai.com")
            && u.port_or_known_default() == Some(443)
            && u.username().is_empty()
            && u.password().is_none()
            && u.fragment().is_none()
    })
}
struct Attempt {
    state: String,
    nonce: String,
    verifier: String,
    redirect: String,
    client_id: Option<String>,
    sub: Option<String>,
    prompt_consent: bool,
}
fn authorize(endpoint: &str, host: &str, a: &Attempt) -> Result<Url> {
    let mut url = Url::parse(endpoint).map_err(|_| failure())?;
    {
        let mut q = url.query_pairs_mut();
        if a.prompt_consent {
            q.append_pair("prompt", "consent");
        }
        q.extend_pairs([
            (
                "client_id",
                a.client_id.as_deref().unwrap_or("dynamic_agent_client"),
            ),
            ("ext_agent_host_id", host),
            ("response_type", "code"),
            ("redirect_uri", &a.redirect),
            ("scope", SCOPES),
            ("resource", RESOURCE),
            ("state", &a.state),
            ("nonce", &a.nonce),
            ("code_challenge_method", "S256"),
        ]);
        q.append_pair(
            "code_challenge",
            &B64.encode(digest::digest(&digest::SHA256, a.verifier.as_bytes()).as_ref()),
        );
        if a.client_id.is_none() {
            q.append_pair("agent_name_hint", "KOMYAKU Story Graph");
        }
    }
    Ok(url)
}
fn callback(target: &str, a: &Attempt) -> Result<(String, String)> {
    let url = Url::parse(&format!("http://127.0.0.1{target}")).map_err(|_| failure())?;
    if url.path() != "/auth/callback" || url.fragment().is_some() {
        return Err(failure());
    }
    let mut params = std::collections::HashMap::new();
    for (k, v) in url.query_pairs() {
        if params.insert(k.into_owned(), v.into_owned()).is_some() {
            return Err(failure());
        }
    }
    if params.get("iss").is_some_and(|v| v != ISSUER) {
        return Err(failure());
    }
    if params.get("state") != Some(&a.state) {
        return Err(failure());
    }
    if params.contains_key("error") {
        return Err("auth_denied".into());
    }
    let code = params
        .get("code")
        .filter(|v| !v.is_empty())
        .ok_or_else(failure)?
        .clone();
    let issued = params
        .get("client_id")
        .filter(|v| v.starts_with("oaiapp_") && v.len() < 256);
    let id = match &a.client_id {
        Some(saved) if !params.contains_key("client_id") || issued == Some(saved) => saved.clone(),
        Some(_) => return Err(failure()),
        None => issued.ok_or_else(failure)?.clone(),
    };
    Ok((code, id))
}
#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    refresh_token: Option<String>,
    id_token: String,
    token_type: String,
    expires_in: u64,
    scope: String,
    #[serde(default)]
    earliest_refresh_at: Option<u64>,
}
fn validate_claims(claims: &Value, a: &Attempt, id: &str, time: u64) -> Result<(String, String)> {
    let aud = &claims["aud"];
    let correct_aud = aud.as_str() == Some(id)
        || aud
            .as_array()
            .is_some_and(|v| v.iter().any(|x| x.as_str() == Some(id)));
    if claims["iss"].as_str() != Some(ISSUER)
        || !correct_aud
        || (!a.nonce.is_empty() && claims["nonce"].as_str() != Some(&a.nonce))
        || !claims["exp"].as_u64().is_some_and(|v| v > time)
        || claims["iat"].as_u64().is_none_or(|v| v > time + 60)
        || claims["nbf"].as_u64().is_some_and(|v| v > time + 60)
        || (aud.as_array().is_some_and(|v| v.len() > 1) && claims["azp"].as_str() != Some(id))
    {
        return Err(failure());
    }
    let sub = claims["sub"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(failure)?;
    if claims.get("azp").is_some_and(|v| v.as_str() != Some(id)) {
        return Err(failure());
    }
    if a.sub.as_deref().is_some_and(|s| s != sub) {
        return Err(failure());
    }
    Ok((
        sub.into(),
        claims["email"].as_str().unwrap_or("ChatGPT").into(),
    ))
}
fn verify_id(
    http: &Client,
    d: &Discovery,
    token: &str,
    a: &Attempt,
    id: &str,
) -> Result<(String, String)> {
    let jwks: Value = http
        .get(&d.jwks_uri)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.json())
        .map_err(|_| failure())?;
    validate_claims(&verify_signature(token, &jwks)?, a, id, now())
}
fn verify_signature(token: &str, jwks: &Value) -> Result<Value> {
    let parts: Vec<_> = token.split('.').collect();
    if parts.len() != 3 || token.len() > 65536 {
        return Err(failure());
    }
    let header: Value = serde_json::from_slice(&B64.decode(parts[0]).map_err(|_| failure())?)
        .map_err(|_| failure())?;
    if header["alg"] != "RS256" || header.get("crit").is_some() {
        return Err(failure());
    }
    let kid = header["kid"].as_str().ok_or_else(failure)?;
    let keys = jwks["keys"].as_array().ok_or_else(failure)?;
    let matching: Vec<_> = keys
        .iter()
        .filter(|k| {
            k["kid"].as_str() == Some(kid)
                && k["kty"] == "RSA"
                && k["use"] == "sig"
                && k["alg"] == "RS256"
        })
        .collect();
    if matching.len() != 1 {
        return Err(failure());
    }
    let key = matching[0];
    let n = B64
        .decode(key["n"].as_str().ok_or_else(failure)?)
        .map_err(|_| failure())?;
    let e = B64
        .decode(key["e"].as_str().ok_or_else(failure)?)
        .map_err(|_| failure())?;
    let sig = B64.decode(parts[2]).map_err(|_| failure())?;
    signature::RsaPublicKeyComponents { n: &n, e: &e }
        .verify(
            &signature::RSA_PKCS1_2048_8192_SHA256,
            format!("{}.{}", parts[0], parts[1]).as_bytes(),
            &sig,
        )
        .map_err(|_| failure())?;
    let claims: Value = serde_json::from_slice(&B64.decode(parts[1]).map_err(|_| failure())?)
        .map_err(|_| failure())?;
    Ok(claims)
}
fn wait_callback(
    listener: TcpListener,
    a: &Attempt,
    cancel: &AtomicBool,
) -> Result<(String, String)> {
    listener.set_nonblocking(true).map_err(|_| failure())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    while Instant::now() < deadline {
        if cancel.load(Ordering::SeqCst) {
            return Err("auth_cancelled".into());
        }
        match listener.accept() {
            Ok((mut stream, peer)) => {
                if !peer.ip().is_loopback() {
                    continue;
                }
                stream
                    .set_read_timeout(Some(Duration::from_secs(1)))
                    .map_err(|_| failure())?;
                stream
                    .set_write_timeout(Some(Duration::from_secs(1)))
                    .map_err(|_| failure())?;
                let mut data = Vec::new();
                let mut byte = [0];
                let read_deadline = Instant::now() + Duration::from_secs(2);
                while data.len() < 16384
                    && Instant::now() < read_deadline
                    && Instant::now() < deadline
                    && !cancel.load(Ordering::SeqCst)
                {
                    if stream.read(&mut byte).unwrap_or(0) == 0 {
                        break;
                    }
                    data.push(byte[0]);
                    if data.ends_with(b"\r\n\r\n") {
                        break;
                    }
                }
                let request = String::from_utf8_lossy(&data);
                let mut first = request.lines().next().unwrap_or("").split_whitespace();
                let method = first.next();
                let target = first.next().unwrap_or("");
                let complete = data.ends_with(b"\r\n\r\n") && first.next() == Some("HTTP/1.1");
                let result =
                    if complete && method == Some("GET") && target.starts_with("/auth/callback?") {
                        callback(target, a)
                    } else {
                        Err(failure())
                    };
                let valid = result.is_ok();
                let denied = result.as_ref().is_err_and(|e| e == "auth_denied");
                let body = if valid {
                    "ChatGPT authorization received. Return to KOMYAKU to check the connection. / KOMYAKU に戻って接続状態を確認してください。 / 请返回 KOMYAKU 查看连接状态。"
                } else {
                    "Authorization was not accepted. Return to KOMYAKU. / 認証を確認できませんでした。 / 无法确认授权。"
                };
                let response = format!(
                    "HTTP/1.1 {}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'\r\nConnection: close\r\n\r\n{body}",
                    if valid { "200 OK" } else { "400 Bad Request" },
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                if valid || denied {
                    return result;
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(50))
            }
            Err(_) => return Err(failure()),
        }
    }
    Err("auth_timeout".into())
}
fn run(store: &Store, listener: TcpListener, a: Attempt, cancel: &AtomicBool) -> Result<()> {
    let http = client()?;
    let d = discovery(&http)?;
    let host = store.database(|db| Ok(db.host.clone()))?;
    let url = authorize(&d.authorization_endpoint, &host, &a)?;
    if cancel.load(Ordering::SeqCst) {
        return Err("auth_cancelled".into());
    }
    #[cfg(target_os = "macos")]
    let opened = std::process::Command::new("/usr/bin/open")
        .arg(url.as_str())
        .status();
    #[cfg(not(target_os = "macos"))]
    let opened = std::process::Command::new("xdg-open")
        .arg(url.as_str())
        .status();
    if !opened.is_ok_and(|s| s.success()) {
        return Err("auth_browser_failed".into());
    }
    let (code, id) = wait_callback(listener, &a, cancel)?;
    // Remember the issued registration even if an exchange fails. Never persist the bootstrap ID.
    store.database(|db| {
        if !db.accounts.iter().any(|v| v.client_id == id) {
            db.accounts.push(Account {
                client_id: id.clone(),
                sub: String::new(),
                email: "ChatGPT".into(),
                session: None,
            });
        }
        Ok(())
    })?;
    let response = http
        .post(&d.token_endpoint)
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", &id),
            ("code", &code),
            ("code_verifier", &a.verifier),
            ("redirect_uri", &a.redirect),
            ("resource", RESOURCE),
        ])
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|_| failure())?;
    let tokens: Tokens = response.json().map_err(|_| failure())?;
    if tokens.token_type.to_lowercase() != "bearer"
        || tokens.access_token.is_empty()
        || tokens.expires_in == 0
        || tokens.expires_in > 86400
    {
        return Err(failure());
    }
    let (sub, email) = verify_id(&http, &d, &tokens.id_token, &a, &id)?;
    let mut runtime = store.runtime.lock().map_err(|_| failure())?;
    if cancel.load(Ordering::SeqCst) {
        return Err("auth_cancelled".into());
    }
    store.database(|db| {
        let account = db
            .accounts
            .iter_mut()
            .find(|v| v.client_id == id)
            .ok_or_else(failure)?;
        if !account.sub.is_empty() && account.sub != sub {
            return Err(failure());
        }
        account.sub = sub;
        account.email = email;
        account.session = Some(Session {
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            id_token: tokens.id_token,
            expires_at: now() + tokens.expires_in,
            scopes: tokens.scope.split_whitespace().map(str::to_owned).collect(),
            earliest_refresh_at: tokens.earliest_refresh_at,
        });
        Ok(())
    })?;
    runtime.error = None;
    Ok(())
}
#[tauri::command]
pub async fn chatgpt_status(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<Status> {
    super::allowed(&window)?;
    let store = app.state::<Store>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.status())
        .await
        .map_err(|_| failure())?
}
#[tauri::command]
pub async fn chatgpt_sign_in(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    account_id: Option<String>,
    enable_plan: Option<bool>,
) -> Result<()> {
    super::allowed(&window)?;
    let store = app.state::<Store>().inner().clone();
    // Bind before opening a browser; each attempt gets an isolated port, verifier and nonce.
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|_| failure())?;
    let redirect = format!(
        "http://127.0.0.1:{}/auth/callback",
        listener.local_addr().map_err(|_| failure())?.port()
    );
    let (id, sub) = store.database(|db| match account_id {
        Some(id) => {
            let account = db
                .accounts
                .iter()
                .find(|a| a.client_id == id)
                .ok_or_else(failure)?;
            Ok((
                Some(id),
                if account.sub.is_empty() {
                    None
                } else {
                    Some(account.sub.clone())
                },
            ))
        }
        None => Ok((None, None)),
    })?;
    let attempt = Attempt {
        state: random()?,
        nonce: random()?,
        verifier: random()?,
        redirect,
        client_id: id,
        sub,
        prompt_consent: enable_plan.unwrap_or(false),
    };
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut runtime = store.runtime.lock().map_err(|_| failure())?;
        if runtime.pending.is_some() {
            return Err("auth_busy".into());
        }
        runtime.pending = Some(cancel.clone());
        runtime.error = None;
    }
    store.publish(&app);
    tauri::async_runtime::spawn_blocking(move || {
        let result = run(&store, listener, attempt, &cancel);
        if let Ok(mut runtime) = store.runtime.lock() {
            runtime.pending = None;
            runtime.error = result.err();
        }
        store.publish(&app);
    });
    Ok(())
}
#[tauri::command]
pub fn chatgpt_cancel(window: tauri::WebviewWindow, app: tauri::AppHandle) -> Result<()> {
    super::allowed(&window)?;
    let store = app.state::<Store>();
    let runtime = store.runtime.lock().map_err(|_| failure())?;
    if let Some(cancel) = &runtime.pending {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}
#[tauri::command]
pub async fn chatgpt_sign_out(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    account_id: String,
) -> Result<()> {
    super::allowed(&window)?;
    app.state::<super::ai::Store>().cancel_account(&account_id);
    let store = app.state::<Store>().inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let runtime = store.runtime.lock().map_err(|_| failure())?;
        if runtime.pending.is_some() {
            return Err("auth_busy".into());
        }
        // Hold the cross-process lock during revocation, so no session replacement can race logout.
        let result = store.database(|db| {
            let account = db
                .accounts
                .iter_mut()
                .find(|v| v.client_id == account_id)
                .ok_or_else(failure)?;
            if let Some(s) = &account.session {
                let http = client()?;
                let d = discovery(&http)?;
                let (token, hint) = s
                    .refresh_token
                    .as_ref()
                    .map(|v| (v, "refresh_token"))
                    .unwrap_or((&s.access_token, "access_token"));
                let mut revoked = false;
                for retry in 0..3 {
                    if http
                        .post(&d.revocation_endpoint)
                        .form(&[
                            ("token", token.as_str()),
                            ("token_type_hint", hint),
                            ("client_id", account.client_id.as_str()),
                        ])
                        .send()
                        .is_ok_and(|r| r.status().is_success())
                    {
                        revoked = true;
                        break;
                    }
                    if retry < 2 {
                        std::thread::sleep(Duration::from_millis(250 * (retry + 1)));
                    }
                }
                if !revoked {
                    return Err("auth_revoke_failed".into());
                }
                account.session = None;
            }
            Ok(())
        });
        drop(runtime);
        if let Ok(mut runtime) = store.runtime.lock() {
            runtime.error = result.as_ref().err().cloned();
        }
        store.publish(&app);
        result
    })
    .await
    .map_err(|_| failure())?
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use unge_core::Id;
    fn attempt() -> Attempt {
        Attempt {
            state: "state".into(),
            nonce: "nonce".into(),
            verifier: "verifier".into(),
            redirect: "http://127.0.0.1:1234/auth/callback".into(),
            client_id: None,
            sub: None,
            prompt_consent: false,
        }
    }
    #[test]
    fn callback_binds_state_and_registration() {
        let mut a = attempt();
        assert!(
            callback(
                "/auth/callback?code=secret&state=wrong&client_id=oaiapp_1",
                &a
            )
            .is_err()
        );
        assert!(
            callback(
                "/auth/callback?code=c&state=state&state=state&client_id=oaiapp_1",
                &a
            )
            .is_err()
        );
        assert!(
            callback(
                "/auth/callback?code=c&state=state&client_id=dynamic_agent_client",
                &a
            )
            .is_err()
        );
        assert_eq!(
            callback("/auth/callback?code=c&state=state&client_id=oaiapp_1", &a).unwrap(),
            ("c".into(), "oaiapp_1".into())
        );
        a.client_id = Some("oaiapp_1".into());
        assert!(callback("/auth/callback?code=c&state=state&client_id=oaiapp_2", &a).is_err());
        assert!(callback("/auth/callback?code=c&state=state", &a).is_ok());
        assert_eq!(
            callback("/auth/callback?state=state&error=access_denied", &a).unwrap_err(),
            "auth_denied"
        );
    }
    #[test]
    fn claims_enforce_identity_and_lifetime() {
        let a = attempt();
        let good = serde_json::json!({"iss":ISSUER,"sub":"subject","aud":"oaiapp_1","nonce":"nonce","exp":200,"iat":90,"email":"example@example.com"});
        assert!(validate_claims(&good, &a, "oaiapp_1", 100).is_ok());
        for (key, value) in [
            ("iss", serde_json::json!("evil")),
            ("aud", serde_json::json!("other")),
            ("nonce", serde_json::json!("wrong")),
            ("exp", serde_json::json!(100)),
            ("iat", serde_json::json!(1000)),
        ] {
            let mut bad = good.clone();
            bad[key] = value;
            assert!(validate_claims(&bad, &a, "oaiapp_1", 100).is_err());
        }
        let mut returning = a;
        returning.sub = Some("other".into());
        assert!(validate_claims(&good, &returning, "oaiapp_1", 100).is_err());
    }
    #[test]
    fn authorize_uses_pkce_and_issued_id() {
        let mut a = attempt();
        let url = authorize(
            "https://auth.openai.com/api/accounts/authorize",
            "urn:uuid:test",
            &a,
        )
        .unwrap();
        let q: std::collections::HashMap<_, _> = url.query_pairs().collect();
        assert_eq!(q["client_id"], "dynamic_agent_client");
        assert_eq!(q["code_challenge_method"], "S256");
        assert_ne!(q["code_challenge"], a.verifier);
        a.client_id = Some("oaiapp_1".into());
        assert!(
            !authorize("https://auth.openai.com/api/accounts/authorize", "host", &a)
                .unwrap()
                .query_pairs()
                .any(|(k, _)| k == "agent_name_hint")
        );
    }
    #[test]
    fn endpoints_are_pinned() {
        assert!(trusted_endpoint(
            "https://auth.openai.com/.well-known/jwks.json"
        ));
        for u in [
            "http://auth.openai.com/x",
            "https://auth.openai.com.evil/x",
            "https://evil@auth.openai.com/x",
            "https://auth.openai.com:8443/x",
        ] {
            assert!(!trusted_endpoint(u));
        }
    }
    #[test]
    fn storage_is_private_stable_and_status_has_no_tokens() {
        use std::os::unix::fs::PermissionsExt;
        let dir =
            std::env::temp_dir().join(format!("komyaku-auth-test-{}", unge_core::Id::new_v4()));
        let store = Store::load(dir.clone()).unwrap();
        let host = store.database(|db| Ok(db.host.clone())).unwrap();
        store
            .database(|db| {
                db.accounts.push(Account {
                    client_id: "oaiapp_test".into(),
                    sub: "sub".into(),
                    email: "e".into(),
                    session: Some(Session {
                        access_token: "ACCESS_SECRET".into(),
                        refresh_token: Some("REFRESH_SECRET".into()),
                        id_token: "ID_SECRET".into(),
                        expires_at: 123,
                        scopes: vec![],
                        earliest_refresh_at: None,
                    }),
                });
                Ok(())
            })
            .unwrap();
        assert_eq!(
            Store::load(dir.clone())
                .unwrap()
                .database(|db| Ok(db.host.clone()))
                .unwrap(),
            host
        );
        let public = serde_json::to_string(&store.status().unwrap()).unwrap();
        assert!(!public.contains("SECRET"));
        assert_eq!(
            fs::metadata(dir.join("session.json"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn signatures_reject_tampering_and_algorithm_confusion() {
        let fixture: Value =
            serde_json::from_str(include_str!("../../test/fixtures/chatgpt-rs256.json")).unwrap();
        let token = fixture["jwt"].as_str().unwrap();
        let claims = verify_signature(token, &fixture["jwks"]).unwrap();
        assert!(validate_claims(&claims, &attempt(), "oaiapp_test", 100).is_ok());
        let parts: Vec<_> = token.split('.').collect();
        let changed = format!(
            "{}.{}.{}",
            parts[0],
            B64.encode(br#"{"sub":"attacker"}"#),
            parts[2]
        );
        assert!(verify_signature(&changed, &fixture["jwks"]).is_err());
        for alg in ["none", "HS256"] {
            let forged = format!(
                "{}.{}.{}",
                B64.encode(
                    serde_json::to_vec(&serde_json::json!({"kid":"test-only","alg":alg})).unwrap()
                ),
                parts[1],
                parts[2]
            );
            assert!(verify_signature(&forged, &fixture["jwks"]).is_err());
        }
        assert!(verify_signature(token, &serde_json::json!({"keys":[]})).is_err());
    }
    #[test]
    fn cancelled_listener_exits() {
        let cancel = AtomicBool::new(true);
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        assert_eq!(
            wait_callback(listener, &attempt(), &cancel).unwrap_err(),
            "auth_cancelled"
        );
    }
    #[test]
    fn renewal_honors_server_schedule_and_checks_grants() {
        let mut session = Session {
            access_token: "test".into(),
            refresh_token: Some("refresh-test".into()),
            id_token: "id-test".into(),
            expires_at: 200,
            scopes: vec!["resource.invoke".into(), "chatgpt.tokens.use.direct".into()],
            earliest_refresh_at: Some(180),
        };
        assert!(plan_granted(&session.scopes));
        assert!(!refresh_due(&session, 150));
        assert!(refresh_due(&session, 180));
        session.scopes.pop();
        assert!(!plan_granted(&session.scopes));
        for code in [
            "invalid_grant",
            "refresh_token_reused",
            "refresh_token_expired",
        ] {
            assert!(terminal_refresh_error(&json!({"error":code})));
            assert!(terminal_refresh_error(&json!({"error":{"code":code}})));
        }
        assert!(!terminal_refresh_error(&json!({"error":"invalid_client"})));
        assert!(!terminal_refresh_error(
            &json!({"detail":"temporary outage"})
        ));
    }
    #[test]
    fn independent_stores_serialize_credential_updates() {
        let dir = std::env::temp_dir().join(format!("komyaku-auth-lock-test-{}", Id::new_v4()));
        let first = Store::load(dir.clone()).unwrap();
        let second = Store::load(dir.clone()).unwrap();
        let jobs = [first, second]
            .into_iter()
            .map(|store| {
                std::thread::spawn(move || {
                    for _ in 0..20 {
                        store
                            .database(|db| {
                                db.accounts.push(Account {
                                    client_id: Id::new_v4().to_string(),
                                    sub: String::new(),
                                    email: String::new(),
                                    session: None,
                                });
                                Ok(())
                            })
                            .unwrap();
                    }
                })
            })
            .collect::<Vec<_>>();
        for job in jobs {
            job.join().unwrap();
        }
        assert_eq!(
            Store::load(dir.clone())
                .unwrap()
                .database(|db| Ok(db.accounts.len()))
                .unwrap(),
            40
        );
        fs::remove_dir_all(dir).unwrap();
    }
}
