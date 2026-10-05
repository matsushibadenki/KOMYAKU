//! Immutable local versions. Publish a complete directory atomically; drafts stay separate.
use super::*;
use std::{io::Write, path::Path};

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Version {
    id: String,
    message: String,
    date: u64,
    sequence: u64,
    parents: Vec<String>,
    title: String,
    nodes: usize,
    scenes: usize,
    hash: String,
}
fn root(host: &Host) -> PathBuf {
    host.path.parent().unwrap().join("versions")
}
fn hash(bytes: &[u8]) -> String {
    ring::digest::digest(&ring::digest::SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
fn directory(root: &Path, id: &str) -> std::result::Result<PathBuf, String> {
    if Id::parse_str(id)
        .map_err(|_| "version_invalid")?
        .to_string()
        != id
    {
        return Err("version_invalid".into());
    }
    let path = root.join(id);
    if !std::fs::symlink_metadata(&path)
        .map_err(|_| "version_invalid")?
        .file_type()
        .is_dir()
    {
        return Err("version_invalid".into());
    }
    Ok(path)
}
fn read_file(path: &Path, limit: u64) -> std::result::Result<Vec<u8>, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| "version_invalid")?;
    if !meta.file_type().is_file() || meta.len() > limit {
        return Err("version_invalid".into());
    }
    std::fs::read(path).map_err(|_| "version_invalid".into())
}
fn entries(root: &Path) -> std::result::Result<Vec<Version>, String> {
    if !root.exists() {
        return Ok(vec![]);
    }
    if !std::fs::symlink_metadata(root)
        .map_err(|_| "version_invalid")?
        .file_type()
        .is_dir()
    {
        return Err("version_invalid".into());
    }
    let mut result = vec![];
    for item in std::fs::read_dir(root).map_err(|_| "history_failed")? {
        let item = item.map_err(|_| "history_failed")?;
        let id = item.file_name().to_string_lossy().into_owned();
        if id.starts_with('.') {
            continue;
        } // Incomplete unpublished writes.
        let dir = directory(root, &id)?;
        let version: Version =
            serde_json::from_slice(&read_file(&dir.join("version.json"), 16384)?)
                .map_err(|_| "version_invalid")?;
        if version.id != id || version.parents.len() > 1 {
            return Err("version_invalid".into());
        }
        result.push(version);
        if result.len() > 512 {
            return Err("limit_exceeded".into());
        }
    }
    result.sort_by_key(|version| std::cmp::Reverse(version.sequence));
    for (index, version) in result.iter().enumerate() {
        let parent = result.get(index + 1);
        if version.parents != parent.map(|v| vec![v.id.clone()]).unwrap_or_default()
            || parent.is_some_and(|p| p.sequence >= version.sequence)
        {
            return Err("version_invalid".into());
        }
    }
    Ok(result)
}
fn snapshot(root: &Path, id: &str) -> std::result::Result<Document, String> {
    let version = entries(root)?
        .into_iter()
        .find(|v| v.id == id)
        .ok_or("version_invalid")?;
    let dir = directory(root, id)?;
    let bytes = read_file(&dir.join("workspace.story.json"), 128 * 1024 * 1024)?;
    if hash(&bytes) != version.hash {
        return Err("version_invalid".into());
    }
    // Deserialize the bytes just verified, without reopening the file.
    let saved: SavedWorkspace = serde_json::from_slice(&bytes).map_err(|_| "version_invalid")?;
    if saved.format != "komyaku-story-workspace" || saved.version != 1 {
        return Err("version_invalid".into());
    }
    saved.document.validate().map_err(|_| "version_invalid")?;
    Ok(saved.document)
}
fn record(
    root: &Path,
    document: &Document,
    message: String,
) -> std::result::Result<Version, String> {
    let message = message.trim().to_owned();
    if message.is_empty() || message.chars().count() > 200 {
        return Err("version_name_invalid".into());
    }
    let previous = entries(root)?;
    if previous.len() >= 512 {
        return Err("limit_exceeded".into());
    }
    std::fs::create_dir_all(root).map_err(|_| "history_failed")?;
    let id = Id::new_v4().to_string();
    let temporary = root.join(format!(".{id}"));
    std::fs::create_dir(&temporary).map_err(|_| "history_failed")?;
    let result = (|| {
        let path = temporary.join("workspace.story.json");
        super::save(&path, document)?;
        if std::fs::metadata(&path)
            .map_err(|_| "history_failed")?
            .len()
            > 128 * 1024 * 1024
        {
            return Err("limit_exceeded".into());
        }
        let version = Version {
            id: id.clone(),
            message,
            date: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|_| "history_failed")?
                .as_secs(),
            sequence: previous.first().map_or(1, |v| v.sequence + 1),
            parents: previous
                .first()
                .map(|v| vec![v.id.clone()])
                .unwrap_or_default(),
            title: document.title.clone(),
            nodes: document.graph().nodes().len(),
            scenes: document
                .graph()
                .nodes()
                .values()
                .filter(|n| n.type_id == domain::SCENE)
                .count(),
            hash: hash(&std::fs::read(path).map_err(|_| "history_failed")?),
        };
        let mut file =
            std::fs::File::create(temporary.join("version.json")).map_err(|_| "history_failed")?;
        file.write_all(&serde_json::to_vec(&version).map_err(|_| "history_failed")?)
            .and_then(|_| file.sync_all())
            .map_err(|_| "history_failed")?;
        std::fs::File::open(&temporary)
            .and_then(|f| f.sync_all())
            .map_err(|_| "history_failed")?;
        std::fs::rename(&temporary, root.join(&id)).map_err(|_| "history_failed")?;
        std::fs::File::open(root)
            .and_then(|f| f.sync_all())
            .map_err(|_| "history_failed")?;
        Ok(version)
    })();
    if result.is_err() {
        let _ = std::fs::remove_dir_all(temporary);
    }
    result
}
#[tauri::command]
pub async fn versions(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
) -> std::result::Result<Vec<Version>, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        entries(&root(&host))
    })
    .await
    .map_err(|_| "history_failed".to_owned())?
}
#[tauri::command]
pub async fn save_version(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    message: String,
    expected_revision: u64,
) -> std::result::Result<Version, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        let (document, summary) = host.engine.snapshot_with_summary().map_err(|e| e.code)?;
        if summary.revision != expected_revision {
            return Err("revision_conflict".into());
        }
        record(&root(&host), &document, message)
    })
    .await
    .map_err(|_| "history_failed".to_owned())?
}
#[tauri::command]
pub async fn version_detail(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    id: String,
) -> std::result::Result<Value, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate=host.gate.lock().map_err(|_| "state_unavailable")?;
        let doc = snapshot(&root(&host), &id)?;
        domain::Validator(host.registry.clone()).validate(&doc).map_err(|_| "version_invalid")?;
        let (current, summary) = host.engine.snapshot_with_summary().map_err(|e| e.code)?;
        let mut changes = vec![];
        for (id,node) in current.graph().nodes() {
            let old = doc.graph().nodes().get(id);
            if old != Some(node) {
                changes.push(json!({"id":id,"title":node.properties.get("title"),"kind":if old.is_some(){"changed"}else{"added"}}));
            }
        }
        for (id,node) in doc.graph().nodes() {
            if !current.graph().nodes().contains_key(id) { changes.push(json!({"id":id,"title":node.properties.get("title"),"kind":"deleted"})); }
        }
        let before = serde_json::to_value(&doc).map_err(|_| "history_failed")?;
        let after = serde_json::to_value(&current).map_err(|_| "history_failed")?;
        let structure_changed = doc.graph().edges()!=current.graph().edges()
            || doc.graph().groups()!=current.graph().groups() || before["placement"]!=after["placement"];
        Ok(json!({"changes":changes,"titleChanged":doc.title!=current.title,"structureChanged":structure_changed,"revision":summary.revision}))
    }).await.map_err(|_| "history_failed".to_owned())?
}
#[tauri::command]
pub async fn restore_version(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    library: tauri::State<'_, library::Library>,
    store: tauri::State<'_, preferences::Store>,
    id: String,
    title: String,
) -> std::result::Result<(), String> {
    allowed(&window)?;
    let host = host.inner().clone();
    let library = library::Library {
        root: library.root.clone(),
    };
    let mut settings = store.value.lock().map_err(|_| "state_unavailable")?.clone();
    settings.left_panel_open = true;
    settings.right_panel_open = false;
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        let document = snapshot(&root(&host), &id)?;
        domain::Validator(host.registry.clone())
            .validate(&document)
            .map_err(|_| "version_invalid")?;
        let directory = library.restore_document(document, title, settings)?;
        // Preserve exact source provenance without inventing a parent in another work.
        std::fs::write(
            directory.join("restored-version.json"),
            serde_json::to_vec(&json!({"sourceVersion":id,"sourceWorkspace":host.path}))
                .map_err(|_| "history_failed")?,
        )
        .map_err(|_| "history_failed")?;
        launch_workspace(&directory, &library.root, false)
            .map_err(|_| "backup_open_failed".to_owned())
    })
    .await
    .map_err(|_| "history_failed".to_owned())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn versions_survive_restart_and_tampering_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("versions");
        let first = record(&root, &Document::default(), "First".into()).unwrap();
        let second = record(&root, &Document::default(), "Second".into()).unwrap();
        assert_eq!(entries(&root).unwrap()[0].parents, vec![first.id.clone()]);
        assert_eq!(snapshot(&root, &second.id).unwrap().title, "");
        std::fs::write(root.join(&first.id).join("workspace.story.json"), "{}").unwrap();
        assert!(snapshot(&root, &first.id).is_err());
        assert!(snapshot(&root, "../../workspace").is_err());
        assert!(record(&root, &Document::default(), " ".into()).is_err());
    }
    #[test]
    fn unpublished_writes_and_clock_order_do_not_create_history() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join(".interrupted")).unwrap();
        assert!(entries(dir.path()).unwrap().is_empty());
        let a = record(dir.path(), &Document::default(), "A".into()).unwrap();
        let b = record(dir.path(), &Document::default(), "B".into()).unwrap();
        assert_eq!(b.sequence, a.sequence + 1);
        assert_eq!(entries(dir.path()).unwrap()[0].id, b.id);
    }
    #[test]
    fn restored_version_preserves_nodes_and_does_not_overwrite_current_work() {
        let dir = tempfile::tempdir().unwrap();
        let registry = domain::registry();
        let document = domain::initial_document(&registry);
        let version = record(&dir.path().join("versions"), &document, "Original".into()).unwrap();
        let frozen = snapshot(&dir.path().join("versions"), &version.id).unwrap();
        let library = library::Library {
            root: dir.path().to_owned(),
        };
        let restored = library
            .restore_document(
                frozen,
                "Restored".into(),
                preferences::Preferences::default(),
            )
            .unwrap();
        let restored = super::super::load(&restored.join("workspace.story.json")).unwrap();
        assert_eq!(restored.title, "Restored");
        assert_eq!(restored.graph(), document.graph());
        assert_eq!(
            snapshot(&dir.path().join("versions"), &version.id)
                .unwrap()
                .title,
            document.title
        );
    }
}
