//! Named paths are Rust-owned ordered references, independent of outline containment.
use super::*;
use std::collections::BTreeSet;
use std::result::Result;
pub const EXTENSION: &str = "komyaku.story.paths";
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PathDefinition {
    pub id: Id,
    pub name: String,
    pub scenes: Vec<Id>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub legacy: Option<String>,
}
impl PathDefinition {
    pub fn key(&self) -> String {
        self.legacy.clone().unwrap_or_else(|| self.id.to_string())
    }
}
fn legacy_id(document: &Document, name: &str) -> Id {
    let bytes = ring::digest::digest(
        &ring::digest::SHA256,
        format!("{}:{name}", document.graph().id).as_bytes(),
    );
    let mut id = [0; 16];
    id.copy_from_slice(&bytes.as_ref()[..16]);
    id[6] = (id[6] & 15) | 0x50;
    id[8] = (id[8] & 63) | 0x80;
    Id::from_bytes(id)
}
pub fn definitions(document: &Document) -> Result<Vec<PathDefinition>, String> {
    if let Some(value) = document.extensions.get(EXTENSION) {
        return serde_json::from_value(value.clone()).map_err(|_| "invalid_path".into());
    }
    ["main", "alternative"]
        .iter()
        .map(|name| {
            Ok(PathDefinition {
                id: legacy_id(document, name),
                name: (*name).into(),
                legacy: Some((*name).into()),
                scenes: {
                    let mut nodes: Vec<_> = document
                        .graph()
                        .nodes()
                        .values()
                        .filter(|n| {
                            n.type_id == domain::SCENE
                                && (n.properties["path"] == *name || n.properties["path"] == "both")
                        })
                        .collect();
                    nodes.sort_by_key(|n| n.properties["order"].as_u64().unwrap_or(0));
                    nodes.iter().map(|n| n.id).collect()
                },
            })
        })
        .collect()
}
pub fn validate(
    document: &Document,
    paths: &[PathDefinition],
    check_links: bool,
) -> Result<(), String> {
    if paths.is_empty() || paths.len() > 32 {
        return Err("invalid_path".into());
    }
    let mut ids = BTreeSet::new();
    let mut names = BTreeSet::new();
    let mut aliases = BTreeSet::new();
    for path in paths {
        if document.graph().nodes().contains_key(&path.id)
            || document.graph().id == path.id
            || !ids.insert(path.id)
            || path.name.trim().is_empty()
            || path.name.chars().count() > 80
            || path.name.chars().any(char::is_control)
            || !names.insert(path.name.trim())
            || path.scenes.len() > 256
            || path.scenes.iter().collect::<BTreeSet<_>>().len() != path.scenes.len()
            || path.scenes.iter().any(|id| {
                document
                    .graph()
                    .nodes()
                    .get(id)
                    .is_none_or(|n| n.type_id != domain::SCENE)
            })
        {
            return Err("invalid_path".into());
        }
        if let Some(alias) = &path.legacy
            && (!matches!(alias.as_str(), "main" | "alternative") || !aliases.insert(alias))
        {
            return Err("invalid_path".into());
        }
        if check_links
            && path.scenes.windows(2).any(|pair| {
                !document.graph().edges().values().any(|e| {
                    e.from.node == pair[0] && e.to.node == pair[1] && e.from.port == "next"
                })
            })
        {
            return Err("disconnected_path".into());
        }
    }
    Ok(())
}
pub fn route(document: &Document, key: &str) -> Result<Vec<(Id, String, String)>, String> {
    let paths = definitions(document)?;
    validate(document, &paths, true)?;
    let path = paths
        .iter()
        .find(|p| p.id.to_string() == key || p.legacy.as_deref() == Some(key))
        .ok_or("invalid_path")?;
    path.scenes
        .iter()
        .map(|id| {
            let n = &document.graph().nodes()[id];
            Ok((
                *id,
                n.properties["title"].as_str().unwrap_or("").into(),
                domain::text(super::central_document::canonical(document, n)?)?,
            ))
        })
        .collect()
}
pub fn command(document: &Document, paths: Vec<PathDefinition>) -> Result<Command, String> {
    validate(document, &paths, false)?;
    let links: BTreeSet<_> = paths
        .iter()
        .flat_map(|p| p.scenes.windows(2).map(|pair| (pair[0], pair[1])))
        .collect();
    let old: BTreeSet<_> = document
        .graph()
        .edges()
        .values()
        .filter(|e| e.from.port == "next")
        .map(|e| (e.from.node, e.to.node))
        .collect();
    let mut commands = vec![Command::SetDocumentExtension {
        key: EXTENSION.into(),
        value: Some(serde_json::to_value(paths).map_err(|_| "invalid_path")?),
    }];
    for edge in document
        .graph()
        .edges()
        .values()
        .filter(|e| e.from.port == "next" && !links.contains(&(e.from.node, e.to.node)))
    {
        commands.push(Command::Disconnect { id: edge.id });
    }
    for (from, to) in links.difference(&old) {
        commands.push(Command::Connect {
            edge: Edge {
                id: Id::new_v4(),
                from: Endpoint {
                    node: *from,
                    port: "next".into(),
                },
                to: Endpoint {
                    node: *to,
                    port: "previous".into(),
                },
            },
        });
    }
    Ok(Command::Batch { commands })
}

