//! Bounded graph and portrait differences exclude prose and encoded asset bytes.
use super::*;
use std::collections::BTreeSet;
#[derive(Serialize)]
pub struct Diff {
    pub changes: Vec<Value>,
    pub total: usize,
    pub omitted: usize,
}
pub fn compare(before: &Document, after: &Document) -> std::result::Result<Diff, String> {
    let mut changes = Vec::new();
    let mut total = 0;
    let mut push = |value| {
        total += 1;
        if changes.len() < 200 {
            changes.push(value)
        }
    };
    let name = |doc: &Document, id: Id| {
        doc.graph()
            .nodes()
            .get(&id)
            .and_then(|n| n.properties["title"].as_str())
            .unwrap_or("")
            .to_owned()
    };
    for id in before
        .graph()
        .edges()
        .keys()
        .chain(after.graph().edges().keys())
        .copied()
        .collect::<BTreeSet<_>>()
    {
        let old = before.graph().edges().get(&id);
        let new = after.graph().edges().get(&id);
        if old != new {
            let endpoint = |doc: &Document, edge: Option<&Edge>| {
                edge.map(|e|json!({"from":name(doc,e.from.node),"fromPort":e.from.port,"to":name(doc,e.to.node),"toPort":e.to.port}))
            };
            push(
                json!({"id":id,"type":"edge","kind":if old.is_none(){"added"}else if new.is_none(){"deleted"}else{"changed"},"before":endpoint(before,old),"after":endpoint(after,new)}),
            );
        }
    }
    for id in before
        .placement()
        .keys()
        .chain(after.placement().keys())
        .copied()
        .collect::<BTreeSet<_>>()
    {
        let old = before.placement().get(&id);
        let new = after.placement().get(&id);
        if old != new {
            push(
                json!({"id":id,"type":"placement","title":if new.is_some(){name(after,id)}else{name(before,id)},"before":old,"after":new}),
            );
        }
    }
    for id in before
        .graph()
        .nodes()
        .keys()
        .chain(after.graph().nodes().keys())
        .copied()
        .collect::<BTreeSet<_>>()
    {
        let portrait = |doc: &Document| {
            doc.graph()
                .nodes()
                .get(&id)
                .and_then(|n| n.properties.get("portrait"))
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(|value| history::hash(value.as_bytes()))
        };
        let old = portrait(before);
        let new = portrait(after);
        if old != new {
            push(
                json!({"id":id,"type":"portrait","title":if after.graph().nodes().contains_key(&id){name(after,id)}else{name(before,id)},"before":old,"after":new}),
            );
        }
    }
    for id in before
        .graph()
        .groups()
        .keys()
        .chain(after.graph().groups().keys())
        .copied()
        .collect::<BTreeSet<_>>()
    {
        if before.graph().groups().get(&id) != after.graph().groups().get(&id) {
            let brief = |doc: &Document| {
                doc.graph()
                    .groups()
                    .get(&id)
                    .map(|g| json!({"name":g.label,"members":g.nodes.len()}))
            };
            push(json!({"id":id,"type":"group","before":brief(before),"after":brief(after)}));
        }
    }
    let old = paths::definitions(before)?;
    let new = paths::definitions(after)?;
    for id in old
        .iter()
        .chain(&new)
        .map(|p| p.id)
        .collect::<BTreeSet<_>>()
    {
        let a = old.iter().find(|p| p.id == id);
        let b = new.iter().find(|p| p.id == id);
        if serde_json::to_value(a).ok() != serde_json::to_value(b).ok() {
            push(
                json!({"id":id,"type":"path","before":a.map(|p|json!({"name":p.name,"scenes":p.scenes.len()})),"after":b.map(|p|json!({"name":p.name,"scenes":p.scenes.len()})),"orderChanged":a.map(|p|&p.scenes)!=b.map(|p|&p.scenes)}),
            );
        }
    }
    Ok(Diff {
        omitted: total - changes.len(),
        total,
        changes,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn assets_and_named_paths_are_visible_without_body_or_image_payloads() {
        let registry = domain::registry();
        let before = domain::initial_document(&registry);
        let mut after = before.clone();
        let mut routes = paths::definitions(&after).unwrap();
        routes[0].name = "改名ルート".into();
        after
            .extensions
            .insert(paths::EXTENSION.into(), json!(routes));
        let diff = compare(&before, &after).unwrap();
        assert_eq!(diff.total, 1);
        assert_eq!(diff.changes[0]["type"], "path");
        assert_eq!(diff.changes[0]["after"]["name"], "改名ルート");
        let serialized = serde_json::to_string(&diff).unwrap();
        assert!(!serialized.contains("canonical"));
        assert!(!serialized.contains("終電"));
    }
}
