//! Bounded, borrowed projection of supported canonical rich manuscript blocks.
use serde_json::Value;
use std::collections::BTreeSet;
use unge_core::Id;

pub fn parts(document: &Value) -> Result<Vec<&str>, String> {
    if document["schemaId"] != "https://komyaku.example/schemas/document/v1"
        || document["schemaVersion"] != 1
        || document["type"] != "document"
    {
        return Err("invalid_document".into());
    }
    validate_assets(document)?;
    let mut walker = Walker {
        ids: BTreeSet::new(),
        parts: Vec::new(),
        count: 0,
    };
    walker.identity(document)?;
    walker.blocks(document, 0, "\n")?;
    Ok(walker.parts)
}
struct Walker<'a> {
    ids: BTreeSet<Id>,
    parts: Vec<&'a str>,
    count: usize,
}
impl<'a> Walker<'a> {
    fn identity(&mut self, node: &Value) -> Result<(), String> {
        self.count += 1;
        if self.count > 20000 {
            return Err("limit_exceeded".into());
        }
        let id = node["id"]
            .as_str()
            .ok_or("invalid_document")?
            .parse()
            .map_err(|_| "invalid_document")?;
        if !self.ids.insert(id) {
            return Err("invalid_document".into());
        }
        if node["schemaVersion"] != 1 {
            return Err("invalid_document".into());
        }
        Ok(())
    }
    fn inline(&mut self, content: &'a Value) -> Result<(), String> {
        for node in content.as_array().ok_or("invalid_document")? {
            match node["type"].as_str() {
                Some("hard_break") => self.parts.push("\n"),
                Some("text") => {
                    let marks = node["marks"].as_array().ok_or("invalid_document")?;
                    if marks.len() > 8 {
                        return Err("limit_exceeded".into());
                    }
                    for mark in marks {
                        match mark["type"].as_str() {
                            Some("bold" | "italic" | "underline" | "strike" | "code") => (),
                            Some("link") => {
                                let href = mark["href"].as_str().ok_or("invalid_document")?;
                                let url =
                                    tauri::Url::parse(href).map_err(|_| "invalid_document")?;
                                if href.len() > 2048
                                    || !matches!(url.scheme(), "https" | "http" | "mailto")
                                {
                                    return Err("invalid_document".into());
                                }
                            }
                            _ => return Err("unsupported_document".into()),
                        }
                    }
                    self.parts
                        .push(node["text"].as_str().ok_or("invalid_document")?);
                }
                _ => return Err("unsupported_document".into()),
            }
        }
        Ok(())
    }
    fn blocks(
        &mut self,
        node: &'a Value,
        depth: usize,
        separator: &'static str,
    ) -> Result<(), String> {
        if depth > 12 {
            return Err("limit_exceeded".into());
        }
        let content = node["content"].as_array().ok_or("invalid_document")?;
        if content.is_empty() {
            return Err("invalid_document".into());
        }
        for (index, child) in content.iter().enumerate() {
            let child_kind = child["type"].as_str().ok_or("invalid_document")?;
            let allowed = match node["type"].as_str() {
                Some("table") => child_kind == "table_row",
                Some("table_row") => child_kind == "table_cell",
                Some("bullet_list" | "ordered_list") => child_kind == "list_item",
                _ => matches!(
                    child_kind,
                    "paragraph"
                        | "heading"
                        | "blockquote"
                        | "bullet_list"
                        | "ordered_list"
                        | "code_block"
                        | "horizontal_rule"
                        | "table"
                        | "image"
                ),
            };
            if !allowed {
                return Err("invalid_document".into());
            }
            if index > 0 {
                self.parts.push(separator);
            }
            self.block(child, depth + 1)?;
        }
        Ok(())
    }
    fn block(&mut self, node: &'a Value, depth: usize) -> Result<(), String> {
        self.identity(node)?;
        match node["type"].as_str() {
            Some("paragraph" | "heading") => {
                if node["type"] == "heading"
                    && !node["attrs"]["level"]
                        .as_u64()
                        .is_some_and(|n| (1..=6).contains(&n))
                {
                    return Err("invalid_document".into());
                }
                self.inline(&node["content"])?;
            }
            Some("blockquote" | "list_item" | "bullet_list" | "ordered_list") => {
                let kind = node["type"].as_str().unwrap();
                if matches!(kind, "bullet_list" | "ordered_list")
                    && node["content"]
                        .as_array()
                        .is_none_or(|v| v.iter().any(|n| n["type"] != "list_item"))
                {
                    return Err("invalid_document".into());
                }
                if kind == "ordered_list"
                    && !node["attrs"]["start"]
                        .as_u64()
                        .is_some_and(|n| n > 0 && n <= 1_000_000)
                {
                    return Err("invalid_document".into());
                }
                self.blocks(node, depth, "\n")?;
            }
            Some("table") => {
                if node["content"]
                    .as_array()
                    .is_none_or(|v| v.iter().any(|n| n["type"] != "table_row"))
                {
                    return Err("invalid_document".into());
                }
                if let Some(layout) = node["extensions"].get("komyaku.dialogue")
                    && !layout["actorWidth"]
                        .as_f64()
                        .is_some_and(|n| n.is_finite() && (16. ..=4096.).contains(&n))
                {
                    return Err("invalid_document".into());
                }
                self.blocks(node, depth, "\n")?;
            }
            Some("table_row") => {
                if node["content"]
                    .as_array()
                    .is_none_or(|v| v.len() > 64 || v.iter().any(|n| n["type"] != "table_cell"))
                {
                    return Err("invalid_document".into());
                }
                self.blocks(node, depth, "\t")?;
            }
            Some("table_cell") => {
                for key in ["colspan", "rowspan"] {
                    if !node["attrs"][key]
                        .as_u64()
                        .is_some_and(|n| (1..=64).contains(&n))
                    {
                        return Err("invalid_document".into());
                    }
                }
                self.blocks(node, depth, "\n")?;
            }
            Some("horizontal_rule") => (),
            Some("code_block") => self
                .parts
                .push(node["source"].as_str().ok_or("invalid_document")?),
            Some("image") => {
                node["assetId"]
                    .as_str()
                    .ok_or("invalid_document")?
                    .parse::<Id>()
                    .map_err(|_| "invalid_document")?;
                if !matches!(
                    node["mediaType"].as_str(),
                    Some("image/png" | "image/jpeg" | "image/webp")
                ) {
                    return Err("invalid_document".into());
                }
                self.parts
                    .push(node["altText"].as_str().ok_or("invalid_document")?);
                self.inline(&node["caption"])?;
            }
            _ => return Err("unsupported_document".into()),
        }
        Ok(())
    }
}
/// Plain text projection for export/search after bounded validation.
pub fn plain(node: &Value) -> String {
    match node["type"].as_str() {
        Some("text") => node["text"].as_str().unwrap_or("").into(),
        Some("hard_break") => "\n".into(),
        Some("code_block") => node["source"].as_str().unwrap_or("").into(),
        Some("image") => format!(
            "{}{}",
            node["altText"].as_str().unwrap_or(""),
            node["caption"]
                .as_array()
                .into_iter()
                .flatten()
                .map(plain)
                .collect::<String>()
        ),
        kind => {
            let separator = if matches!(kind, Some("paragraph" | "heading")) {
                ""
            } else if kind == Some("table_row") {
                "\t"
            } else {
                "\n"
            };
            node["content"]
                .as_array()
                .into_iter()
                .flatten()
                .map(plain)
                .collect::<Vec<_>>()
                .join(separator)
        }
    }
}

