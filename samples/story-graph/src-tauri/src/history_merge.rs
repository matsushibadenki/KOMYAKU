//! Conservative three-way merge. Authored arrays/text are atomic; conflicts require a side choice.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::result::Result;

fn ancestors(versions: &[history::Version], id: &str) -> BTreeSet<String> {
    let index: BTreeMap<_, _> = versions.iter().map(|v| (v.id.as_str(), v)).collect();
    let mut todo = vec![id.to_owned()];
    let mut result = BTreeSet::new();
    while let Some(id) = todo.pop() {
        if result.insert(id.clone())
            && let Some(version) = index.get(id.as_str())
        {
            todo.extend(version.parents.iter().cloned());
        }
    }
    result
}
fn base(versions: &[history::Version], left: &str, right: &str) -> Result<String, String> {
    let shared: Vec<_> = ancestors(versions, left)
        .intersection(&ancestors(versions, right))
        .cloned()
        .collect();
    let closest: Vec<_> = shared
        .iter()
        .filter(|id| {
            !shared
                .iter()
                .any(|other| other != *id && ancestors(versions, other).contains(*id))
        })
        .collect();
    if closest.len() != 1 {
        return Err("merge_base_ambiguous".into());
    }
    Ok(closest[0].clone())
}
fn pointer(path: &[String]) -> String {
    format!(
        "/{}",
        path.iter()
            .map(|key| key.replace('~', "~0").replace('/', "~1"))
            .collect::<Vec<_>>()
            .join("/")
    )
}
fn merge_value(
    base: Option<&Value>,
    current: Option<&Value>,
    alternative: Option<&Value>,
    path: &mut Vec<String>,
    choices: &BTreeMap<String, String>,
    conflicts: &mut Vec<String>,
) -> Result<Option<Value>, String> {
    if current == alternative || alternative == base {
        return Ok(current.cloned());
    }
    if current == base {
        return Ok(alternative.cloned());
    }
    if let (
        Some(Value::Object(base)),
        Some(Value::Object(current)),
        Some(Value::Object(alternative)),
    ) = (base, current, alternative)
    {
        let keys: BTreeSet<_> = base
            .keys()
            .chain(current.keys())
            .chain(alternative.keys())
            .collect();
        let mut merged = serde_json::Map::new();
        for key in keys {
            path.push(key.clone());
            if let Some(value) = merge_value(
                base.get(key),
                current.get(key),
                alternative.get(key),
                path,
                choices,
                conflicts,
            )? {
                merged.insert(key.clone(), value);
            }
            path.pop();
        }
        return Ok(Some(Value::Object(merged)));
    }
    if conflicts.len() >= 256 {
        return Err("limit_exceeded".into());
    }
    let key = pointer(path);
    conflicts.push(key.clone());
    match choices.get(&key).map(String::as_str) {
        Some("current") | None => Ok(current.cloned()),
        Some("alternative") => Ok(alternative.cloned()),
        _ => Err("merge_choice_invalid".into()),
    }
}
fn merged_document(
    before: &Document,
    current: &Document,
    alternative: &Document,
    choices: &BTreeMap<String, String>,
) -> Result<(Document, Vec<String>), String> {
    if choices.len() > 256 {
        return Err("limit_exceeded".into());
    }
    let before = central_document::legacy_value(before)?;
    let current = central_document::legacy_value(current)?;
    let alternative = central_document::legacy_value(alternative)?;
    let mut conflicts = Vec::new();
    let merged = merge_value(
        Some(&before),
        Some(&current),
        Some(&alternative),
        &mut Vec::new(),
        choices,
        &mut conflicts,
    )?;
    if choices.keys().any(|key| !conflicts.contains(key)) {
        return Err("merge_choice_invalid".into());
    }
    Ok((
        serde_json::from_value(merged.ok_or("merge_invalid")?).map_err(|_| "merge_invalid")?,
        conflicts,
    ))
}
pub(super) fn copy_history(
    source: &Path,
    destination: &Path,
    registry: Arc<unge_executor::Registry>,
) -> Result<(), String> {
    std::fs::create_dir(destination).map_err(|_| "history_failed")?;
    for version in history::entries(source)? {
        let snapshot = history::read_file(
            &source.join(&version.id).join("workspace.story.json"),
            128 * 1024 * 1024,
        )?;
        if history::hash(&snapshot) != version.hash {
            return Err("version_invalid".into());
        }
        let saved: SavedWorkspace =
            serde_json::from_slice(&snapshot).map_err(|_| "version_invalid")?;
        if saved.format != "komyaku-story-workspace" || ![1, 2, 3].contains(&saved.version) {
            return Err("version_invalid".into());
        }
        domain::Validator(registry.clone())
            .validate(&saved.document)
            .map_err(|_| "version_invalid")?;
        let metadata = serde_json::to_vec(&version).map_err(|_| "history_failed")?;
        let dir = destination.join(&version.id);
        std::fs::create_dir(&dir).map_err(|_| "history_failed")?;
        for (name, bytes) in [
            ("version.json", &metadata),
            ("workspace.story.json", &snapshot),
        ] {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(dir.join(name))
                .map_err(|_| "history_failed")?;
            file.write_all(bytes)
                .and_then(|_| file.sync_all())
                .map_err(|_| "history_failed")?;
        }
        std::fs::File::open(&dir)
            .and_then(|f| f.sync_all())
            .map_err(|_| "history_failed")?;
    }
    std::fs::File::open(destination)
        .and_then(|f| f.sync_all())
        .map_err(|_| "history_failed")?;
    Ok(())
}

