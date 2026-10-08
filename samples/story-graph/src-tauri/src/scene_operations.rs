//! Atomic scene restructuring preserves authored canonical block identities.
use super::*;
use std::result::Result;
pub const EXTENSION: &str = "komyaku.story.scene-lineage";
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Lineage {
    id: Id,
    operation: String,
    sources: Vec<Id>,
    outputs: Vec<Id>,
}
pub fn validate(document: &Document) -> Result<(), String> {
    let Some(value) = document.extensions.get(EXTENSION) else {
        return Ok(());
    };
    let records: Vec<Lineage> =
        serde_json::from_value(value.clone()).map_err(|_| "invalid_lineage")?;
    let mut ids = std::collections::BTreeSet::new();
    if records.len() > 512
        || records.iter().any(|r| {
            !ids.insert(r.id)
                || !matches!(r.operation.as_str(), "split" | "merge")
                || r.sources.is_empty()
                || r.sources.len() > 2
                || r.outputs.is_empty()
                || r.outputs.len() > 2
                || r.sources.iter().chain(&r.outputs).any(|id| id.is_nil())
        })
    {
        return Err("invalid_lineage".into());
    }
    Ok(())
}
fn record(
    document: &Document,
    operation: &str,
    sources: Vec<Id>,
    outputs: Vec<Id>,
) -> Result<Command, String> {
    let mut records: Vec<Lineage> = document
        .extensions
        .get(EXTENSION)
        .map(|v| serde_json::from_value(v.clone()))
        .transpose()
        .map_err(|_| "invalid_lineage")?
        .unwrap_or_default();
    if records.len() >= 512 {
        return Err("limit_exceeded".into());
    }
    records.push(Lineage {
        id: Id::new_v4(),
        operation: operation.into(),
        sources,
        outputs,
    });
    Ok(Command::SetDocumentExtension {
        key: EXTENSION.into(),
        value: Some(json!(records)),
    })
}
fn scene(document: &Document, id: Id) -> Result<&Node, String> {
    document
        .graph()
        .nodes()
        .get(&id)
        .filter(|n| n.type_id == domain::SCENE)
        .ok_or_else(|| "invalid_command".into())
}
fn property(id: Id, key: &str, value: Value) -> Command {
    Command::SetProperty {
        id,
        key: key.into(),
        value: Some(value),
    }
}
fn complete(
    document: &Document,
    mut commands: Vec<Command>,
    routes: Vec<paths::PathDefinition>,
) -> Result<Command, String> {
    let mut temporary = Editor::new(document.clone(), 1).map_err(|_| "invalid_document")?;
    temporary
        .execute(Command::Batch {
            commands: commands.clone(),
        })
        .map_err(|_| "invalid_document")?;
    commands.push(paths::command(temporary.document(), routes)?);
    Ok(Command::Batch { commands })
}
pub fn split(
    document: &Document,
    id: Id,
    block: usize,
    offset: Option<usize>,
    title: String,
) -> Result<Command, String> {
    if title.trim().is_empty() || title.chars().count() > 200 {
        return Err("invalid_properties".into());
    }
    let source = scene(document, id)?;
    let mut left = source.properties["canonical"].clone();
    domain::text(&left)?;
    let mut blocks = left["content"]
        .as_array()
        .ok_or("invalid_document")?
        .clone();
    if block >= blocks.len() {
        return Err("invalid_split".into());
    }
    let right_blocks = if let Some(offset) = offset {
        if blocks[block]["type"] != "paragraph" {
            return Err("invalid_split".into());
        }
        let content = blocks[block]["content"]
            .as_array()
            .ok_or("invalid_document")?;
        let text = content
            .iter()
            .map(|run| run["text"].as_str().ok_or("invalid_document"))
            .collect::<Result<Vec<_>, _>>()?
            .concat();
        use unicode_segmentation::UnicodeSegmentation;
        let mut boundary = 0;
        let mut valid = offset == 0;
        for grapheme in text.graphemes(true) {
            boundary += grapheme.encode_utf16().count();
            valid |= boundary == offset;
        }
        if !valid {
            return Err("invalid_split".into());
        }
        // Preserve marks by slicing each inline run at a UTF-16 boundary.
        let mut a = Vec::new();
        let mut b = Vec::new();
        let mut units = 0;
        for run in content {
            let text = run["text"].as_str().ok_or("invalid_document")?;
            let end = units + text.encode_utf16().count();
            if end <= offset {
                a.push(run.clone())
            } else if units >= offset {
                b.push(run.clone())
            } else {
                let mut at = None;
                let mut count = units;
                for (byte, ch) in text.char_indices() {
                    if count == offset {
                        at = Some(byte);
                        break;
                    }
                    count += ch.len_utf16();
                }
                let at = at.ok_or("invalid_split")?;
                if at > 0 {
                    let mut part = run.clone();
                    part["text"] = json!(&text[..at]);
                    a.push(part)
                }
                if at < text.len() {
                    let mut part = run.clone();
                    part["text"] = json!(&text[at..]);
                    b.push(part)
                }
            }
            units = end;
        }
        if offset > units {
            return Err("invalid_split".into());
        }
        let mut paragraph = blocks[block].clone();
        paragraph["id"] = json!(Id::new_v4());
        paragraph["content"] = json!(b);
        blocks[block]["content"] = json!(a);
        let mut tail = blocks.split_off(block + 1);
        tail.insert(0, paragraph);
        tail
    } else {
        if block == 0 {
            return Err("invalid_split".into());
        }
        blocks.split_off(block)
    };
    left["content"] = json!(blocks);
    let mut right = source.properties["canonical"].clone();
    right["id"] = json!(Id::new_v4());
    right["content"] = json!(right_blocks);
    domain::text(&left)?;
    domain::text(&right)?;
    let mut node = source.clone();
    node.id = Id::new_v4();
    node.properties.insert("title".into(), json!(title));
    node.properties.insert("canonical".into(), right);
    let new_id = node.id;
    let order = source.properties["outlineOrder"].as_u64().unwrap_or(0);
    node.properties
        .insert("outlineOrder".into(), json!(order + 1));
    let mut commands = vec![
        property(id, "canonical", left),
        Command::AddNode {
            node,
            rect: Rect {
                x: 300.,
                y: 300.,
                ..Rect::default()
            },
        },
        record(document, "split", vec![id], vec![id, new_id])?,
    ];
    for sibling in document.graph().nodes().values().filter(|n| {
        n.type_id == domain::SCENE
            && n.id != id
            && n.properties["parent"] == source.properties["parent"]
            && n.properties["outlineOrder"].as_u64().unwrap_or(0) > order
    }) {
        commands.push(property(
            sibling.id,
            "outlineOrder",
            json!(sibling.properties["outlineOrder"].as_u64().unwrap_or(0) + 1),
        ));
    }
    let mut routes = paths::definitions(document)?;
    for route in &mut routes {
        if let Some(index) = route.scenes.iter().position(|n| *n == id) {
            route.scenes.insert(index + 1, new_id)
        }
    }
    complete(document, commands, routes)
}
pub fn merge(document: &Document, first: Id, second: Id) -> Result<Command, String> {
    if first == second {
        return Err("invalid_merge".into());
    }
    let a = scene(document, first)?;
    let b = scene(document, second)?;
    if a.properties["parent"] != b.properties["parent"] {
        return Err("invalid_merge".into());
    }
    let mut siblings: Vec<_> = document
        .graph()
        .nodes()
        .values()
        .filter(|n| n.type_id == domain::SCENE && n.properties["parent"] == a.properties["parent"])
        .collect();
    siblings.sort_by_key(|n| (n.properties["outlineOrder"].as_u64().unwrap_or(0), n.id));
    if !siblings
        .windows(2)
        .any(|pair| pair[0].id == first && pair[1].id == second)
    {
        return Err("invalid_merge".into());
    }
    let mut routes = paths::definitions(document)?;
    for route in &mut routes {
        let a = route.scenes.iter().position(|n| *n == first);
        let b = route.scenes.iter().position(|n| *n == second);
        match (a, b) {
            (None, None) => {}
            (Some(a), Some(b)) if b == a + 1 => {
                route.scenes.remove(b);
            }
            _ => return Err("incompatible_paths".into()),
        }
    }
    let mut canonical = a.properties["canonical"].clone();
    let mut content = canonical["content"]
        .as_array()
        .ok_or("invalid_document")?
        .clone();
    content.extend(
        b.properties["canonical"]["content"]
            .as_array()
            .ok_or("invalid_document")?
            .iter()
            .cloned(),
    );
    canonical["content"] = json!(content);
    domain::text(&canonical)?;
    // Notes remain explicit rather than discarding the removed scene's notes.
    let notes = [
        a.properties["notes"].as_str().unwrap_or(""),
        b.properties["notes"].as_str().unwrap_or(""),
    ]
    .into_iter()
    .filter(|s| !s.is_empty())
    .collect::<Vec<_>>()
    .join("\n\n");
    let commands = vec![
        property(first, "canonical", canonical),
        property(first, "notes", json!(notes)),
        Command::RemoveNode { id: second },
        record(document, "merge", vec![first, second], vec![first])?,
    ];
    complete(document, commands, routes)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn split_and_merge_keep_unicode_block_ids_routes_and_single_undo() {
        let registry = domain::registry();
        let doc = domain::initial_document(&registry);
        let id = paths::definitions(&doc).unwrap()[0].scenes[0];
        let mut editor = Editor::new(doc, 256)
            .unwrap()
            .with_validator(Arc::new(domain::Validator(registry)))
            .unwrap();
        let mut canonical = domain::canonical("雨👨‍👩‍👧‍👦が降る", Id::new_v4(), Id::new_v4());
        let paragraph = canonical["content"][0]["id"].clone();
        let second =
            domain::canonical("第二段落", Id::new_v4(), Id::new_v4())["content"][0].clone();
        canonical["content"]
            .as_array_mut()
            .unwrap()
            .push(second.clone());
        editor
            .execute(property(id, "canonical", canonical))
            .unwrap();
        let before = editor.document().to_json().unwrap();
        assert!(split(editor.document(), id, 0, Some(2), "後半".into()).is_err()); // Inside a surrogate pair.
        editor
            .execute(split(editor.document(), id, 0, Some(1), "後半".into()).unwrap())
            .unwrap();
        let routes = paths::definitions(editor.document()).unwrap();
        let right = routes[0].scenes[1];
        assert_eq!(
            scene(editor.document(), id).unwrap().properties["canonical"]["content"][0]["id"],
            paragraph
        );
        let right_doc = &scene(editor.document(), right).unwrap().properties["canonical"];
        assert_eq!(right_doc["content"][1], second);
        assert_eq!(domain::text(right_doc).unwrap(), "👨‍👩‍👧‍👦が降る\n第二段落");
        let split_bytes = editor.document().to_json().unwrap();
        editor
            .execute(merge(editor.document(), id, right).unwrap())
            .unwrap();
        assert!(!editor.document().graph().nodes().contains_key(&right));
        assert_eq!(
            scene(editor.document(), id).unwrap().properties["canonical"]["content"][2],
            second
        );
        editor.undo().unwrap();
        assert_eq!(editor.document().to_json().unwrap(), split_bytes);
        editor.undo().unwrap();
        assert_eq!(editor.document().to_json().unwrap(), before);
    }
    #[test]
    fn merge_rejects_route_loss_and_nonadjacent_scenes() {
        let registry = domain::registry();
        let doc = domain::initial_document(&registry);
        let route = paths::definitions(&doc).unwrap();
        assert!(merge(&doc, route[0].scenes[0], *route[0].scenes.last().unwrap()).is_err());
        assert!(split(&doc, route[0].scenes[0], 0, None, "Empty".into()).is_err());
    }
}