fn validate_assets(document: &Value) -> Result<(), String> {
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use std::sync::{Mutex, OnceLock};
    static CACHE: OnceLock<Mutex<BTreeSet<Vec<u8>>>> = OnceLock::new();
    let Some(assets) = document["extensions"].get("komyaku.images") else {
        return Ok(());
    };
    let assets = assets.as_object().ok_or("invalid_document")?;
    if assets.len() > 64 {
        return Err("limit_exceeded".into());
    }
    for (id, value) in assets {
        id.parse::<Id>().map_err(|_| "invalid_document")?;
        let data = value.as_str().ok_or("invalid_document")?;
        if data.len() > 12 * 1024 * 1024 {
            return Err("limit_exceeded".into());
        }
        let encoded = data
            .strip_prefix("data:image/png;base64,")
            .ok_or("invalid_document")?;
        let fingerprint = ring::digest::digest(&ring::digest::SHA256, data.as_bytes())
            .as_ref()
            .to_vec();
        let cache = CACHE.get_or_init(|| Mutex::new(BTreeSet::new()));
        if cache
            .lock()
            .map_err(|_| "state_unavailable")?
            .contains(&fingerprint)
        {
            continue;
        }
        let bytes = STANDARD.decode(encoded).map_err(|_| "invalid_document")?;
        if bytes.len() > 8 * 1024 * 1024 {
            return Err("limit_exceeded".into());
        }
        let mut reader =
            image::ImageReader::with_format(std::io::Cursor::new(bytes), image::ImageFormat::Png);
        let mut limits = image::Limits::default();
        limits.max_image_width = Some(1536);
        limits.max_image_height = Some(1536);
        limits.max_alloc = Some(16 * 1024 * 1024);
        reader.limits(limits);
        reader.decode().map_err(|_| "invalid_document")?;
        let mut known = cache.lock().map_err(|_| "state_unavailable")?;
        if known.len() >= 64 {
            known.clear();
        }
        known.insert(fingerprint);
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn formatting_preserves_borrowed_text_and_rejects_unsafe_links() {
        let mut doc = crate::domain::canonical("日本語😀", Id::new_v4(), Id::new_v4());
        doc["content"][0]["content"][0]["marks"] = json!([{"type":"bold"}]);
        assert_eq!(parts(&doc).unwrap().concat(), "日本語😀");
        doc["content"][0]["content"][0]["marks"] =
            json!([{"type":"link","href":"javascript:alert(1)"}]);
        assert!(parts(&doc).is_err());
    }
    #[test]
    fn nested_blocks_keep_separators_and_refuse_duplicate_identity() {
        let mut doc = crate::domain::canonical("first", Id::new_v4(), Id::new_v4());
        let mut paragraph = doc["content"][0].clone();
        paragraph["id"] = json!(Id::new_v4());
        paragraph["content"][0]["text"] = json!("second");
        doc["content"].as_array_mut().unwrap().push(
            json!({"id":Id::new_v4(),"schemaVersion":1,"type":"blockquote","content":[paragraph]}),
        );
        assert_eq!(parts(&doc).unwrap().concat(), "first\nsecond");
        doc["content"][1]["content"][0]["id"] = doc["content"][0]["id"].clone();
        assert!(parts(&doc).is_err());
    }
}
