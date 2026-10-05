//! Compare canonical block identities without sending manuscript bodies to the UI.
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    id: String,
    kind: &'static str,
    block_type: &'static str,
    before_position: Option<usize>,
    after_position: Option<usize>,
    actor_changed: bool,
    dialogue_changed: bool,
    layout_changed: bool,
    text_changed: bool,
}
#[derive(Serialize, Debug)]
pub struct Diff {
    changes: Vec<Change>,
    total: usize,
    omitted: usize,
}
fn blocks(document: Option<&Value>) -> &[Value] {
    document
        .and_then(|d| d["content"].as_array())
        .map_or(&[], Vec::as_slice)
}
fn text(node: &Value) -> String {
    node["content"]
        .as_array()
        .map(|content| content.iter().filter_map(|n| n["text"].as_str()).collect())
        .unwrap_or_default()
}
fn cell_text(table: &Value, cell: usize) -> String {
    text(&table["content"][0]["content"][cell]["content"][0])
}
pub fn compare(before: Option<&Value>, after: Option<&Value>) -> Diff {
    let old = blocks(before);
    let new = blocks(after);
    let old_map: HashMap<_, _> = old
        .iter()
        .enumerate()
        .map(|(i, b)| (b["id"].as_str().unwrap_or(""), (i, b)))
        .collect();
    let new_map: HashMap<_, _> = new
        .iter()
        .enumerate()
        .map(|(i, b)| (b["id"].as_str().unwrap_or(""), (i, b)))
        .collect();
    // Compare ranks among surviving IDs: insertion alone must not report every later block as moved.
    let old_rank: HashMap<_, _> = old
        .iter()
        .filter_map(|b| b["id"].as_str())
        .filter(|id| new_map.contains_key(id))
        .enumerate()
        .map(|(i, id)| (id, i))
        .collect();
    let new_rank: HashMap<_, _> = new
        .iter()
        .filter_map(|b| b["id"].as_str())
        .filter(|id| old_map.contains_key(id))
        .enumerate()
        .map(|(i, id)| (id, i))
        .collect();
    let mut changes = Vec::new();
    let mut total = 0;
    for (id, b, a) in new
        .iter()
        .filter_map(|b| b["id"].as_str())
        .map(|id| (id, old_map.get(id).copied(), new_map.get(id).copied()))
        .chain(
            old.iter()
                .filter_map(|b| b["id"].as_str())
                .filter(|id| !new_map.contains_key(id))
                .map(|id| (id, old_map.get(id).copied(), None)),
        )
    {
        let moved = b.is_some() && a.is_some() && old_rank.get(id) != new_rank.get(id);
        if b.map(|(_, b)| b) == a.map(|(_, b)| b) && !moved {
            continue;
        }
        total += 1;
        if changes.len() >= 100 {
            continue;
        }
        let node = a.or(b).unwrap().1;
        let dialogue = node["type"] == "table";
        let (actor_changed, dialogue_changed, layout_changed, text_changed) = match (b, a) {
            (Some((_, b)), Some((_, a))) if dialogue => (
                cell_text(b, 0) != cell_text(a, 0),
                cell_text(b, 1) != cell_text(a, 1),
                b["extensions"]["komyaku.dialogue"] != a["extensions"]["komyaku.dialogue"],
                false,
            ),
            (Some((_, b)), Some((_, a))) => (false, false, false, text(b) != text(a)),
            _ => (false, false, false, false),
        };
        changes.push(Change {
            id: id.into(),
            kind: if b.is_none() {
                "added"
            } else if a.is_none() {
                "deleted"
            } else if moved {
                "moved"
            } else {
                "changed"
            },
            block_type: if dialogue { "dialogue" } else { "paragraph" },
            before_position: b.map(|(i, _)| i + 1),
            after_position: a.map(|(i, _)| i + 1),
            actor_changed,
            dialogue_changed,
            layout_changed,
            text_changed,
        });
    }
    Diff {
        omitted: total - changes.len(),
        total,
        changes,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn p(id: &str, body: &str) -> Value {
        json!({"id":id,"type":"paragraph","content":[{"type":"text","text":body}]})
    }
    fn d(id: &str, actor: &str, body: &str) -> Value {
        json!({"id":id,"type":"table","content":[{"content":[{"content":[p("actor",actor)]},{"content":[p("body",body)]}]}]})
    }
    #[test]
    fn insertion_is_not_a_move_and_reordering_is() {
        let before = json!({"content":[p("a","A"),p("b","B")]});
        let after = json!({"content":[p("x","X"),p("a","A"),p("b","B")]});
        let diff = compare(Some(&before), Some(&after));
        assert_eq!(diff.total, 1);
        assert_eq!(diff.changes[0].kind, "added");
        let after = json!({"content":[p("b","B"),p("a","A")]});
        let diff = compare(Some(&before), Some(&after));
        assert_eq!(diff.total, 2);
        assert!(diff.changes.iter().all(|c| c.kind == "moved"));
    }
    #[test]
    fn actor_dialogue_layout_and_paragraph_edits_are_separate() {
        let before = json!({"content":[d("a","高橋","こんにちは。"),p("b","雨")]});
        let mut after = json!({"content":[d("a","坂本","こんにちは！"),p("b","雪")]});
        after["content"][0]["extensions"] = json!({"komyaku.dialogue":{"actorWidth":64}});
        let diff = compare(Some(&before), Some(&after));
        assert_eq!(diff.total, 2);
        assert!(
            diff.changes[0].actor_changed
                && diff.changes[0].dialogue_changed
                && diff.changes[0].layout_changed
        );
        assert!(diff.changes[1].text_changed);
        assert_eq!(compare(Some(&after), Some(&after)).total, 0);
        assert_eq!(compare(Some(&before), None).changes[0].kind, "deleted");
    }
    #[test]
    fn large_changes_are_bounded_without_transferring_text() {
        let after =
            json!({"content":(0..20000).map(|i|p(&i.to_string(),"巨大本文")).collect::<Vec<_>>()});
        let diff = compare(None, Some(&after));
        assert_eq!(diff.total, 20000);
        assert_eq!(diff.omitted, 19900);
        let bytes = serde_json::to_string(&diff).unwrap();
        assert!(bytes.len() < 32000);
        assert!(!bytes.contains("巨大本文"));
    }
}
