//! Bounded manuscript search: text stays in Rust; WebViews receive snippets only.
use crate::{Host, allowed, domain};
use serde::Serialize;
use serde_json::Value;
use unge_core::{Document, Id};
const MAX: usize = 2000;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Hit {
    scene: Id,
    paragraph: Option<String>,
    field: String,
    title: String,
    start: usize,
    end: usize,
    before: String,
    matched: String,
    after: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    items: Vec<Hit>,
    total: usize,
    truncated: bool,
    offset: usize,
    revision: u64,
}
fn add(
    hits: &mut Vec<Hit>,
    text: &str,
    query: &str,
    scene: Id,
    paragraph: Option<&str>,
    field: &str,
    title: &str,
) {
    let mut previous = 0;
    let mut units = 0;
    for (byte, matched) in text.match_indices(query) {
        if hits.len() > MAX {
            break;
        }
        units += text[previous..byte].encode_utf16().count();
        let length = matched.encode_utf16().count();
        let mut before: Vec<_> = text[..byte].chars().rev().take(24).collect();
        before.reverse();
        hits.push(Hit {
            scene,
            paragraph: paragraph.map(str::to_owned),
            field: field.into(),
            title: title.chars().take(200).collect(),
            start: units,
            end: units + length,
            before: before.into_iter().collect(),
            matched: matched.into(),
            after: text[byte + matched.len()..].chars().take(48).collect(),
        });
        previous = byte + matched.len();
        units += length;
    }
}
fn walk(hits: &mut Vec<Hit>, value: &Value, query: &str, scene: Id, title: &str) {
    if hits.len() > MAX {
        return;
    }
    if value["type"] == "paragraph" {
        let text: String = value["content"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|v| v["text"].as_str())
            .collect();
        add(
            hits,
            &text,
            query,
            scene,
            value["id"].as_str(),
            "body",
            title,
        );
    } else if let Some(children) = value["content"].as_array() {
        for child in children {
            walk(hits, child, query, scene, title);
        }
    }
}
fn search(document: &Document, query: &str, offset: usize, revision: u64) -> Result<Page, String> {
    if query.is_empty() || query.chars().count() > 200 || offset >= MAX {
        return Err("search_invalid".into());
    }
    let mut hits = vec![];
    for node in document
        .graph()
        .nodes()
        .values()
        .filter(|n| n.type_id == domain::SCENE)
    {
        let title = node
            .properties
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("");
        add(&mut hits, title, query, node.id, None, "title", title);
        if let Some(notes) = node.properties.get("notes").and_then(Value::as_str) {
            add(&mut hits, notes, query, node.id, None, "notes", title);
        }
        if let Some(body) = node.properties.get("canonical") {
            walk(&mut hits, body, query, node.id, title);
        }
        if hits.len() > MAX {
            break;
        }
    }
    let truncated = hits.len() > MAX;
    hits.truncate(MAX);
    let total = hits.len();
    Ok(Page {
        items: hits.into_iter().skip(offset).take(40).collect(),
        total,
        truncated,
        offset,
        revision,
    })
}
#[tauri::command]
pub async fn search_manuscript(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    query: String,
    offset: usize,
) -> Result<Page, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        host.engine
            .read_document(|doc, summary| search(doc, &query, offset, summary.revision))
            .map_err(|e| e.code)?
    })
    .await
    .map_err(|_| "search_failed".to_owned())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_snippets_offsets_and_paging_are_bounded() {
        let registry = domain::registry();
        let mut doc = domain::initial_document(&registry);
        let id = doc
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap()
            .id;
        let mut editor = unge_core::Editor::new(doc, 256).unwrap();
        editor
            .execute(unge_core::Command::SetProperty {
                id,
                key: "notes".into(),
                value: Some(serde_json::json!("😃雨".repeat(100000))),
            })
            .unwrap();
        doc = editor.document().clone();
        let page = search(&doc, "雨", 0, 7).unwrap();
        assert_eq!(page.items.len(), 40);
        assert!(page.truncated);
        assert_eq!(page.total, MAX);
        assert_eq!(page.revision, 7);
        let note = page.items.iter().find(|h| h.field == "notes").unwrap();
        assert_eq!(note.start, 2);
        assert_eq!(note.end, 3);
        assert!(
            page.items
                .iter()
                .all(|h| h.before.chars().count() <= 24 && h.after.chars().count() <= 48)
        );
        assert_eq!(search(&doc, "雨", 40, 7).unwrap().items.len(), 40);
        assert!(search(&doc, "", 0, 7).is_err());
        assert!(search(&doc, "雨", MAX, 7).is_err());
    }
}
