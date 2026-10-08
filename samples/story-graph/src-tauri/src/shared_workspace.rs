//! Lossless interoperability adapter. Prose occurs only in the Canonical Document;
//! the native layout adapter contains references, never a second manuscript.
use super::*;
use std::collections::{BTreeMap, BTreeSet};
const WORKSPACE: &str = "https://komyaku.example/schemas/story-workspace/v1";
const GRAPH: &str = "https://komyaku.example/schemas/story-graph/v1";
const ADAPTER: &str = "komyaku.storygraph.native-v1";
const HEADER: &str = "komyaku.scene.document";
fn identity(document: &Document) -> Id {
    let hash = ring::digest::digest(
        &ring::digest::SHA256,
        format!("canonical-workspace:{}", document.graph().id).as_bytes(),
    );
    let mut bytes = [0; 16];
    bytes.copy_from_slice(&hash.as_ref()[..16]);
    bytes[6] = (bytes[6] & 15) | 0x50;
    bytes[8] = (bytes[8] & 63) | 0x80;
    Id::from_bytes(bytes)
}
fn heading(node: &Node, level: u8) -> Value {
    json!({"id":node.id,"type":"heading","schemaVersion":1,"attrs":{"level":level,"lang":null,"dir":"auto"},"metadata":{},"extensions":{},"renderArtifacts":[],"content":[{"type":"text","text":node.properties["title"],"marks":[],"metadata":{},"extensions":{}}]})
}
struct BudgetWriter(usize);
impl std::io::Write for BudgetWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > (24 * 1024 * 1024usize).saturating_sub(self.0) {
            return Err(std::io::Error::other("limit_exceeded"));
        }
        self.0 += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn limits(workspace: &Value) -> std::result::Result<(), String> {
    serde_json::to_writer(BudgetWriter(0), workspace).map_err(|_| "limit_exceeded")?;
    let mut pending = vec![(&workspace["document"], 0usize)];
    let mut values = 0;
    let mut chars = 0;
    while let Some((value, depth)) = pending.pop() {
        values += 1;
        if values > 500_000 || depth > 72 {
            return Err("limit_exceeded".into());
        }
        match value {
            Value::String(s) => chars += s.encode_utf16().count(),
            Value::Array(a) => pending.extend(a.iter().map(|v| (v, depth + 1))),
            Value::Object(o) => pending.extend(o.values().map(|v| (v, depth + 1))),
            _ => {}
        }
        if chars > 10 * 1024 * 1024 {
            return Err("limit_exceeded".into());
        }
    }
    Ok(())
}
fn native_skeleton(document: &Document) -> std::result::Result<Value, String> {
    #[derive(Serialize)]
    struct NativeNode<'a> {
        id: Id,
        type_id: &'a str,
        inputs: &'a [Port],
        outputs: &'a [Port],
        properties: BTreeMap<&'a String, &'a Value>,
    }
    #[derive(Serialize)]
    struct NativeGraph<'a> {
        id: Id,
        name: &'a str,
        nodes: BTreeMap<Id, NativeNode<'a>>,
        edges: &'a BTreeMap<Id, Edge>,
        groups: &'a BTreeMap<Id, Group>,
    }
    #[derive(Serialize)]
    struct NativeDocument<'a> {
        #[serde(skip_serializing_if = "BTreeMap::is_empty")]
        extensions: &'a BTreeMap<String, Value>,
        title: &'a str,
        schema_version: u32,
        engine_version: &'a str,
        plugin_versions: &'a BTreeMap<String, String>,
        graph: NativeGraph<'a>,
        placement: &'a BTreeMap<Id, Rect>,
    }
    let graph = document.graph();
    serde_json::to_value(NativeDocument {
        extensions: &document.extensions,
        title: &document.title,
        schema_version: document.schema_version,
        engine_version: &document.engine_version,
        plugin_versions: &document.plugin_versions,
        placement: document.placement(),
        graph: NativeGraph {
            id: graph.id,
            name: &graph.name,
            edges: graph.edges(),
            groups: graph.groups(),
            nodes: graph
                .nodes()
                .iter()
                .map(|(id, node)| {
                    (
                        *id,
                        NativeNode {
                            id: *id,
                            type_id: &node.type_id,
                            inputs: &node.inputs,
                            outputs: &node.outputs,
                            properties: node
                                .properties
                                .iter()
                                .filter(|(key, _)| {
                                    node.type_id != domain::SCENE || key.as_str() != "canonical"
                                })
                                .collect(),
                        },
                    )
                })
                .collect(),
        },
    })
    .map_err(|_| "shared_workspace_invalid".into())
}
pub fn project(document: &Document) -> std::result::Result<Value, String> {
    domain::Validator(domain::registry())
        .validate(document)
        .map_err(|_| "shared_workspace_invalid")?;
    let skeleton = native_skeleton(document)?;
    let mut ordered: Vec<_> = document
        .graph()
        .nodes()
        .values()
        .filter(|n| [domain::BLOCK, domain::SEQUENCE, domain::SCENE].contains(&n.type_id.as_str()))
        .collect();
    // Native outline is a strict three-level hierarchy. Compare ancestor orders
    // to preserve sibling order without depending on UUID order.
    let order = |node: &Node| {
        node.properties
            .get("outlineOrder")
            .and_then(Value::as_u64)
            .unwrap_or(0)
    };
    let parent = |node: &Node| {
        node.properties
            .get("parent")
            .and_then(Value::as_str)
            .and_then(|s| s.parse::<Id>().ok())
            .and_then(|id| document.graph().nodes().get(&id))
    };
    ordered.sort_by_key(|n| {
        let p = parent(n);
        let b = p.and_then(parent);
        (
            b.map(order)
                .unwrap_or_else(|| p.map(order).unwrap_or_else(|| order(n))),
            if n.type_id == domain::BLOCK { 0 } else { 1 },
            p.filter(|p| p.type_id == domain::SEQUENCE)
                .map(order)
                .unwrap_or_else(|| order(n)),
            if n.type_id == domain::SCENE { 1 } else { 0 },
            order(n),
            n.id,
        )
    });
    let mut content = Vec::new();
    let mut refs = BTreeMap::new();
    for node in ordered {
        if node.type_id == domain::SCENE {
            let canonical = &node.properties["canonical"];
            let root = canonical["id"].as_str().ok_or("shared_workspace_invalid")?;
            let header = serde_json::to_value(
                canonical
                    .as_object()
                    .ok_or("shared_workspace_invalid")?
                    .iter()
                    .filter(|(key, _)| key.as_str() != "content")
                    .collect::<BTreeMap<_, _>>(),
            )
            .map_err(|_| "shared_workspace_invalid")?;
            content.push(json!({"id":root,"type":"blockquote","schemaVersion":1,"metadata":{},"extensions":{HEADER:header},"renderArtifacts":[],"content":canonical["content"]}));
            refs.insert(node.id, root.to_owned());
        } else {
            content.push(heading(
                node,
                if node.type_id == domain::BLOCK { 1 } else { 2 },
            ));
            refs.insert(node.id, node.id.to_string());
        }
    }
    let doc_id = identity(document);
    let mut ids = BTreeSet::from([doc_id.to_string()]);
    fn collect(v: &Value, ids: &mut BTreeSet<String>) -> std::result::Result<(), String> {
        if let Some(id) = v["id"].as_str()
            && !ids.insert(id.into())
        {
            return Err("shared_workspace_duplicate_id".into());
        }
        if let Some(children) = v["content"].as_array() {
            for c in children {
                collect(c, ids)?;
            }
        }
        Ok(())
    }
    for block in &content {
        collect(block, &mut ids)?;
    }
    let nodes:Vec<_>=document.graph().nodes().values().map(|n|{
        let kind=if n.type_id==domain::SCENE{"content"}else if [domain::BLOCK,domain::SEQUENCE].contains(&n.type_id.as_str()){"structure"}else{"reference"};
        let rect=document.placement().get(&n.id);let title=n.properties["title"].as_str().filter(|s|!s.is_empty()).unwrap_or("Untitled");
        json!({"id":n.id,"kind":kind,"subtype":n.type_id.trim_start_matches("story."),"title":title,"documentRefs":refs.get(&n.id).map(|id|vec![json!({"nodeId":id})]).unwrap_or_default(),"preconditions":[],"effects":[],"metadata":{},"position":{"x":rect.map(|r|r.x).unwrap_or(0.),"y":rect.map(|r|r.y).unwrap_or(0.)},"extensions":{}})
    }).collect();
    let entities:Vec<_>=document.graph().nodes().values().filter(|n|n.type_id==domain::CHARACTER).map(|n|json!({"id":n.id,"type":"character","name":n.properties["title"].as_str().filter(|s|!s.is_empty()).unwrap_or("Untitled"),"initialState":{},"metadata":{},"extensions":{}})).collect();
    let edges:Vec<_>=document.graph().edges().values().map(|e|json!({"id":e.id,"from":e.from.node,"to":e.to.node,"type":if e.from.port=="next"{"sequence"}else{"reference"},"label":null,"extensions":{}})).collect();
    let paths: Vec<_> = paths::definitions(document)?
        .into_iter()
        .filter(|p| !p.scenes.is_empty())
        .map(|p| json!({"id":p.id,"name":p.name,"nodeIds":p.scenes,"extensions":{}}))
        .collect();
    let workspace = json!({"schemaId":WORKSPACE,"schemaVersion":1,"document":{"schemaId":"https://komyaku.example/schemas/document/v1","schemaVersion":1,"id":doc_id,"type":"document","attrs":{"language":"und","direction":"auto","writingMode":"horizontal-tb"},"metadata":{},"extensions":{},"content":content},"graph":{"schemaId":GRAPH,"schemaVersion":1,"id":document.graph().id,"documentId":doc_id,"entities":entities,"nodes":nodes,"edges":edges,"paths":paths,"metadata":{},"extensions":{ADAPTER:skeleton}}});
    let mut workspace = workspace;
    narrative::apply_shared(document, &mut workspace["graph"])?;
    limits(&workspace)?;
    Ok(workspace)
}
pub fn decode(value: Value) -> std::result::Result<Document, String> {
    limits(&value)?;
    if value["schemaId"] != WORKSPACE || value["schemaVersion"] != 1 {
        return Err("shared_workspace_invalid".into());
    }
    let mut skeleton = value["graph"]["extensions"][ADAPTER].clone();
    let nodes = skeleton["graph"]["nodes"]
        .as_object_mut()
        .ok_or("shared_workspace_unsupported")?;
    let blocks = value["document"]["content"]
        .as_array()
        .ok_or("shared_workspace_invalid")?;
    let mut by_root = BTreeMap::new();
    for block in blocks.iter().filter(|b| b["type"] == "blockquote") {
        let mut canonical = block["extensions"][HEADER].clone();
        if canonical["id"] != block["id"] {
            return Err("shared_workspace_invalid".into());
        }
        canonical
            .as_object_mut()
            .ok_or("shared_workspace_invalid")?
            .insert("content".into(), block["content"].clone());
        let id = canonical["id"]
            .as_str()
            .ok_or("shared_workspace_invalid")?
            .to_owned();
        if by_root.insert(id, canonical).is_some() {
            return Err("shared_workspace_invalid".into());
        }
    }
    for node in value["graph"]["nodes"]
        .as_array()
        .ok_or("shared_workspace_invalid")?
    {
        if node["subtype"] != "scene" {
            continue;
        }
        let id = node["id"].as_str().ok_or("shared_workspace_invalid")?;
        let root = node["documentRefs"][0]["nodeId"]
            .as_str()
            .ok_or("shared_workspace_invalid")?;
        let canonical = by_root.remove(root).ok_or("shared_workspace_invalid")?;
        nodes.get_mut(id).ok_or("shared_workspace_invalid")?["properties"]
            .as_object_mut()
            .ok_or("shared_workspace_invalid")?
            .insert("canonical".into(), canonical);
    }
    if !by_root.is_empty() {
        return Err("shared_workspace_invalid".into());
    }
    let document: Document =
        serde_json::from_value(skeleton).map_err(|_| "shared_workspace_invalid")?;
    // Exact adapter projection rejects unsupported annotations or graph edits:
    // never silently discard a valid shared feature the native editor cannot own.
    if project(&document)? != value {
        return Err("shared_workspace_unsupported".into());
    }
    Ok(document)
}
#[tauri::command]
pub async fn export_shared_workspace(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
) -> std::result::Result<bool, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let value = host
            .engine
            .read_document(|d, _| project(d))
            .map_err(|_| "shared_workspace_invalid")??;
        let Some(path) = rfd::FileDialog::new()
            .add_filter("Canonical Story Workspace", &["json"])
            .set_file_name("story.workspace.json")
            .save_file()
        else {
            return Ok(false);
        };
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            return Err("export_extension_invalid".into());
        }
        use std::io::Write;
        let mut tmp = tempfile::NamedTempFile::new_in(path.parent().ok_or("export_failed")?)
            .map_err(|_| "export_failed")?;
        serde_json::to_writer(tmp.as_file_mut(), &value).map_err(|_| "export_failed")?;
        tmp.flush()
            .and_then(|_| tmp.as_file().sync_all())
            .map_err(|_| "export_failed")?;
        tmp.persist(path).map_err(|_| "export_failed")?;
        Ok(true)
    })
    .await
    .map_err(|_| "export_failed".to_owned())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn shared_contract_roundtrip_contains_prose_only_once_and_rejects_lossy_edits() {
        let reg = domain::registry();
        let doc = domain::initial_document(&reg);
        let value = project(&doc).unwrap();
        assert_eq!(
            serde_json::to_value(decode(value.clone()).unwrap()).unwrap(),
            serde_json::to_value(&doc).unwrap()
        );
        for n in value["graph"]["extensions"][ADAPTER]["graph"]["nodes"]
            .as_object()
            .unwrap()
            .values()
        {
            assert!(n["properties"].get("canonical").is_none());
        }
        let mut altered = value.clone();
        altered["graph"]["nodes"][0]["effects"] = json!([{"operation":"set"}]);
        assert!(decode(altered).is_err());
        let mut altered = value;
        altered["document"]["content"][0]["id"] = json!(Id::new_v4());
        assert!(decode(altered).is_err());
    }
    #[test]
    fn shared_fixture_import_preserves_source_and_publishes_valid_work() {
        let fixture = include_str!("../../test/fixtures/shared-workspace-v1.json");
        let value: Value = serde_json::from_str(fixture).unwrap();
        let document = decode(value.clone()).unwrap();
        assert_eq!(project(&document).unwrap(), value);
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("shared.json");
        std::fs::write(&source, fixture).unwrap();
        let library = library::Library {
            root: directory.path().join("library"),
        };
        let restored = library
            .import_snapshot(
                &source,
                preferences::Preferences::default(),
                domain::registry(),
            )
            .unwrap();
        let loaded = load(&restored.join("workspace.story.json")).unwrap();
        assert_eq!(loaded.graph(), document.graph());
        assert_eq!(std::fs::read_to_string(&source).unwrap(), fixture);
        let mut broken = value;
        broken["graph"]["documentId"] = json!(Id::new_v4());
        std::fs::write(&source, serde_json::to_vec(&broken).unwrap()).unwrap();
        assert!(
            library
                .import_snapshot(
                    &source,
                    preferences::Preferences::default(),
                    domain::registry()
                )
                .is_err()
        );
        assert_eq!(
            std::fs::read_dir(library.root.join("workspaces"))
                .unwrap()
                .count(),
            1
        );
    }
    #[test]
    #[ignore = "writes shared workspace contract fixture"]
    fn shared_fixture() {
        let doc = domain::initial_document(&domain::registry());
        std::fs::write(
            "/private/tmp/komyaku-shared-workspace.json",
            serde_json::to_vec(&project(&doc).unwrap()).unwrap(),
        )
        .unwrap();
    }
}
