//! Deterministic save timing instrumentation for the isolated debug QA bundle.
//! No IPC command or capability is added, and production identifiers bypass it.
#[cfg(debug_assertions)]
const IDENTIFIER: &str = "app.komyaku.desktop.editing-qa";

pub(crate) async fn before_save(
    identifier: &str,
    document_id: &str,
    revision: i64,
) -> Result<(), String> {
    #[cfg(all(debug_assertions, target_os = "macos"))]
    {
        if identifier != IDENTIFIER {
            return Ok(());
        }
        let root = std::path::PathBuf::from("/private/tmp/komyaku-editing-qa-save-gate");
        let document_id = document_id.to_string();
        tauri::async_runtime::spawn_blocking(move || {
            hold(
                IDENTIFIER,
                &root,
                &document_id,
                revision,
                std::time::Duration::from_secs(60),
            )
        })
        .await
        .map_err(|_| "editing_qa_gate_task_failed".to_string())?
    }
    #[cfg(not(all(debug_assertions, target_os = "macos")))]
    {
        let _ = (identifier, document_id, revision);
        Ok(())
    }
}
#[cfg(debug_assertions)]
fn hold(
    identifier: &str,
    root: &std::path::Path,
    document_id: &str,
    revision: i64,
    timeout: std::time::Duration,
) -> Result<(), String> {
    if identifier != IDENTIFIER || !root.join("hold").exists() {
        return Ok(());
    }
    if std::fs::symlink_metadata(root)
        .map_err(|_| "editing_qa_gate_io")?
        .file_type()
        .is_symlink()
    {
        return Err("editing_qa_gate_io".into());
    }
    let ready = serde_json::json!({"documentId":document_id,"revision":revision,"phase":"before-transaction"}).to_string();
    use std::io::Write;
    let mut receipt = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(root.join("ready.json"))
        .map_err(|_| "editing_qa_gate_io")?;
    receipt
        .write_all(ready.as_bytes())
        .map_err(|_| "editing_qa_gate_io")?;
    let start = std::time::Instant::now();
    while root.join("hold").exists() {
        if start.elapsed() >= timeout {
            return Err("editing_qa_gate_timeout".into());
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    Ok(())
}

#[cfg(all(test, debug_assertions))]
mod tests {
    use super::*;
    fn root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "komyaku-gate-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir(&root).unwrap();
        std::fs::write(root.join("hold"), "").unwrap();
        root
    }
    #[test]
    fn ordinary_identifier_never_enters_gate() {
        let root = root();
        hold(
            "app.komyaku.desktop",
            &root,
            "doc",
            7,
            std::time::Duration::ZERO,
        )
        .unwrap();
        assert!(!root.join("ready.json").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn timeout_fails_closed_without_automatic_release() {
        let root = root();
        assert_eq!(
            hold(IDENTIFIER, &root, "doc", 7, std::time::Duration::ZERO).unwrap_err(),
            "editing_qa_gate_timeout"
        );
        assert!(root.join("hold").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn release_allows_save_only_after_ready_receipt() {
        let root = root();
        let worker_root = root.clone();
        let worker = std::thread::spawn(move || {
            hold(
                IDENTIFIER,
                &worker_root,
                "doc",
                7,
                std::time::Duration::from_secs(2),
            )
        });
        let start = std::time::Instant::now();
        while !root.join("ready.json").exists() {
            assert!(start.elapsed() < std::time::Duration::from_secs(2));
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(!worker.is_finished());
        std::fs::remove_file(root.join("hold")).unwrap();
        worker.join().unwrap().unwrap();
        let receipt: serde_json::Value =
            serde_json::from_slice(&std::fs::read(root.join("ready.json")).unwrap()).unwrap();
        assert_eq!(receipt["revision"], 7);
        assert_eq!(receipt["phase"], "before-transaction");
        std::fs::remove_dir_all(root).unwrap();
    }
}