#[tauri::command]
pub async fn fork_version(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    library: tauri::State<'_, library::Library>,
    store: tauri::State<'_, preferences::Store>,
    id: String,
    branch: String,
) -> Result<(), String> {
    allowed(&window)?;
    let host = host.inner().clone();
    let root = library.root.clone();
    let settings = store.value.lock().map_err(|_| "state_unavailable")?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        let source = history::root(&host);
        let versions = history::entries(&source)?;
        if versions.iter().any(|v| v.branch == branch) {
            return Err("branch_exists".into());
        }
        let document = history::snapshot(&source, &id)?;
        domain::Validator(host.registry.clone())
            .validate(&document)
            .map_err(|_| "version_invalid")?;
        let library = library::Library { root };
        let directory = library.restore_package(
            document.clone(),
            document.title.clone(),
            settings,
            |staging| {
                let destination = staging.join("versions");
                copy_history(&source, &destination, host.registry.clone())?;
                history::record_lineage(&destination, &document, branch.clone(), vec![id], branch)?;
                Ok(())
            },
        )?;
        launch_workspace(&directory, &library.root, false).map_err(|_| "backup_open_failed".into())
    })
    .await
    .map_err(|_| "history_failed".to_owned())?
}

fn prepare(
    host: &Host,
    target: &str,
    revision: u64,
    choices: &BTreeMap<String, String>,
) -> Result<(Document, Vec<String>, history::Version, String), String> {
    let source = history::root(host);
    let versions = history::entries(&source)?;
    let head = versions.first().ok_or("version_invalid")?.clone();
    if head.id == target || !versions.iter().any(|v| v.id == target) {
        return Err("merge_target_invalid".into());
    }
    let ancestor = base(&versions, &head.id, target)?;
    let before = history::snapshot(&source, &ancestor)?;
    let alternative = history::snapshot(&source, target)?;
    let (current, summary) = host.engine.snapshot_with_summary().map_err(|e| e.code)?;
    if summary.revision != revision {
        return Err("revision_conflict".into());
    }
    let (merged, conflicts) = merged_document(&before, &current, &alternative, choices)?;
    Ok((merged, conflicts, head, ancestor))
}

