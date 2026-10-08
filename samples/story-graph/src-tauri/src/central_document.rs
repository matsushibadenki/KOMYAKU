//! Rust-owned canonical documents. Scene nodes contain stable references only.
use super::*;
pub const STORE: &str = "komyaku.canonicalDocuments";

pub fn canonical<'a>(document: &'a Document, node: &'a Node) -> std::result::Result<&'a Value, String> {
    let value = node.properties.get("canonical").ok_or("invalid_document")?;
    if let Some(reference) = value.get("documentRef") {
        if reference.as_str() != Some(node.id.to_string().as_str())
            || value.as_object().is_none_or(|o| o.len() != 1)
        {
            return Err("invalid_document_reference".into());
        }
        document.extensions.get(STORE)
            .and_then(|store| store.get(node.id.to_string()))
            .ok_or_else(|| "missing_document_reference".into())
    } else {
        Ok(value)
    }
}

pub fn normalize(mut document: Document) -> std::result::Result<Document, String> {
    let scenes: Vec<_> = document.graph().nodes().values()
        .filter(|n| n.type_id == domain::SCENE).map(|n| n.id).collect();
    document.extensions.entry(STORE.into()).or_insert_with(|| json!({}));
    for id in scenes {
        let node = &document.graph().nodes()[&id];
        domain::text(canonical(&document, node)?)?;
        if node.properties["canonical"].get("documentRef").is_none() {
            document.move_property_to_extension(id, "canonical", STORE, &id.to_string(), json!({"documentRef":id}))
                .map_err(|_| "invalid_document_reference")?;
        }
    }
    validate(&document)?;
    Ok(document)
}

pub fn validate(document: &Document) -> std::result::Result<(), String> {
    let Some(store) = document.extensions.get(STORE) else { return Ok(()); };
    let store = store.as_object().ok_or("invalid_document_store")?;
    let mut references = std::collections::BTreeSet::new();
    for node in document.graph().nodes().values().filter(|n| n.type_id == domain::SCENE) {
        if node.properties["canonical"].get("documentRef").is_none() {
            return Err("invalid_document_reference".into());
        }
        domain::text(canonical(document, node)?)?;
        references.insert(node.id.to_string());
    }
    if store.len() != references.len() || store.keys().any(|k| !references.contains(k)) {
        return Err("orphan_document_reference".into());
    }
    Ok(())
}

/// Compatibility representation for operations that already serialize a full
/// snapshot (three-way merge). Runtime editing never uses this projection.
pub fn legacy_value(document: &Document) -> std::result::Result<Value, String> {
    let mut value = serde_json::to_value(document).map_err(|_| "invalid_document")?;
    let store = value["extensions"].as_object_mut().and_then(|extensions| extensions.remove(STORE));
    if let Some(Value::Object(mut store)) = store {
        for node in value["graph"]["nodes"].as_object_mut().ok_or("invalid_document")?.values_mut() {
            if node["type_id"] == domain::SCENE {
                let id = node["id"].as_str().ok_or("invalid_document")?;
                let body = store.remove(id).ok_or("missing_document_reference")?;
                node["properties"]["canonical"] = body;
            }
        }
        if !store.is_empty() { return Err("orphan_document_reference".into()); }
    }
    Ok(value)
}

pub fn equal_node(before: &Document, a: &Node, after: &Document, b: &Node) -> bool {
    if a.type_id != domain::SCENE || b.type_id != domain::SCENE { return a == b; }
    a.id == b.id && a.type_id == b.type_id && a.inputs == b.inputs && a.outputs == b.outputs
        && a.properties.iter().filter(|(k, _)| k.as_str() != "canonical")
            .eq(b.properties.iter().filter(|(k, _)| k.as_str() != "canonical"))
        && matches!((canonical(before, a), canonical(after, b)), (Ok(a), Ok(b)) if a == b)
}

/// Translate existing UI/domain commands without exposing storage details to windows.
pub fn command(document: &Document, command: Command) -> std::result::Result<Command, String> {
    if !document.extensions.contains_key(STORE) { return Ok(command); }
    Ok(match command {
        Command::Batch { commands } => Command::Batch { commands: commands.into_iter()
            .map(|c| self::command(document, c)).collect::<std::result::Result<_, _>>()? },
        Command::AddNode { mut node, rect } if node.type_id == domain::SCENE => {
            let value = node.properties.remove("canonical").ok_or("invalid_document")?;
            domain::text(&value)?;
            let key = node.id.to_string();
            node.properties.insert("canonical".into(), json!({"documentRef":node.id}));
            Command::Batch { commands: vec![Command::SetDocumentEntry { extension: STORE.into(), key, value: Some(value) }, Command::AddNode { node, rect }] }
        }
        Command::RemoveNode { id } if document.graph().nodes().get(&id).is_some_and(|n| n.type_id == domain::SCENE) => {
            Command::Batch { commands: vec![Command::RemoveNode { id }, Command::SetDocumentEntry { extension: STORE.into(), key: id.to_string(), value: None }] }
        }
        Command::SetProperty { id, key, value } if key == "canonical" => {
            let value = value.ok_or("invalid_document")?;
            domain::text(&value)?;
            Command::SetDocumentEntry { extension: STORE.into(), key: id.to_string(), value: Some(value) }
        }
        Command::SetNestedProperty { id, key, pointer, value } if key == "canonical" => {
            Command::SetNestedDocumentExtension { extension: STORE.into(), pointer: format!("/{id}{pointer}"), value }
        }
        other => other,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn references_edit_undo_and_remove_preserve_one_owned_body() {
        let registry = domain::registry();
        let legacy = domain::initial_document(&registry);
        let id = legacy.graph().nodes().values().find(|n| n.type_id == domain::SCENE).unwrap().id;
        let body = legacy.graph().nodes()[&id].properties["canonical"].clone();
        let document = normalize(legacy).unwrap();
        assert_eq!(canonical(&document, &document.graph().nodes()[&id]).unwrap(), &body);
        assert_eq!(document.graph().nodes()[&id].properties["canonical"], json!({"documentRef":id}));
        assert_eq!(normalize(document.clone()).unwrap(), document);
        let mut editor = Editor::new(document.clone(), 100).unwrap();
        let change = command(editor.document(), Command::SetNestedProperty { id, key: "canonical".into(), pointer: "/content/0/content/0/text".into(), value: json!("中央の原稿😀") }).unwrap();
        editor.execute(change).unwrap();
        assert!(domain::text(canonical(editor.document(), &editor.document().graph().nodes()[&id]).unwrap()).unwrap().contains("中央の原稿😀"));
        editor.undo().unwrap();
        assert_eq!(editor.document(), &document);
        let remove = command(editor.document(), Command::RemoveNode { id }).unwrap();
        editor.execute(remove).unwrap();
        validate(editor.document()).unwrap();
        editor.undo().unwrap();
        assert_eq!(editor.document(), &document);
        let mut broken = document;
        broken.extensions.get_mut(STORE).unwrap().as_object_mut().unwrap().remove(&id.to_string());
        assert!(validate(&broken).is_err());
    }
}
