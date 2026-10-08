//! Shared Archive v2 codec; native history metadata is preserved in an extension.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
const EXTENSION: &str = "komyaku.storygraph.history-v1";
const LIMIT: usize = 32 * 1024 * 1024;
fn invalid() -> String {
    "shared_archive_invalid".into()
}
fn canonical(document: &Document) -> std::result::Result<Value, String> {
    let mut workspace = shared_workspace::project(document)?;
    let graph = workspace["graph"].take();
    let mut document = workspace["document"].take();
    document["extensions"][shared_archive::GRAPH_EXTENSION] = graph;
    Ok(document)
}
fn native(mut document: Value) -> std::result::Result<Document, String> {
    let graph = document["extensions"]
        .as_object_mut()
        .and_then(|fields| fields.remove(shared_archive::GRAPH_EXTENSION))
        .ok_or_else(invalid)?;
    shared_workspace::decode(
        json!({"schemaId":"https://komyaku.example/schemas/story-workspace/v1","schemaVersion":1,"document":document,"graph":graph}),
    )
}
fn identity(document: &str, name: &str) -> String {
    let hash = ring::digest::digest(
        &ring::digest::SHA256,
        format!("shared-history:{document}:{name}").as_bytes(),
    );
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&hash.as_ref()[..16]);
    bytes[6] = (bytes[6] & 15) | 0x50;
    bytes[8] = (bytes[8] & 63) | 0x80;
    Id::from_bytes(bytes).to_string()
}
pub fn encode(host: &Host) -> std::result::Result<Vec<u8>, String> {
    let versions = history::entries(&history::root(host))?;
    let current = host
        .engine
        .read_document(|document, _| canonical(document))
        .map_err(|e| e.code)??;
    let document_id = current["id"].as_str().ok_or_else(invalid)?.to_string();
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|_| invalid())?
        .as_secs();
    let created = shared_archive::timestamp(now);
    let draft = Id::new_v4().to_string();
    let active = versions
        .first()
        .map_or("main", |version| version.branch.as_str());
    let mut entries = vec![("mimetype".into(), shared_archive::MIME.as_bytes().to_vec())];
    let mut records = vec![];
    let mut metadata = vec![];
    let mut heads = BTreeMap::new();
    let mut total = 0;
    for version in versions.iter().rev() {
        let source = history::snapshot(&history::root(host), &version.id)?;
        let snapshot = canonical(&source)?;
        if snapshot["id"] != document_id {
            return Err(invalid());
        }
        let meta = serde_json::to_value(version).map_err(|_| invalid())?;
        let date = shared_archive::timestamp(meta["date"].as_u64().ok_or_else(invalid)?);
        let bytes = serde_json::to_vec(&snapshot).map_err(|_| invalid())?;
        if bytes.len() > 12 * 1024 * 1024 {
            return Err("limit_exceeded".into());
        }
        total += bytes.len();
        if total > LIMIT {
            return Err("limit_exceeded".into());
        }
        let path = format!("versions/{}.json", version.id);
        records.push(json!({"id":version.id,"schemaVersion":snapshot["schemaVersion"],"snapshotEncoding":"canonical-json-v1","snapshotSha256":history::hash(&bytes),"snapshotByteSize":bytes.len(),"path":path,"parentIds":version.parents,"assetIds":[],"authorId":identity(&document_id,"local-author"),"reason":if version.parents.is_empty(){"initial"}else if version.parents.len()==2{"merge"}else{"named"},"restoredFromVersionId":null,"label":meta["message"],"createdAt":date}));
        entries.push((path, bytes));
        metadata.push(meta);
        heads.insert(version.branch.clone(), (version.id.clone(), date));
    }
    let bytes = serde_json::to_vec(&current).map_err(|_| invalid())?;
    if bytes.len() > 12 * 1024 * 1024 || total + bytes.len() > LIMIT {
        return Err("limit_exceeded".into());
    }
    let path = format!("versions/{draft}.json");
    records.push(json!({"id":draft,"schemaVersion":current["schemaVersion"],"snapshotEncoding":"canonical-json-v1","snapshotSha256":history::hash(&bytes),"snapshotByteSize":bytes.len(),"path":path,"parentIds":versions.first().map(|v|vec![v.id.clone()]).unwrap_or_default(),"assetIds":[],"authorId":identity(&document_id,"local-author"),"reason":if versions.is_empty(){"initial"}else{"import"},"restoredFromVersionId":null,"label":"Working manuscript","createdAt":created}));
    entries.push((path, bytes));
    heads.insert(active.to_string(), (draft.clone(), created.clone()));
    let branches=heads.into_iter().map(|(name,(head,date))|json!({"id":identity(&document_id,&format!("branch:{name}")),"name":name,"headVersionId":head,"createdAt":date,"updatedAt":date})).collect::<Vec<_>>();
    let manifest = json!({"format":"komyaku-archive","formatVersion":2,"createdAt":created,"document":{"id":document_id,"currentBranchId":identity(&document_id,&format!("branch:{active}")),"currentVersionId":draft},"versions":records,"branches":branches,"assets":[],"extensions":{EXTENSION:{"version":1,"draft":draft,"nativeVersions":metadata}}});
    entries.insert(
        1,
        (
            "manifest.json".into(),
            serde_json::to_vec(&manifest).map_err(|_| invalid())?,
        ),
    );
    let bytes = shared_archive::zip(entries);
    if bytes.len() > LIMIT {
        return Err("limit_exceeded".into());
    }
    Ok(bytes)
}
pub struct Package {
    pub document: Document,
    pub versions: Vec<(history::Version, Document)>,
}
fn keys(value: &Value, expected: &[&str]) -> bool {
    value.as_object().is_some_and(|fields| {
        fields.len() == expected.len() && expected.iter().all(|key| fields.contains_key(*key))
    })
}
fn timestamp_valid(value: &Value) -> bool {
    let Some(text) = value.as_str() else {
        return false;
    };
    let bytes = text.as_bytes();
    if bytes.len() != 20
        || ![4, 7, 10, 13, 16, 19]
            .iter()
            .zip(b"--T::Z")
            .all(|(index, separator)| bytes[*index] == *separator)
    {
        return false;
    }
    if bytes
        .iter()
        .enumerate()
        .any(|(index, byte)| ![4, 7, 10, 13, 16, 19].contains(&index) && !byte.is_ascii_digit())
    {
        return false;
    }
    let parse = |start, end| {
        text.get(start..end)
            .and_then(|part| part.parse::<u32>().ok())
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        parse(0, 4),
        parse(5, 7),
        parse(8, 10),
        parse(11, 13),
        parse(14, 16),
        parse(17, 19),
    ) else {
        return false;
    };
    if !(1970..=9999).contains(&year)
        || !(1..=12).contains(&month)
        || hour > 23
        || minute > 59
        || second > 59
    {
        return false;
    }
    let days = [
        31,
        if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) {
            29
        } else {
            28
        },
        31,
        30,
        31,
        30,
        31,
        31,
        30,
        31,
        30,
        31,
    ];
    (1..=days[month as usize - 1]).contains(&day)
}
pub fn decode(bytes: &[u8]) -> std::result::Result<Package, String> {
    let mut entries = shared_archive::read_zip(bytes)?;
    if entries.remove("mimetype").as_deref() != Some(shared_archive::MIME.as_bytes()) {
        return Err(invalid());
    }
    let manifest: Value =
        serde_json::from_slice(&entries.remove("manifest.json").ok_or_else(invalid)?)
            .map_err(|_| invalid())?;
    if !timestamp_valid(&manifest["createdAt"])
        || !keys(
            &manifest,
            &[
                "format",
                "formatVersion",
                "createdAt",
                "document",
                "versions",
                "branches",
                "assets",
                "extensions",
            ],
        )
        || !keys(
            &manifest["document"],
            &["id", "currentBranchId", "currentVersionId"],
        )
    {
        return Err(invalid());
    }
    if manifest["format"] != "komyaku-archive"
        || manifest["formatVersion"] != 2
        || manifest["assets"] != json!([])
    {
        return Err(invalid());
    }
    let extension = &manifest["extensions"][EXTENSION];
    if !keys(extension, &["version", "draft", "nativeVersions"])
        || extension["version"] != 1
        || manifest["extensions"]
            .as_object()
            .is_none_or(|values| values.len() != 1)
    {
        return Err(invalid());
    }
    let draft = extension["draft"].as_str().ok_or_else(invalid)?;
    if manifest["document"]["currentVersionId"] != draft {
        return Err(invalid());
    }
    let records = manifest["versions"].as_array().ok_or_else(invalid)?;
    if records.is_empty() || records.len() > 513 {
        return Err(invalid());
    }
    let mut snapshots = BTreeMap::new();
    let mut parents = BTreeMap::new();
    for record in records {
        if !keys(
            record,
            &[
                "id",
                "schemaVersion",
                "snapshotEncoding",
                "snapshotSha256",
                "snapshotByteSize",
                "path",
                "parentIds",
                "assetIds",
                "authorId",
                "reason",
                "restoredFromVersionId",
                "label",
                "createdAt",
            ],
        ) || record["restoredFromVersionId"] != Value::Null
            || record["authorId"]
                != identity(
                    manifest["document"]["id"].as_str().ok_or_else(invalid)?,
                    "local-author",
                )
        {
            return Err(invalid());
        }
        let id = record["id"].as_str().ok_or_else(invalid)?;
        if Id::parse_str(id).map_err(|_| invalid())?.to_string() != id || snapshots.contains_key(id)
        {
            return Err(invalid());
        }
        let path = format!("versions/{id}.json");
        if record["path"] != path
            || record["snapshotEncoding"] != "canonical-json-v1"
            || record["assetIds"] != json!([])
        {
            return Err(invalid());
        }
        let bytes = entries.remove(&path).ok_or_else(invalid)?;
        if bytes.len() > 12 * 1024 * 1024
            || record["snapshotByteSize"] != json!(bytes.len())
            || record["snapshotSha256"] != history::hash(&bytes)
        {
            return Err(invalid());
        }
        let canonical: Value = serde_json::from_slice(&bytes).map_err(|_| invalid())?;
        if canonical["id"] != manifest["document"]["id"]
            || canonical["schemaVersion"] != record["schemaVersion"]
        {
            return Err(invalid());
        }
        let links: Vec<String> =
            serde_json::from_value(record["parentIds"].clone()).map_err(|_| invalid())?;
        if links.len() > 2
            || links.iter().collect::<BTreeSet<_>>().len() != links.len()
            || links.iter().any(|parent| parent == id)
        {
            return Err(invalid());
        }
        parents.insert(id.to_string(), links);
        snapshots.insert(id.to_string(), native(canonical)?);
    }
    if !entries.is_empty() {
        return Err(invalid());
    }
    fn visit(
        id: &str,
        parents: &BTreeMap<String, Vec<String>>,
        visiting: &mut BTreeSet<String>,
        visited: &mut BTreeSet<String>,
    ) -> std::result::Result<(), String> {
        if visited.contains(id) {
            return Ok(());
        }
        if !visiting.insert(id.to_string()) {
            return Err(invalid());
        }
        for parent in parents.get(id).ok_or_else(invalid)? {
            visit(parent, parents, visiting, visited)?;
        }
        visiting.remove(id);
        visited.insert(id.to_string());
        Ok(())
    }
    let mut reachable = BTreeSet::new();
    let mut branch_names = BTreeSet::new();
    let mut branch_ids = BTreeSet::new();
    let branches = manifest["branches"].as_array().ok_or_else(invalid)?;
    if branches.is_empty() || branches.len() > 200 {
        return Err(invalid());
    }
    let mut current = false;
    for branch in branches {
        if !keys(
            branch,
            &["id", "name", "headVersionId", "createdAt", "updatedAt"],
        ) {
            return Err(invalid());
        }
        let name = branch["name"].as_str().ok_or_else(invalid)?;
        let id = branch["id"].as_str().ok_or_else(invalid)?;
        let head = branch["headVersionId"].as_str().ok_or_else(invalid)?;
        if name.trim() != name
            || name.is_empty()
            || name.chars().count() > 80
            || name.chars().any(char::is_control)
            || !branch_names.insert(name)
            || !branch_ids.insert(id)
            || identity(
                manifest["document"]["id"].as_str().ok_or_else(invalid)?,
                &format!("branch:{name}"),
            ) != id
        {
            return Err(invalid());
        }
        if manifest["document"]["currentBranchId"] == id {
            if head != draft {
                return Err(invalid());
            }
            current = true;
        }
        visit(head, &parents, &mut BTreeSet::new(), &mut reachable)?;
    }
    if !current || reachable.len() != snapshots.len() {
        return Err(invalid());
    }
    let metadata: Vec<history::Version> =
        serde_json::from_value(extension["nativeVersions"].clone()).map_err(|_| invalid())?;
    if metadata.len() + 1 != snapshots.len() {
        return Err(invalid());
    }
    let document = snapshots.remove(draft).ok_or_else(invalid)?;
    let mut versions = vec![];
    let mut sequences = BTreeMap::new();
    for meta in metadata {
        if meta.id == draft
            || parents.get(&meta.id) != Some(&meta.parents)
            || meta.sequence == 0
            || sequences.insert(meta.id.clone(), meta.sequence).is_some()
        {
            return Err(invalid());
        }
        let source = snapshots.remove(&meta.id).ok_or_else(invalid)?;
        let record = records
            .iter()
            .find(|record| record["id"] == meta.id)
            .ok_or_else(invalid)?;
        let native_metadata = serde_json::to_value(&meta).map_err(|_| invalid())?;
        let message = native_metadata["message"].as_str().ok_or_else(invalid)?;
        if message.trim() != message || message.is_empty() || message.chars().count() > 200 {
            return Err(invalid());
        }
        let date = native_metadata["date"].as_u64().ok_or_else(invalid)?;
        if date > 253402300799
            || record["createdAt"] != shared_archive::timestamp(date)
            || record["label"] != native_metadata["message"]
            || native_metadata["title"] != source.title
            || native_metadata["nodes"] != json!(source.graph().nodes().len())
            || native_metadata["scenes"]
                != json!(
                    source
                        .graph()
                        .nodes()
                        .values()
                        .filter(|node| node.type_id == domain::SCENE)
                        .count()
                )
            || record["reason"]
                != if meta.parents.is_empty() {
                    "initial"
                } else if meta.parents.len() == 2 {
                    "merge"
                } else {
                    "named"
                }
        {
            return Err(invalid());
        }
        versions.push((meta, source));
    }
    if sequences.values().collect::<BTreeSet<_>>().len() != sequences.len()
        || versions.iter().any(|(version, _)| {
            version.parents.iter().any(|id| {
                sequences
                    .get(id)
                    .is_none_or(|sequence| *sequence >= version.sequence)
            })
        })
        || !snapshots.is_empty()
    {
        return Err(invalid());
    }
    let draft_record = records
        .iter()
        .find(|record| record["id"] == draft)
        .ok_or_else(invalid)?;
    let latest = versions.iter().max_by_key(|(version, _)| version.sequence);
    let active = latest.map_or("main", |(version, _)| version.branch.as_str());
    let expected_parents = latest
        .map(|(version, _)| vec![version.id.clone()])
        .unwrap_or_default();
    if parents.get(draft) != Some(&expected_parents)
        || draft_record["label"] != "Working manuscript"
        || draft_record["createdAt"] != manifest["createdAt"]
        || draft_record["reason"]
            != if versions.is_empty() {
                "initial"
            } else {
                "import"
            }
        || manifest["document"]["currentBranchId"]
            != identity(
                manifest["document"]["id"].as_str().ok_or_else(invalid)?,
                &format!("branch:{active}"),
            )
    {
        return Err(invalid());
    }
    let mut expected_heads: BTreeMap<String, (u64, String, Value)> = BTreeMap::new();
    for (version, _) in &versions {
        if expected_heads
            .get(&version.branch)
            .is_none_or(|(sequence, _, _)| *sequence < version.sequence)
        {
            let record = records
                .iter()
                .find(|record| record["id"] == version.id)
                .ok_or_else(invalid)?;
            expected_heads.insert(
                version.branch.clone(),
                (
                    version.sequence,
                    version.id.clone(),
                    record["createdAt"].clone(),
                ),
            );
        }
    }
    expected_heads.insert(
        active.into(),
        (u64::MAX, draft.into(), manifest["createdAt"].clone()),
    );
    if expected_heads.len() != branches.len() {
        return Err(invalid());
    }
    for branch in branches {
        let name = branch["name"].as_str().ok_or_else(invalid)?;
        let (_, head, date) = expected_heads.get(name).ok_or_else(invalid)?;
        if branch["headVersionId"] != *head
            || branch["createdAt"] != *date
            || branch["updatedAt"] != *date
        {
            return Err(invalid());
        }
    }
    Ok(Package { document, versions })
}
pub fn publish(package: &Package, root: &std::path::Path) -> std::result::Result<(), String> {
    let versions = root.join("versions");
    std::fs::create_dir(&versions).map_err(|_| invalid())?;
    for (metadata, document) in &package.versions {
        let directory = versions.join(&metadata.id);
        std::fs::create_dir(&directory).map_err(|_| invalid())?;
        let receipt = persistence::save(&directory.join("workspace.story.json"), document)?;
        let mut value = serde_json::to_value(metadata).map_err(|_| invalid())?;
        value["hash"] = json!(receipt.hash);
        let file = directory.join("version.json");
        std::fs::write(&file, serde_json::to_vec(&value).map_err(|_| invalid())?)
            .map_err(|_| invalid())?;
        std::fs::File::open(file)
            .and_then(|file| file.sync_all())
            .map_err(|_| invalid())?;
        std::fs::File::open(directory)
            .and_then(|file| file.sync_all())
            .map_err(|_| invalid())?;
    }
    history::entries(&versions)?;
    std::fs::File::open(&versions)
        .and_then(|file| file.sync_all())
        .map_err(|_| invalid())?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(root: &std::path::Path) -> Host {
        let registry = domain::registry();
        let mut doc = domain::initial_document(&registry);
        let versions = root.join("versions");
        let base = history::record(&versions, &doc, "Base".into()).unwrap();
        doc.title = "Main".into();
        let main = history::record_lineage(
            &versions,
            &doc,
            "Main".into(),
            vec![base.id.clone()],
            "main".into(),
        )
        .unwrap();
        doc.title = "Alternative".into();
        let alt = history::record_lineage(
            &versions,
            &doc,
            "Alternative".into(),
            vec![base.id],
            "alternative".into(),
        )
        .unwrap();
        doc.title = "Merge".into();
        history::record_lineage(
            &versions,
            &doc,
            "Merge".into(),
            vec![main.id, alt.id],
            "main".into(),
        )
        .unwrap();
        doc.title = "Working QA".into();
        let engine = Engine::from_editor(Editor::new(doc, 256).unwrap());
        engine
            .register_view(
                "controls",
                Viewport {
                    origin: [0., 0.],
                    zoom: 1.,
                    size: [800., 600.],
                },
            )
            .unwrap();
        Host {
            engine,
            registry,
            path: root.join("workspace.story.json"),
            gate: Arc::new(Mutex::new(())),
            saves: Arc::new(Mutex::new(journal::Store::default())),
        }
    }
    #[test]
    fn shared_history_roundtrip_preserves_draft_branches_merges_and_rejects_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let host = fixture(dir.path());
        let bytes = encode(&host).unwrap();
        let package = decode(&bytes).unwrap();
        assert_eq!(package.document, host.engine.snapshot().unwrap());
        assert_eq!(package.versions.len(), 4);
        assert!(
            package
                .versions
                .iter()
                .any(|(version, _)| version.parents.len() == 2)
        );
        let target = tempfile::tempdir().unwrap();
        publish(&package, target.path()).unwrap();
        let originals = history::entries(&history::root(&host)).unwrap();
        let imported = history::entries(&target.path().join("versions")).unwrap();
        for (before, after) in originals.iter().zip(imported.iter()) {
            assert_eq!(before.id, after.id);
            assert_eq!(before.parents, after.parents);
            assert_eq!(before.branch, after.branch);
            assert_eq!(
                history::snapshot(&history::root(&host), &before.id).unwrap(),
                history::snapshot(&target.path().join("versions"), &after.id).unwrap()
            );
        }
        let mut entries = shared_archive::read_zip(&bytes).unwrap();
        let key = entries
            .keys()
            .find(|key| key.starts_with("versions/"))
            .unwrap()
            .clone();
        entries.get_mut(&key).unwrap()[30] ^= 1;
        assert!(decode(&shared_archive::zip(entries.into_iter().collect())).is_err());
        let library = library::Library {
            root: target.path().join("library"),
        };
        let path = target.path().join("source.komyaku");
        std::fs::write(&path, &bytes).unwrap();
        let work = library
            .import_snapshot(
                &path,
                preferences::Preferences::default(),
                domain::registry(),
            )
            .unwrap();
        assert_eq!(
            load(&work.join("workspace.story.json")).unwrap(),
            package.document
        );
        assert_eq!(history::entries(&work.join("versions")).unwrap().len(), 4);
        assert_eq!(std::fs::read(path).unwrap(), bytes);
    }
    #[test]
    fn shared_history_rejects_manifest_tampering_and_handles_empty_history() {
        let directory = tempfile::tempdir().unwrap();
        let host = fixture(directory.path());
        let bytes = encode(&host).unwrap();
        let original = shared_archive::read_zip(&bytes).unwrap();
        let manifest: Value = serde_json::from_slice(&original["manifest.json"]).unwrap();
        let cases: Vec<fn(&mut Value)> = vec![
            |m| m["createdAt"] = json!("2026-02-30T00:00:00Z"),
            |m| m["unexpected"] = json!(true),
            |m| m["branches"][0]["headVersionId"] = json!(Id::new_v4().to_string()),
            |m| m["versions"][0]["parentIds"] = json!([m["versions"][0]["id"].clone()]),
            |m| m["extensions"][EXTENSION]["nativeVersions"][0]["message"] = json!("Changed"),
        ];
        for change in cases {
            let mut altered = manifest.clone();
            change(&mut altered);
            let mut entries = original.clone();
            entries.insert(
                "manifest.json".into(),
                serde_json::to_vec(&altered).unwrap(),
            );
            assert!(decode(&shared_archive::zip(entries.into_iter().collect())).is_err());
        }
        let empty = tempfile::tempdir().unwrap();
        let mut host = host;
        host.path = empty.path().join("workspace.story.json");
        let package = decode(&encode(&host).unwrap()).unwrap();
        assert!(package.versions.is_empty());
        assert_eq!(package.document, host.engine.snapshot().unwrap());
        publish(&package, empty.path()).unwrap();
        assert!(
            history::entries(&empty.path().join("versions"))
                .unwrap()
                .is_empty()
        );
    }
    #[test]
    #[ignore = "writes shared history interoperability fixture"]
    fn shared_history_fixture() {
        let dir = tempfile::tempdir().unwrap();
        let host = fixture(dir.path());
        std::fs::write(
            "/private/tmp/komyaku-shared-history-v2.komyaku",
            encode(&host).unwrap(),
        )
        .unwrap();
    }
}