// Synchronize siblings only: a reading path never changes folder containment.
pub fn combined_command(
    document: &Document,
    paths: Vec<PathDefinition>,
    outline_path: Option<Id>,
) -> Result<Command, String> {
    let mut orders = Vec::new();
    if let Some(id) = outline_path {
        let route = paths
            .iter()
            .find(|path| path.id == id)
            .ok_or("invalid_path")?;
        let mut ranks = std::collections::BTreeMap::new();
        for (rank, scene) in route.scenes.iter().enumerate() {
            let mut current = Some(*scene);
            for _ in 0..3 {
                let Some(id) = current else { break };
                ranks.entry(id).or_insert(rank);
                current = document
                    .graph()
                    .nodes()
                    .get(&id)
                    .and_then(|node| node.properties.get("parent").and_then(Value::as_str))
                    .and_then(|id| id.parse::<Id>().ok());
            }
        }
        let mut siblings: std::collections::BTreeMap<Option<Id>, Vec<&Node>> = Default::default();
        for node in document.graph().nodes().values().filter(|node| {
            [domain::BLOCK, domain::SEQUENCE, domain::SCENE].contains(&node.type_id.as_str())
        }) {
            let parent = node
                .properties
                .get("parent")
                .and_then(Value::as_str)
                .and_then(|id| id.parse::<Id>().ok());
            siblings.entry(parent).or_default().push(node);
        }
        for nodes in siblings.values_mut() {
            nodes.sort_by_key(|node| {
                (
                    ranks.get(&node.id).copied().unwrap_or(usize::MAX),
                    node.properties["outlineOrder"].as_u64().unwrap_or(0),
                    node.id,
                )
            });
            for (order, node) in nodes.iter().enumerate() {
                if node.properties["outlineOrder"] != json!(order) {
                    orders.push(Command::SetProperty {
                        id: node.id,
                        key: "outlineOrder".into(),
                        value: Some(json!(order)),
                    });
                }
            }
        }
    }
    let mut commands = vec![command(document, paths)?];
    commands.extend(orders);
    Ok(Command::Batch { commands })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn combined_path_and_outline_order_preserve_parent_body_and_undo_once() {
        let registry = domain::registry();
        let doc = domain::initial_document(&registry);
        let original = doc.to_json().unwrap();
        let mut path = definitions(&doc).unwrap().remove(0);
        path.scenes.reverse();
        let route_id = path.id;
        let expected = path.scenes.clone();
        let mut editor = Editor::new(doc.clone(), 256)
            .unwrap()
            .with_validator(Arc::new(domain::Validator(registry)))
            .unwrap();
        assert!(combined_command(&doc, vec![path.clone()], Some(Id::new_v4())).is_err());
        editor
            .execute(combined_command(&doc, vec![path], Some(route_id)).unwrap())
            .unwrap();
        for (id, node) in doc.graph().nodes() {
            let after = &editor.document().graph().nodes()[id];
            assert_eq!(
                after.properties.get("parent"),
                node.properties.get("parent")
            );
            assert_eq!(
                after.properties.get("canonical"),
                node.properties.get("canonical")
            );
        }
        for pair in expected.windows(2) {
            let nodes = editor.document().graph().nodes();
            if nodes[&pair[0]].properties["parent"] == nodes[&pair[1]].properties["parent"] {
                assert!(
                    nodes[&pair[0]].properties["outlineOrder"].as_u64()
                        < nodes[&pair[1]].properties["outlineOrder"].as_u64()
                );
            }
        }
        editor.undo().unwrap();
        assert_eq!(editor.document().to_json().unwrap(), original);
    }
    #[test]
    fn named_routes_reorder_without_copying_body_and_undo_exactly() {
        let registry = domain::registry();
        let doc = domain::initial_document(&registry);
        let original = doc.to_json().unwrap();
        let mut routes = definitions(&doc).unwrap();
        let main = routes
            .iter()
            .find(|p| p.legacy.as_deref() == Some("main"))
            .unwrap()
            .clone();
        let mut custom = main.clone();
        custom.id = Id::new_v4();
        custom.legacy = None;
        custom.name = "別の読み順 / 阅读".into();
        custom.scenes.reverse();
        // Opposing edges from two routes would form a cycle; use a single reordered path.
        routes = vec![custom.clone()];
        let mut editor = Editor::new(doc, 256)
            .unwrap()
            .with_validator(Arc::new(domain::Validator(registry)))
            .unwrap();
        editor
            .execute(command(editor.document(), routes).unwrap())
            .unwrap();
        assert_eq!(crate::workspace_version(editor.document()), 2);
        assert_eq!(
            route(editor.document(), &custom.key())
                .unwrap()
                .iter()
                .map(|n| n.0)
                .collect::<Vec<_>>(),
            custom.scenes
        );
        let serialized = editor.document().to_json().unwrap();
        let restored = Document::from_json(serialized.as_bytes()).unwrap();
        assert_eq!(
            route(&restored, &custom.key()).unwrap().len(),
            custom.scenes.len()
        );
        editor.undo().unwrap();
        assert_eq!(editor.document().to_json().unwrap(), original);
    }
    #[test]
    fn conflicting_routes_and_bad_references_are_atomic() {
        let registry = domain::registry();
        let doc = domain::initial_document(&registry);
        let mut routes = definitions(&doc).unwrap();
        let mut reversed = routes[0].clone();
        reversed.id = Id::new_v4();
        reversed.legacy = None;
        reversed.name = "Reverse".into();
        reversed.scenes.reverse();
        routes.push(reversed);
        let mut editor = Editor::new(doc, 256)
            .unwrap()
            .with_validator(Arc::new(domain::Validator(registry)))
            .unwrap();
        let before = editor.document().to_json().unwrap();
        assert!(
            editor
                .execute(command(editor.document(), routes).unwrap())
                .is_err()
        );
        assert_eq!(editor.document().to_json().unwrap(), before);
        let mut bad = definitions(editor.document()).unwrap();
        bad[0].scenes.push(Id::new_v4());
        assert!(command(editor.document(), bad).is_err());
    }
}
