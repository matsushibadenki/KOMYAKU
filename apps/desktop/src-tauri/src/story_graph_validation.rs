//! Referential/topological stage only. Complete schema validation must run
//! before this becomes a public boundary or authorizes workspace persistence.
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

type Result<T> = std::result::Result<T, &'static str>;
fn array<'a>(value: &'a Value, field: &str, max: usize) -> Result<&'a Vec<Value>> {
    let values = value[field].as_array().ok_or("invalid_story_graph")?;
    if values.len() > max {
        return Err("story_graph_limit_exceeded");
    }
    Ok(values)
}
fn id<'a>(value: &'a Value, field: &str) -> Result<&'a str> {
    let text = value[field].as_str().ok_or("invalid_story_graph")?;
    if !super::valid_lower_uuid(text) {
        return Err("invalid_story_graph");
    }
    Ok(text)
}
fn unique<'a>(values: &'a [Value], code: &'static str) -> Result<BTreeSet<&'a str>> {
    let mut ids = BTreeSet::new();
    for value in values {
        if !ids.insert(id(value, "id")?) {
            return Err(code);
        }
    }
    Ok(ids)
}

pub(crate) fn validate_graph_links(graph: &Value, canonical_ids: &BTreeSet<String>) -> Result<()> {
    if graph["schemaId"] != "https://komyaku.example/schemas/story-graph/v1"
        || graph["schemaVersion"] != 1
    {
        return Err("invalid_story_graph");
    }
    id(graph, "id")?;
    id(graph, "documentId")?;
    let nodes = array(graph, "nodes", 10_000)?;
    let edges = array(graph, "edges", 50_000)?;
    let paths = array(graph, "paths", 1_000)?;
    let entities = array(graph, "entities", 10_000)?;
    let node_ids = unique(nodes, "duplicate_story_node_id")?;
    let entity_ids = unique(entities, "duplicate_story_entity_id")?;
    unique(edges, "duplicate_story_edge_id")?;
    unique(paths, "duplicate_story_path_id")?;
    for node in nodes {
        let mut references = BTreeSet::new();
        for reference in array(node, "documentRefs", 100)? {
            let target = id(reference, "nodeId")?;
            if !references.insert(target) {
                return Err("duplicate_story_document_reference");
            }
            if !canonical_ids.contains(target) {
                return Err("missing_canonical_node_reference");
            }
        }
        for collection in ["preconditions", "effects"] {
            for rule in array(node, collection, 100)? {
                if !entity_ids.contains(id(rule, "entityId")?) {
                    return Err("missing_story_entity_reference");
                }
            }
        }
    }
    let mut keys = BTreeSet::new();
    let mut flow = BTreeSet::new();
    let mut outgoing: BTreeMap<&str, Vec<&str>> = node_ids.iter().map(|id| (*id, vec![])).collect();
    let mut indegree: BTreeMap<&str, usize> = node_ids.iter().map(|id| (*id, 0)).collect();
    for edge in edges {
        let from = id(edge, "from")?;
        let to = id(edge, "to")?;
        let kind = edge["type"].as_str().ok_or("invalid_story_graph")?;
        if ![
            "sequence",
            "alternative",
            "merge",
            "reference",
            "causes",
            "requires",
            "foreshadows",
            "resolves",
            "contradicts",
            "supports",
            "explains",
            "character-state",
            "timeline",
        ]
        .contains(&kind)
        {
            return Err("invalid_story_graph");
        }
        if !node_ids.contains(from) || !node_ids.contains(to) {
            return Err("missing_story_edge_node");
        }
        if from == to {
            return Err("self_story_edge");
        }
        if !keys.insert((from, to, kind)) {
            return Err("duplicate_story_edge");
        }
        if ["sequence", "alternative", "merge"].contains(&kind) {
            flow.insert((from, to));
            outgoing.get_mut(from).unwrap().push(to);
            *indegree.get_mut(to).unwrap() += 1;
        }
    }
    let mut pending: Vec<&str> = indegree
        .iter()
        .filter(|(_, count)| **count == 0)
        .map(|(id, _)| *id)
        .collect();
    let mut visited = 0;
    while let Some(node) = pending.pop() {
        visited += 1;
        for next in &outgoing[node] {
            let count = indegree.get_mut(next).unwrap();
            *count -= 1;
            if *count == 0 {
                pending.push(next);
            }
        }
    }
    if visited != nodes.len() {
        return Err("cyclic_story_flow");
    }
    for path in paths {
        let values = array(path, "nodeIds", 10_000)?;
        if values.is_empty() {
            return Err("invalid_story_graph");
        }
        let mut seen = BTreeSet::new();
        let mut previous = None;
        for value in values {
            let node = value.as_str().ok_or("invalid_story_graph")?;
            if !node_ids.contains(node) {
                return Err("missing_story_path_node");
            }
            if !seen.insert(node) {
                return Err("duplicate_story_path_node");
            }
            if let Some(before) = previous {
                if !flow.contains(&(before, node)) {
                    return Err("disconnected_story_path");
                }
            }
            previous = Some(node);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn uuid(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012x}")
    }
    fn graph() -> Value {
        json!({"schemaId":"https://komyaku.example/schemas/story-graph/v1", "schemaVersion":1,
          "id":uuid(1), "documentId":uuid(2), "entities":[{"id":uuid(3)}],
          "nodes":[{"id":uuid(4),"documentRefs":[{"nodeId":uuid(8)}],"preconditions":[],"effects":[{"entityId":uuid(3)}]},
                   {"id":uuid(5),"documentRefs":[],"preconditions":[],"effects":[]}],
          "edges":[{"id":uuid(6),"from":uuid(4),"to":uuid(5),"type":"sequence"}],
          "paths":[{"id":uuid(7),"nodeIds":[uuid(4),uuid(5)]}]})
    }
    fn validate(value: &Value) -> Result<()> {
        validate_graph_links(value, &BTreeSet::from([uuid(8)]))
    }
    #[test]
    fn references_and_paths_fail_closed() {
        let original = graph();
        assert_eq!(validate(&original), Ok(()));
        let mut broken = original.clone();
        broken["nodes"][0]["documentRefs"][0]["nodeId"] = json!(uuid(99));
        assert_eq!(validate(&broken), Err("missing_canonical_node_reference"));
        broken = original.clone();
        broken["nodes"][0]["effects"][0]["entityId"] = json!(uuid(99));
        assert_eq!(validate(&broken), Err("missing_story_entity_reference"));
        broken = original.clone();
        broken["edges"] = json!([]);
        assert_eq!(validate(&broken), Err("disconnected_story_path"));
        broken = original.clone();
        broken["paths"][0]["nodeIds"] = json!([uuid(4), uuid(4)]);
        assert_eq!(validate(&broken), Err("duplicate_story_path_node"));
        assert_eq!(validate(&original), Ok(()));
    }
    #[test]
    fn reading_cycles_rejected_but_semantic_cycles_allowed() {
        let mut value = graph();
        value["edges"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":uuid(9),"from":uuid(5),"to":uuid(4),"type":"merge"}));
        assert_eq!(validate(&value), Err("cyclic_story_flow"));
        value["edges"][1]["type"] = json!("causes");
        assert_eq!(validate(&value), Ok(()));
        value["edges"][1]["to"] = json!(uuid(99));
        assert_eq!(validate(&value), Err("missing_story_edge_node"));
    }
}

fn fields(value: &Value, allowed: &[&str], required: &[&str]) -> Result<()> {
    let object = value.as_object().ok_or("invalid_story_graph")?;
    if object.keys().any(|key| !allowed.contains(&key.as_str()))
        || required.iter().any(|key| !object.contains_key(*key))
    {
        return Err("invalid_story_graph");
    }
    Ok(())
}
fn text(value: &Value, field: &str, min: usize, max: usize) -> Result<()> {
    let value = value[field].as_str().ok_or("invalid_story_graph")?;
    // JS string bounds count UTF-16 units.
    let length = value.encode_utf16().count();
    if length < min || length > max {
        return Err("invalid_story_graph");
    }
    Ok(())
}
fn map(value: &Value, field: &str, bounded_keys: bool) -> Result<()> {
    if let Some(value) = value.get(field) {
        let object = value.as_object().ok_or("invalid_story_graph")?;
        if bounded_keys
            && object
                .keys()
                .any(|key| key.is_empty() || key.encode_utf16().count() > 200)
        {
            return Err("invalid_story_graph");
        }
    }
    Ok(())
}
fn choice(value: &Value, field: &str, options: &[&str]) -> Result<()> {
    if !options.contains(&value[field].as_str().ok_or("invalid_story_graph")?) {
        return Err("invalid_story_graph");
    }
    Ok(())
}

/// Validates a normalized shared Graph snapshot. Shared writers materialize
/// default arrays before native validation; unnormalized external input is rejected.
pub(crate) fn validate_graph_schema(graph: &Value, canonical_ids: &BTreeSet<String>) -> Result<()> {
    fields(
        graph,
        &[
            "schemaId",
            "schemaVersion",
            "id",
            "documentId",
            "entities",
            "nodes",
            "edges",
            "paths",
            "metadata",
            "extensions",
        ],
        &[
            "schemaId",
            "schemaVersion",
            "id",
            "documentId",
            "entities",
            "nodes",
            "edges",
            "paths",
        ],
    )?;
    map(graph, "metadata", false)?;
    map(graph, "extensions", true)?;
    for entity in array(graph, "entities", 10_000)? {
        fields(
            entity,
            &[
                "id",
                "type",
                "name",
                "initialState",
                "metadata",
                "extensions",
            ],
            &["id", "type", "name"],
        )?;
        choice(
            entity,
            "type",
            &[
                "character",
                "location",
                "object",
                "event",
                "fact",
                "relationship",
                "rule",
            ],
        )?;
        text(entity, "name", 1, 500)?;
        map(entity, "initialState", true)?;
        map(entity, "metadata", false)?;
        map(entity, "extensions", true)?;
    }
    for node in array(graph, "nodes", 10_000)? {
        fields(
            node,
            &[
                "id",
                "kind",
                "subtype",
                "title",
                "documentRefs",
                "preconditions",
                "effects",
                "metadata",
                "position",
                "extensions",
            ],
            &[
                "id",
                "kind",
                "subtype",
                "title",
                "documentRefs",
                "preconditions",
                "effects",
            ],
        )?;
        choice(
            node,
            "kind",
            &["content", "structure", "logic", "reference", "state"],
        )?;
        text(node, "title", 1, 1000)?;
        text(node, "subtype", 1, 100)?;
        let slug = node["subtype"].as_str().unwrap();
        if !slug.as_bytes()[0].is_ascii_lowercase()
            || !slug
                .bytes()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'-')
        {
            return Err("invalid_story_graph");
        }
        map(node, "metadata", false)?;
        map(node, "extensions", true)?;
        if let Some(position) = node.get("position") {
            fields(position, &["x", "y"], &["x", "y"])?;
            for axis in ["x", "y"] {
                if !position[axis].as_f64().is_some_and(|n| n.is_finite()) {
                    return Err("invalid_story_graph");
                }
            }
        }
        for reference in array(node, "documentRefs", 100)? {
            fields(reference, &["nodeId"], &["nodeId"])?;
        }
        for collection in ["preconditions", "effects"] {
            for rule in array(node, collection, 100)? {
                let discriminator = if collection == "effects" {
                    "operation"
                } else {
                    "operator"
                };
                fields(
                    rule,
                    &["entityId", "key", discriminator, "value"],
                    &["entityId", "key", discriminator],
                )?;
                text(rule, "key", 1, 200)?;
                let no_value = if collection == "effects" {
                    choice(rule, discriminator, &["set", "unset", "add", "remove"])?;
                    rule[discriminator] == "unset"
                } else {
                    choice(
                        rule,
                        discriminator,
                        &[
                            "equals",
                            "not-equals",
                            "contains",
                            "not-contains",
                            "exists",
                            "not-exists",
                        ],
                    )?;
                    rule[discriminator] == "exists" || rule[discriminator] == "not-exists"
                };
                if rule.get("value").is_some() == no_value {
                    return Err("invalid_story_graph");
                }
            }
        }
    }
    for edge in array(graph, "edges", 50_000)? {
        fields(
            edge,
            &["id", "from", "to", "type", "label", "extensions"],
            &["id", "from", "to", "type"],
        )?;
        if edge.get("label").is_some_and(|label| !label.is_null()) {
            text(edge, "label", 0, 500)?;
        }
        map(edge, "extensions", true)?;
    }
    for path in array(graph, "paths", 1_000)? {
        fields(
            path,
            &["id", "name", "nodeIds", "extensions"],
            &["id", "name", "nodeIds"],
        )?;
        text(path, "name", 1, 500)?;
        map(path, "extensions", true)?;
    }
    validate_graph_links(graph, canonical_ids)
}

#[cfg(test)]
mod schema_tests {
    use super::*;
    use serde_json::json;
    fn graph() -> Value {
        json!({"schemaId":"https://komyaku.example/schemas/story-graph/v1","schemaVersion":1,
      "id":"00000000-0000-4000-8000-000000000001","documentId":"00000000-0000-4000-8000-000000000002",
      "entities":[{"id":"00000000-0000-4000-8000-000000000003","type":"character","name":"人物"}],
      "nodes":[{"id":"00000000-0000-4000-8000-000000000004","kind":"content","subtype":"scene","title":"場面",
        "documentRefs":[],"preconditions":[],"effects":[{"entityId":"00000000-0000-4000-8000-000000000003","key":"knows","operation":"set","value":null}]}],"edges":[],"paths":[]})
    }
    #[test]
    fn validates_state_rule_value_presence_and_unknown_fields() {
        let original = graph();
        assert!(validate_graph_schema(&original, &BTreeSet::new()).is_ok());
        for (field, value) in [
            ("operation", json!("unknown")),
            ("key", json!("")),
            ("extra", json!(true)),
        ] {
            let mut broken = original.clone();
            broken["nodes"][0]["effects"][0][field] = value;
            assert!(validate_graph_schema(&broken, &BTreeSet::new()).is_err());
        }
        let mut broken = original.clone();
        broken["nodes"][0]["effects"][0]["operation"] = json!("unset");
        assert!(validate_graph_schema(&broken, &BTreeSet::new()).is_err());
        broken["nodes"][0]["effects"][0]
            .as_object_mut()
            .unwrap()
            .remove("value");
        assert!(validate_graph_schema(&broken, &BTreeSet::new()).is_ok());
    }
    #[test]
    fn validates_names_positions_slugs_and_extension_keys() {
        let original = graph();
        for (field, value) in [
            ("subtype", json!("Scene")),
            ("title", json!("")),
            ("position", json!({"x":0,"y":"0"})),
            ("extensions", json!({"":null})),
        ] {
            let mut broken = original.clone();
            broken["nodes"][0][field] = value;
            assert!(validate_graph_schema(&broken, &BTreeSet::new()).is_err());
        }
    }
}
