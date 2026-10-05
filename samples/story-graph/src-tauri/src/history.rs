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
        let receipt = persistence::save(&path, document)?;
        debug_assert!(receipt.bytes <= 128 * 1024 * 1024);
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
            hash: receipt.hash,
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
pub async fn version_page(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    query: String,
    offset: usize,
    head: Option<u64>,
) -> std::result::Result<serde_json::Value, String> {
    allowed(&window)?;
    if query.chars().count() > 200 || offset > 512 {
        return Err("history_failed".into());
    }
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        Ok(page(entries(&root(&host))?, &query, offset, head))
    })
    .await
    .map_err(|_| "history_failed".to_owned())?
}

fn page(
    versions: Vec<Version>,
    query: &str,
    offset: usize,
    head: Option<u64>,
) -> serde_json::Value {
    let head = head.unwrap_or_else(|| versions.first().map_or(0, |v| v.sequence));
    let query = query.trim().to_lowercase();
    let matches: Vec<_> = versions
        .into_iter()
        .filter(|v| {
            v.sequence <= head
                && (query.is_empty()
                    || [&v.id, &v.message, &v.title]
                        .iter()
                        .any(|s| s.to_lowercase().contains(&query)))
        })
        .collect();
    let total = matches.len();
    let items: Vec<_> = matches.into_iter().skip(offset).take(40).collect();
    serde_json::json!({"items":items,"total":total,"head":head,"offset":offset})
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
    compare_id: Option<String>,
) -> std::result::Result<Value, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate=host.gate.lock().map_err(|_| "state_unavailable")?;
        let doc = snapshot(&root(&host), &id)?;
        domain::Validator(host.registry.clone()).validate(&doc).map_err(|_| "version_invalid")?;
        let (current, revision) = if let Some(id)=compare_id {(snapshot(&root(&host),&id)?,0)}else{let (document,summary)=host.engine.snapshot_with_summary().map_err(|e|e.code)?;(document,summary.revision)};
        domain::Validator(host.registry.clone()).validate(&current).map_err(|_| "version_invalid")?;
        let mut changes = vec![];
        for (id,node) in current.graph().nodes() {
            let old = doc.graph().nodes().get(id);
            if old != Some(node) {
                changes.push(json!({"id":id,"title":node.properties.get("title"),"kind":if old.is_some(){"changed"}else{"added"},"textAvailable":node.type_id==domain::SCENE,"structureAvailable":node.type_id==domain::SCENE,"location":location_change(&doc,&current,*id)}));
            }
        }
        for (id,node) in doc.graph().nodes() {
            if !current.graph().nodes().contains_key(id) { changes.push(json!({"id":id,"title":node.properties.get("title"),"kind":"deleted","textAvailable":node.type_id==domain::SCENE,"structureAvailable":node.type_id==domain::SCENE})); }
        }
        let structure_changed = doc.graph().edges()!=current.graph().edges()
            || doc.graph().groups()!=current.graph().groups() || doc.placement()!=current.placement();
        Ok(json!({"changes":changes,"titleChanged":doc.title!=current.title,"structureChanged":structure_changed,"revision":revision}))
    }).await.map_err(|_| "history_failed".to_owned())?
}
fn location_change(before: &Document, after: &Document, id: Id) -> Value {
    let (Some(old), Some(new)) = (
        before.graph().nodes().get(&id),
        after.graph().nodes().get(&id),
    ) else {
        return Value::Null;
    };
    if ![domain::BLOCK, domain::SEQUENCE, domain::SCENE].contains(&new.type_id.as_str()) {
        return Value::Null;
    }
    let parent_changed = old.properties.get("parent") != new.properties.get("parent");
    let order_changed = old.properties.get("outlineOrder") != new.properties.get("outlineOrder");
    if !parent_changed && !order_changed {
        return Value::Null;
    }
    fn parent_title(doc: &Document, node: &Node) -> String {
        node.properties
            .get("parent")
            .and_then(Value::as_str)
            .and_then(|s| Id::parse_str(s).ok())
            .and_then(|id| doc.graph().nodes().get(&id))
            .and_then(|n| n.properties.get("title"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .chars()
            .take(120)
            .collect()
    }
    json!({"parentChanged":parent_changed,"orderChanged":order_changed,"beforeParent":parent_title(before,old),"afterParent":parent_title(after,new),"beforeOrder":old.properties.get("outlineOrder"),"afterOrder":new.properties.get("outlineOrder")})
}
#[tauri::command]
pub async fn version_structure_diff(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    id: String,
    node_id: String,
    compare_id: Option<String>,
    expected_revision: u64,
) -> std::result::Result<history_structure::Diff, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (before, after) = {
            let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
            let before = snapshot(&root(&host), &id)?;
            let after = if let Some(id) = compare_id {
                snapshot(&root(&host), &id)?
            } else {
                let (doc, summary) = host.engine.snapshot_with_summary().map_err(|e| e.code)?;
                if summary.revision != expected_revision {
                    return Err("revision_conflict".into());
                }
                doc
            };
            domain::Validator(host.registry.clone())
                .validate(&before)
                .map_err(|_| "version_invalid")?;
            domain::Validator(host.registry.clone())
                .validate(&after)
                .map_err(|_| "version_invalid")?;
            let node_id = Id::parse_str(&node_id).map_err(|_| "version_invalid")?;
            fn canonical(doc: &Document, id: Id) -> std::result::Result<Option<Value>, String> {
                let Some(node) = doc.graph().nodes().get(&id) else {
                    return Ok(None);
                };
                if node.type_id != domain::SCENE {
                    return Err("version_invalid".into());
                }
                Ok(Some(
                    node.properties
                        .get("canonical")
                        .ok_or("version_invalid")?
                        .clone(),
                ))
            }
            let pair = (canonical(&before, node_id)?, canonical(&after, node_id)?);
            if pair.0.is_none() && pair.1.is_none() {
                return Err("version_invalid".into());
            }
            pair
        };
        Ok(history_structure::compare(before.as_ref(), after.as_ref()))
    })
    .await
    .map_err(|_| "history_failed".to_owned())?
}
fn scene_text(document: &Document, id: Id) -> std::result::Result<String, String> {
    let Some(node) = document.graph().nodes().get(&id) else {
        return Ok(String::new());
    };
    if node.type_id != domain::SCENE {
        return Err("version_invalid".into());
    }
    domain::text(node.properties.get("canonical").ok_or("invalid_document")?)
}
#[tauri::command]
pub async fn version_text_diff(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    id: String,
    node_id: String,
    compare_id: Option<String>,
    expected_revision: u64,
) -> std::result::Result<history_diff::Diff, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (before, after) = {
            let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
            let before = snapshot(&root(&host), &id)?;
            let after = if let Some(id) = compare_id {
                snapshot(&root(&host), &id)?
            } else {
                let (draft, summary) = host.engine.snapshot_with_summary().map_err(|e| e.code)?;
                if summary.revision != expected_revision {
                    return Err("revision_conflict".into());
                }
                draft
            };
            domain::Validator(host.registry.clone())
                .validate(&before)
                .map_err(|_| "version_invalid")?;
            domain::Validator(host.registry.clone())
                .validate(&after)
                .map_err(|_| "version_invalid")?;
            let id = Id::parse_str(&node_id).map_err(|_| "version_invalid")?;
            if !before.graph().nodes().contains_key(&id) && !after.graph().nodes().contains_key(&id)
            {
                return Err("version_invalid".into());
            }
            (scene_text(&before, id)?, scene_text(&after, id)?)
        };
        // Comparison is CPU-only after capture; release the editing gate first.
        Ok(history_diff::compare(&before, &after))
    })
    .await
    .map_err(|_| "history_failed".to_owned())?
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
    #[test]
    #[ignore = "manual million-character snapshot and history benchmark"]
    fn benchmark_large_snapshot_history() {
        let registry = domain::registry();
        let initial = domain::initial_document(&registry);
        let scene = initial
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap();
        let mut canonical = scene.properties["canonical"].clone();
        let template = canonical["content"][0].clone();
        canonical["content"] = json!((0..1000).map(|_| {
            let mut p = template.clone();
            p["id"] = json!(Id::new_v4());
            p["content"] = json!([{"type":"text","text":"雨".repeat(1000),"marks":[],"metadata":{},"extensions":{}}]); p
        }).collect::<Vec<_>>());
        let mut editor = Editor::new(initial.clone(), 10).unwrap();
        editor
            .execute(Command::SetProperty {
                id: scene.id,
                key: "canonical".into(),
                value: Some(canonical),
            })
            .unwrap();
        let mut document = editor.document().clone();
        domain::Validator(registry).validate(&document).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let start = std::time::Instant::now();
        for _ in 0..5 {
            super::super::save(&dir.path().join("workspace.story.json"), &document).unwrap();
        }
        eprintln!(
            "million-character save average {:?}, bytes {}",
            start.elapsed() / 5,
            std::fs::metadata(dir.path().join("workspace.story.json"))
                .unwrap()
                .len()
        );
        let mut times = vec![];
        let mut ids = vec![];
        for i in 0..30 {
            document.title = format!("Million-character version {i}");
            let start = std::time::Instant::now();
            ids.push(
                record(
                    &dir.path().join("versions"),
                    &document,
                    format!("Revision {i}"),
                )
                .unwrap()
                .id,
            );
            times.push(start.elapsed());
        }
        let total: std::time::Duration = times.iter().sum();
        times.sort();
        eprintln!(
            "30 full versions: total {:?}, average {:?}, p50 {:?}, p95 {:?}",
            total,
            total / 30,
            times[14],
            times[28]
        );
        let start = std::time::Instant::now();
        for id in &ids {
            let loaded = snapshot(&dir.path().join("versions"), id).unwrap();
            assert_eq!(loaded.graph(), document.graph());
        }
        eprintln!("30 verified reloads: {:?}", start.elapsed());
    }
    #[test]
    fn scene_location_changes_are_distinct_from_text_edits() {
        let registry = domain::registry();
        let before = domain::initial_document(&registry);
        let id = before
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap()
            .id;
        assert!(location_change(&before, &before, id).is_null());
        let mut editor = Editor::new(before.clone(), 10).unwrap();
        editor
            .execute(Command::SetProperty {
                id,
                key: "outlineOrder".into(),
                value: Some(json!(99)),
            })
            .unwrap();
        let location = location_change(&before, editor.document(), id);
        assert_eq!(location["orderChanged"], true);
        assert_eq!(location["parentChanged"], false);
        editor
            .execute(Command::SetProperty {
                id,
                key: "parent".into(),
                value: None,
            })
            .unwrap();
        let location = location_change(&before, editor.document(), id);
        assert_eq!(location["parentChanged"], true);
        assert_eq!(location["afterParent"], "");
        assert!(!location["beforeParent"].as_str().unwrap().is_empty());
    }
    #[test]
    fn paged_search_is_complete_and_stable() {
        let versions: Vec<_> = (1..=512)
            .rev()
            .map(|sequence| Version {
                id: Id::new_v4().to_string(),
                message: format!("版{sequence}"),
                date: 0,
                sequence,
                parents: vec![],
                title: "作品".into(),
                nodes: 10,
                scenes: 4,
                hash: String::new(),
            })
            .collect();
        let first = page(versions.clone(), "", 0, None);
        assert_eq!(first["items"].as_array().unwrap().len(), 40);
        let mut ids = std::collections::HashSet::new();
        for offset in (0..512).step_by(40) {
            let result = page(versions.clone(), "", offset, Some(512));
            for item in result["items"].as_array().unwrap() {
                assert!(ids.insert(item["id"].as_str().unwrap().to_owned()));
            }
        }
        assert_eq!(ids.len(), 512);
        let result = page(versions.clone(), "版1", 0, None);
        assert!(result["total"].as_u64().unwrap() > 40);
        assert_eq!(page(versions.clone(), "missing", 0, None)["total"], 0);
        assert_eq!(page(versions, "", 0, Some(40))["items"][0]["sequence"], 40);
    }

    #[test]
    #[ignore = "manual filesystem performance measurement"]
    fn benchmark_history_metadata_pages() {
        let root = std::env::temp_dir().join(format!("komyaku-history-bench-{}", Id::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let mut parent = vec![];
        for sequence in 1..=512 {
            let id = Id::new_v4().to_string();
            let dir = root.join(&id);
            std::fs::create_dir(&dir).unwrap();
            let version = Version {
                id: id.clone(),
                message: format!("版{sequence}"),
                date: 0,
                sequence,
                parents: parent,
                title: "大規模作品".into(),
                nodes: 10000,
                scenes: 4000,
                hash: "0".repeat(64),
            };
            std::fs::write(
                dir.join("version.json"),
                serde_json::to_vec(&version).unwrap(),
            )
            .unwrap();
            parent = vec![id];
        }
        let start = std::time::Instant::now();
        let first = page(entries(&root).unwrap(), "", 0, None);
        eprintln!(
            "512 metadata first page: {:?}, response {} bytes",
            start.elapsed(),
            serde_json::to_vec(&first).unwrap().len()
        );
        let start = std::time::Instant::now();
        for _ in 0..20 {
            let _ = page(entries(&root).unwrap(), "版1", 40, Some(512));
        }
        eprintln!(
            "512 metadata search page average: {:?}",
            start.elapsed() / 20
        );
        std::fs::remove_dir_all(root).unwrap();
    }
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