#[tauri::command]
pub async fn preview_merge(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    target: String,
    expected_revision: u64,
) -> Result<Value, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        let (merged, conflicts, head, ancestor) = prepare(&host, &target, expected_revision, &BTreeMap::new())?;
        let current = host.engine.snapshot().map_err(|e| e.code)?;
        let labels: Vec<_> = conflicts.iter().map(|path| {
            let parts: Vec<_> = path.split('/').collect();
            let node = parts.get(3).and_then(|id| id.parse::<Id>().ok()).and_then(|id| current.graph().nodes().get(&id).or_else(|| merged.graph().nodes().get(&id)));
            json!({"path":path,"title":node.and_then(|n| n.properties.get("title")).and_then(Value::as_str).unwrap_or(&current.title).chars().take(200).collect::<String>(),"field":if path.ends_with("/title") { "title" }else if path.ends_with("/role") { "role" }else if path.ends_with("/notes") { "notes" }else if path.contains("/canonical/"){ "body" }else if path.starts_with("/placement/"){ "position" }else if path.contains("/edges/"){ "connection" }else { "information" }})
        }).collect();
        Ok(json!({"head":head.id,"ancestor":ancestor,"conflicts":labels,"changedNodes":merged.graph().nodes().iter().filter(|(id,node)|current.graph().nodes().get(id).is_none_or(|old| !central_document::equal_node(&current,old,&merged,node))).count(),"structureChanged":merged.graph().edges()!=current.graph().edges()||merged.placement()!=current.placement()}))
    }).await.map_err(|_| "history_failed".to_owned())?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MergeRequest {
    target: String,
    expected_head: String,
    expected_revision: u64,
    choices: BTreeMap<String, String>,
    message: String,
}
#[tauri::command]
pub async fn merge_version(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    library: tauri::State<'_, library::Library>,
    store: tauri::State<'_, preferences::Store>,
    request: MergeRequest,
) -> Result<(), String> {
    allowed(&window)?;
    let MergeRequest {
        target,
        expected_head,
        expected_revision,
        choices,
        message,
    } = request;
    if message.trim().is_empty() || message.chars().count() > 200 {
        return Err("version_name_invalid".into());
    }
    let host = host.inner().clone();
    let root = library.root.clone();
    let settings = store.value.lock().map_err(|_| "state_unavailable")?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        let (document, conflicts, head, _) = prepare(&host, &target, expected_revision, &choices)?;
        if head.id != expected_head {
            return Err("revision_conflict".into());
        }
        if conflicts.iter().any(|path| !choices.contains_key(path)) {
            return Err("merge_unresolved".into());
        }
        domain::Validator(host.registry.clone())
            .validate(&document)
            .map_err(|_| "merge_invalid")?;
        let source = history::root(&host);
        let current = host.engine.snapshot().map_err(|e| e.code)?;
        let library = library::Library { root };
        let directory = library.restore_package(
            document.clone(),
            document.title.clone(),
            settings,
            |staging| {
                let destination = staging.join("versions");
                copy_history(&source, &destination, host.registry.clone())?;
                let working = history::record_lineage(
                    &destination,
                    &current,
                    message.clone(),
                    vec![head.id],
                    head.branch.clone(),
                )?;
                history::record_lineage(
                    &destination,
                    &document,
                    message,
                    vec![working.id, target],
                    head.branch,
                )?;
                Ok(())
            },
        )?;
        launch_workspace(&directory, &library.root, false).map_err(|_| "backup_open_failed".into())
    })
    .await
    .map_err(|_| "history_failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn directory() -> PathBuf {
        let root = std::env::temp_dir().join(format!("komyaku-lineage-test-{}", Id::new_v4()));
        std::fs::create_dir(&root).unwrap();
        root
    }
    #[test]
    fn branching_and_two_parent_merge_survive_archive_and_restart() {
        let root = directory();
        let registry = domain::registry();
        let original = domain::initial_document(&registry);
        let history = root.join("versions");
        let a = history::record(&history, &original, "A".into()).unwrap();
        let mut current = original.clone();
        current.title = "本編・A2".into();
        let a2 = history::record(&history, &current, "A2".into()).unwrap();
        let b = history::record_lineage(
            &history,
            &original,
            "B".into(),
            vec![a.id.clone()],
            "別案".into(),
        )
        .unwrap();
        let mut alternative = original.clone();
        alternative.title = "別案・B2".into();
        let b2 = history::record(&history, &alternative, "B2".into()).unwrap();
        let versions = history::entries(&history).unwrap();
        assert_eq!(base(&versions, &a2.id, &b2.id).unwrap(), a.id);
        assert_eq!(b2.branch, "別案");
        assert_eq!(b2.parents, vec![b.id]);
        let m = history::record_lineage(
            &history,
            &alternative,
            "統合".into(),
            vec![a2.id.clone(), b2.id.clone()],
            "main".into(),
        )
        .unwrap();
        assert_eq!(
            history::entries(&history).unwrap()[0].parents,
            vec![a2.id, b2.id]
        );
        let archive = root.join("history.komyaku-story");
        archive::export_file(
            &archive,
            &alternative,
            &history,
            &Default::default(),
            registry.clone(),
        )
        .unwrap();
        let restored = archive::import_file(
            &archive,
            &library::Library {
                root: root.join("empty"),
            },
            registry,
        )
        .unwrap();
        let read = history::entries(&restored.join("versions")).unwrap();
        assert_eq!(read[0].id, m.id);
        assert_eq!(read[0].parents.len(), 2);
        assert_eq!(read.iter().find(|v| v.id == a.id).unwrap().branch, "main");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn independent_changes_merge_and_authored_conflicts_require_an_exact_side() {
        let registry = domain::registry();
        let before = domain::initial_document(&registry);
        let mut current = before.clone();
        current.title = "作者の変更😃".into();
        let mut alternative = serde_json::to_value(&before).unwrap();
        let character = before
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::CHARACTER)
            .unwrap()
            .id
            .to_string();
        alternative["graph"]["nodes"][&character]["properties"]["role"] = json!("別案の役割");
        let alternative: Document = serde_json::from_value(alternative).unwrap();
        let (merged, conflicts) =
            merged_document(&before, &current, &alternative, &BTreeMap::new()).unwrap();
        assert!(conflicts.is_empty());
        assert_eq!(merged.title, current.title);
        assert_eq!(
            merged.graph().nodes()[&Id::parse_str(&character).unwrap()].properties["role"],
            "別案の役割"
        );
        domain::Validator(registry).validate(&merged).unwrap();
        let mut alternative = before.clone();
        alternative.title = "別案の変更👨‍👩‍👧".into();
        let (_, conflicts) =
            merged_document(&before, &current, &alternative, &BTreeMap::new()).unwrap();
        assert_eq!(conflicts, vec!["/title"]);
        let choices = BTreeMap::from([("/title".into(), "alternative".into())]);
        assert_eq!(
            merged_document(&before, &current, &alternative, &choices)
                .unwrap()
                .0
                .title,
            alternative.title
        );
        assert!(
            merged_document(
                &before,
                &current,
                &alternative,
                &BTreeMap::from([("/unknown".into(), "current".into())])
            )
            .is_err()
        );
        assert_eq!(
            before.title,
            domain::initial_document(&domain::registry()).title
        );
    }
    #[test]
    fn deletion_edit_and_same_id_addition_are_never_silently_combined() {
        let before = json!({"nodes":{"id":{"text":"元の文章"}}});
        let current = json!({"nodes":{}});
        let alternative = json!({"nodes":{"id":{"text":"変更した文章"}}});
        let mut conflicts = vec![];
        let candidate = merge_value(
            Some(&before),
            Some(&current),
            Some(&alternative),
            &mut vec![],
            &BTreeMap::new(),
            &mut conflicts,
        )
        .unwrap()
        .unwrap();
        assert_eq!(conflicts, vec!["/nodes/id"]);
        assert_eq!(candidate, current);
        conflicts.clear();
        let before = json!({});
        merge_value(
            Some(&before),
            Some(&json!({"id":{"text":"A"}})),
            Some(&json!({"id":{"text":"B"}})),
            &mut vec![],
            &BTreeMap::new(),
            &mut conflicts,
        )
        .unwrap();
        assert_eq!(conflicts, vec!["/id"]);
    }
    #[test]
    fn missing_duplicate_and_forward_parents_are_rejected_before_publication() {
        let root = directory();
        let document = domain::initial_document(&domain::registry());
        let a = history::record(&root, &document, "A".into()).unwrap();
        for parents in [
            vec![a.id.clone(), a.id.clone()],
            vec![Id::new_v4().to_string()],
        ] {
            assert!(
                history::record_lineage(
                    &root,
                    &document,
                    "invalid".into(),
                    parents,
                    "branch".into()
                )
                .is_err()
            );
        }
        assert_eq!(history::entries(&root).unwrap().len(), 1);
        let path = root.join(&a.id).join("version.json");
        let mut metadata: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        metadata["parents"] = json!([a.id]);
        std::fs::write(path, serde_json::to_vec(&metadata).unwrap()).unwrap();
        assert!(history::entries(&root).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn crisscross_common_ancestors_are_rejected_instead_of_arbitrarily_chosen() {
        let root = directory();
        let doc = domain::initial_document(&domain::registry());
        let a = history::record(&root, &doc, "A".into()).unwrap();
        let b = history::record_lineage(&root, &doc, "B".into(), vec![a.id.clone()], "left".into())
            .unwrap();
        let c =
            history::record_lineage(&root, &doc, "C".into(), vec![a.id], "right".into()).unwrap();
        let left = history::record_lineage(
            &root,
            &doc,
            "L".into(),
            vec![b.id.clone(), c.id.clone()],
            "left".into(),
        )
        .unwrap();
        let right =
            history::record_lineage(&root, &doc, "R".into(), vec![c.id, b.id], "right".into())
                .unwrap();
        assert_eq!(
            base(&history::entries(&root).unwrap(), &left.id, &right.id).unwrap_err(),
            "merge_base_ambiguous"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn merge_preparation_rejects_a_changed_working_revision() {
        let root = directory();
        let registry = domain::registry();
        let doc = domain::initial_document(&registry);
        let a = history::record(&root.join("versions"), &doc, "A".into()).unwrap();
        history::record(&root.join("versions"), &doc, "B".into()).unwrap();
        let engine = Engine::from_editor(Editor::new(doc, 256).unwrap());
        let host = Host {
            engine,
            registry,
            path: root.join("workspace.story.json"),
            gate: Arc::new(Mutex::new(())),
            saves: Arc::new(Mutex::new(journal::Store::default())),
        };
        assert_eq!(
            prepare(&host, &a.id, 1, &BTreeMap::new()).err().unwrap(),
            "revision_conflict"
        );
        assert!(prepare(&host, &a.id, 0, &BTreeMap::new()).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
}
