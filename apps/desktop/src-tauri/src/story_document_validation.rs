//! Strict normalized Canonical validation. Image media declarations are opaque:
//! accepting their schema does not establish decoder or renderer support.
//! External-input normalization remains unsupported.
use serde_json::Value;
use std::collections::BTreeSet;
fn fields(value: &Value, names: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("invalid_story_document")?;
    if object.len() != names.len() || names.iter().any(|key| !object.contains_key(*key)) {
        return Err("invalid_story_document".into());
    }
    Ok(())
}
// Mirrors the shared Zod offset datetime contract, including optional seconds.
pub(crate) fn provenance_datetime(value: &str) -> bool {
    let bytes = value.as_bytes();
    if !value.is_ascii()
        || bytes.len() < 17
        || bytes.get(4) != Some(&b'-')
        || bytes.get(7) != Some(&b'-')
        || bytes.get(10) != Some(&b'T')
    {
        return false;
    }
    fn number(bytes: &[u8]) -> Option<u32> {
        if !bytes.iter().all(u8::is_ascii_digit) {
            return None;
        }
        Some(bytes.iter().fold(0, |n, c| n * 10 + u32::from(c - b'0')))
    }
    let (Some(year), Some(month), Some(day)) = (
        number(&bytes[..4]),
        number(&bytes[5..7]),
        number(&bytes[8..10]),
    ) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        _ => return false,
    };
    if day == 0 || day > days {
        return false;
    }
    let time = &bytes[11..];
    let clock = if time.last() == Some(&b'Z') {
        &time[..time.len() - 1]
    } else {
        if time.len() < 11 {
            return false;
        }
        let offset = &time[time.len() - 6..];
        if ![b'+', b'-'].contains(&offset[0])
            || offset[3] != b':'
            || !number(&offset[1..3]).is_some_and(|n| n <= 23)
            || !number(&offset[4..6]).is_some_and(|n| n <= 59)
        {
            return false;
        }
        &time[..time.len() - 6]
    };
    if clock.len() < 5
        || clock[2] != b':'
        || !number(&clock[..2]).is_some_and(|n| n <= 23)
        || !number(&clock[3..5]).is_some_and(|n| n <= 59)
    {
        return false;
    }
    if clock.len() == 5 {
        return true;
    }
    if clock.len() < 8 || clock[5] != b':' || !number(&clock[6..8]).is_some_and(|n| n <= 59) {
        return false;
    }
    clock.len() == 8
        || (clock.len() > 9 && clock[8] == b'.' && clock[9..].iter().all(u8::is_ascii_digit))
}

fn node_fields(value: &Value, names: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("invalid_story_document")?;
    let mut allowed = names.to_vec();
    if let Some(provenance) = object.get("provenance") {
        allowed.push("provenance");
        let provenance = provenance.as_object().ok_or("invalid_story_document")?;
        for (key, value) in provenance {
            let valid = match key.as_str() {
                "createdAt" => value.as_str().is_some_and(provenance_datetime),
                "createdBy" | "sourceNodeId" | "sourceVersionId" => {
                    value.as_str().is_some_and(super::valid_lower_uuid)
                }
                _ => false,
            };
            if !valid {
                return Err("invalid_story_document".into());
            }
        }
    }
    fields(value, &allowed)
}

fn language(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 100
            && s.as_bytes()[0].is_ascii_alphanumeric()
            && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
    })
}
fn metadata(value: &Value, extensions: bool) -> Result<(), String> {
    let object = value.as_object().ok_or("invalid_story_document")?;
    for key in object.keys() {
        if key.encode_utf16().count() > 200
            || (extensions
                && (key.is_empty()
                    || !key.as_bytes()[0].is_ascii_alphanumeric()
                    || !key
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))))
        {
            return Err("invalid_story_document".into());
        }
    }
    Ok(())
}

pub(crate) fn validate_document_subset(document: &Value) -> Result<BTreeSet<String>, String> {
    // Budget all JSON, including opaque metadata, before schema traversal.
    let mut pending = vec![(document, 0usize)];
    let mut count = 0;
    let mut strings = 0usize;
    while let Some((value, depth)) = pending.pop() {
        count += 1;
        if count > 500_000 || depth > 64 {
            return Err("story_document_limit_exceeded".into());
        }
        match value {
            Value::String(s) => strings += s.encode_utf16().count(),
            Value::Array(a) => pending.extend(a.iter().map(|v| (v, depth + 1))),
            Value::Object(o) => {
                for (k, v) in o {
                    if k.encode_utf16().count() > 200 {
                        return Err("invalid_story_document".into());
                    }
                    strings += k.encode_utf16().count();
                    pending.push((v, depth + 1));
                }
            }
            _ => {}
        }
        if strings > 10 * 1024 * 1024 {
            return Err("story_document_limit_exceeded".into());
        }
    }
    fields(
        document,
        &[
            "schemaId",
            "schemaVersion",
            "id",
            "type",
            "attrs",
            "content",
            "metadata",
            "extensions",
        ],
    )?;
    if document["schemaId"] != "https://komyaku.example/schemas/document/v1"
        || document["schemaVersion"] != 1
        || document["type"] != "document"
        || !document["id"].as_str().is_some_and(super::valid_lower_uuid)
    {
        return Err("invalid_story_document".into());
    }
    let attrs = &document["attrs"];
    fields(attrs, &["language", "direction", "writingMode"])?;
    if !language(&attrs["language"])
        || !["auto", "ltr", "rtl"].contains(&attrs["direction"].as_str().unwrap_or(""))
        || !["horizontal-tb", "vertical-rl", "vertical-lr"]
            .contains(&attrs["writingMode"].as_str().unwrap_or(""))
    {
        return Err("invalid_story_document".into());
    }
    metadata(&document["metadata"], false)?;
    metadata(&document["extensions"], true)?;
    let blocks = document["content"]
        .as_array()
        .ok_or("invalid_story_document")?;
    if blocks.is_empty() {
        return Err("invalid_story_document".into());
    }
    if blocks.len() > 100_000 {
        return Err("story_document_limit_exceeded".into());
    }
    let mut ids = BTreeSet::new();
    let mut pending: Vec<(&Value, &str, usize)> = blocks
        .iter()
        .rev()
        .map(|node| (node, "document", 1))
        .collect();
    let mut node_count = 0;
    while let Some((block, parent, depth)) = pending.pop() {
        node_count += 1;
        if node_count > 100_000 || depth > 64 {
            return Err("story_document_limit_exceeded".into());
        }
        let kind = block["type"].as_str().ok_or("invalid_story_document")?;
        let required_parent = match kind {
            "list_item" => Some(&["bullet_list", "ordered_list"][..]),
            "table_row" => Some(&["table"][..]),
            "table_cell" => Some(&["table_row"][..]),
            _ => None,
        };
        if required_parent.is_some_and(|parents| !parents.contains(&parent)) {
            return Err("invalid_node_parent".into());
        }
        if [
            "blockquote",
            "list_item",
            "bullet_list",
            "ordered_list",
            "table",
            "table_row",
            "table_cell",
        ]
        .contains(&kind)
        {
            validate_container(block, &mut ids, document["id"].as_str().unwrap())?;
            let children = block["content"]
                .as_array()
                .ok_or("invalid_story_document")?;
            if children.is_empty() {
                return Err("invalid_story_document".into());
            }
            let child_kind = match kind {
                "bullet_list" | "ordered_list" => Some("list_item"),
                "table" => Some("table_row"),
                "table_row" => Some("table_cell"),
                _ => None,
            };
            if child_kind
                .is_some_and(|required| children.iter().any(|child| child["type"] != required))
            {
                return Err("invalid_node_parent".into());
            }
            pending.extend(children.iter().rev().map(|child| (child, kind, depth + 1)));
            continue;
        }
        if [
            "code_block",
            "math_block",
            "file",
            "horizontal_rule",
            "image",
            "diagram",
        ]
        .contains(&kind)
        {
            validate_source_block(block, &mut ids, document["id"].as_str().unwrap())?;
            if let Some(caption) = block["caption"].as_array() {
                node_count += caption.len();
                if node_count > 100_000 || (!caption.is_empty() && depth >= 64) {
                    return Err("story_document_limit_exceeded".into());
                }
            }
            continue;
        }
        if !["paragraph", "heading"].contains(&kind) {
            return Err("unsupported_story_document_node".into());
        }
        node_fields(
            block,
            &[
                "id",
                "schemaVersion",
                "type",
                "attrs",
                "content",
                "metadata",
                "extensions",
                "renderArtifacts",
            ],
        )?;
        let id = block["id"]
            .as_str()
            .filter(|id| super::valid_lower_uuid(id))
            .ok_or("invalid_story_document")?;
        if id == document["id"].as_str().unwrap() || !ids.insert(id.to_string()) {
            return Err("duplicate_canonical_node_id".into());
        }
        if block["schemaVersion"] != 1 {
            return Err("unsupported_story_document_node".into());
        }
        validate_artifacts(&block["renderArtifacts"])?;
        metadata(&block["metadata"], false)?;
        metadata(&block["extensions"], true)?;
        let attrs = &block["attrs"];
        fields(
            attrs,
            if kind == "heading" {
                &["lang", "dir", "level"]
            } else {
                &["lang", "dir"]
            },
        )?;
        if (!attrs["lang"].is_null() && !language(&attrs["lang"]))
            || !["auto", "ltr", "rtl"].contains(&attrs["dir"].as_str().unwrap_or(""))
            || (kind == "heading"
                && !attrs["level"]
                    .as_i64()
                    .is_some_and(|n| (1..=6).contains(&n)))
        {
            return Err("invalid_story_document".into());
        }
        for inline in block["content"]
            .as_array()
            .ok_or("invalid_story_document")?
        {
            node_count += 1;
            if node_count > 100_000 || depth >= 64 {
                return Err("story_document_limit_exceeded".into());
            }
            validate_inline(inline, &mut ids, document["id"].as_str().unwrap())?;
        }
    }
    Ok(ids)
}

fn validate_inline(
    inline: &Value,
    ids: &mut BTreeSet<String>,
    document_id: &str,
) -> Result<(), String> {
    match inline["type"].as_str() {
        Some("hard_break") => fields(inline, &["type"]),
        Some("math_inline") => validate_source_block(inline, ids, document_id),
        Some("text") => {
            fields(inline, &["type", "text", "marks", "metadata", "extensions"])?;
            if !inline["text"].is_string() {
                return Err("invalid_story_document".into());
            }
            validate_marks(&inline["marks"])?;
            metadata(&inline["metadata"], false)?;
            metadata(&inline["extensions"], true)
        }
        _ => Err("unsupported_story_document_node".into()),
    }
}

fn safe_link(href: &str) -> bool {
    if href.starts_with('#') || href.starts_with("./") || href.starts_with("../") {
        return true;
    }
    if href.starts_with('/') && !href.starts_with("//") && !href.starts_with("/\\") {
        return true;
    }
    tauri::Url::parse(href).is_ok_and(|url| ["http", "https", "mailto"].contains(&url.scheme()))
}
fn validate_marks(value: &Value) -> Result<(), String> {
    let marks = value.as_array().ok_or("invalid_story_document")?;
    if marks.len() > 20 {
        return Err("invalid_story_document".into());
    }
    let mut keys = BTreeSet::new();
    for mark in marks {
        let kind = mark["type"].as_str().ok_or("invalid_story_document")?;
        let key = if kind == "link" {
            let object = mark.as_object().ok_or("invalid_story_document")?;
            if object
                .keys()
                .any(|key| !["type", "href", "title"].contains(&key.as_str()))
                || !object.contains_key("href")
            {
                return Err("invalid_story_document".into());
            }
            let href = mark["href"].as_str().ok_or("invalid_story_document")?;
            if !bounded_string(&mark["href"], 1, 2048, false)
                || !safe_link(href)
                || mark
                    .get("title")
                    .is_some_and(|title| !bounded_string(title, 0, 1000, true))
            {
                return Err("unsafe_story_document_link".into());
            }
            format!("link:{href}")
        } else {
            if !["bold", "italic", "underline", "strike", "code"].contains(&kind) {
                return Err("unsupported_story_document_mark".into());
            }
            fields(mark, &["type"])?;
            kind.to_string()
        };
        if !keys.insert(key) {
            return Err("duplicate_story_document_mark".into());
        }
    }
    Ok(())
}

fn validate_container(
    block: &Value,
    ids: &mut BTreeSet<String>,
    document_id: &str,
) -> Result<(), String> {
    let kind = block["type"].as_str().ok_or("invalid_story_document")?;
    let mut names = vec![
        "id",
        "schemaVersion",
        "type",
        "content",
        "metadata",
        "extensions",
        "renderArtifacts",
    ];
    if ["ordered_list", "table_cell"].contains(&kind) {
        names.push("attrs");
    }
    node_fields(block, &names)?;
    let id = block["id"]
        .as_str()
        .filter(|id| super::valid_lower_uuid(id))
        .ok_or("invalid_story_document")?;
    if id == document_id || !ids.insert(id.to_string()) {
        return Err("duplicate_canonical_node_id".into());
    }
    if block["schemaVersion"] != 1 {
        return Err("unsupported_story_document_node".into());
    }
    validate_artifacts(&block["renderArtifacts"])?;
    metadata(&block["metadata"], false)?;
    metadata(&block["extensions"], true)?;
    if kind == "ordered_list" {
        fields(&block["attrs"], &["start"])?;
        if !block["attrs"]["start"]
            .as_i64()
            .is_some_and(|n| (1..=1_000_000).contains(&n))
        {
            return Err("invalid_story_document".into());
        }
    }
    if kind == "table_cell" {
        fields(&block["attrs"], &["header", "colspan", "rowspan"])?;
        if !block["attrs"]["header"].is_boolean()
            || ["colspan", "rowspan"].iter().any(|key| {
                !block["attrs"][*key]
                    .as_i64()
                    .is_some_and(|n| (1..=100).contains(&n))
            })
        {
            return Err("invalid_story_document".into());
        }
    }
    Ok(())
}

fn bounded_string(value: &Value, min: usize, max: usize, nullable: bool) -> bool {
    (nullable && value.is_null())
        || value.as_str().is_some_and(|text| {
            let n = text.encode_utf16().count();
            n >= min && n <= max
        })
}
fn validate_artifacts(value: &Value) -> Result<(), String> {
    let artifacts = value.as_array().ok_or("invalid_story_document")?;
    if artifacts.len() > 20 {
        return Err("invalid_story_document".into());
    }
    for artifact in artifacts {
        let object = artifact.as_object().ok_or("invalid_story_document")?;
        if ["assetId", "role", "mediaType"]
            .iter()
            .any(|key| !object.contains_key(*key))
            || object.keys().any(|key| {
                ![
                    "assetId",
                    "role",
                    "mediaType",
                    "renderer",
                    "rendererVersion",
                    "sourceHash",
                ]
                .contains(&key.as_str())
            })
            || !artifact["assetId"]
                .as_str()
                .is_some_and(super::valid_lower_uuid)
            || !["preview", "thumbnail", "generated-pdf", "render-cache"]
                .contains(&artifact["role"].as_str().unwrap_or(""))
            || !bounded_string(&artifact["mediaType"], 1, 200, false)
        {
            return Err("invalid_story_document".into());
        }
        for (key, limit) in [("renderer", 200), ("rendererVersion", 100)] {
            if object.contains_key(key) && !bounded_string(&artifact[key], 1, limit, false) {
                return Err("invalid_story_document".into());
            }
        }
        if object.contains_key("sourceHash")
            && !artifact["sourceHash"].as_str().is_some_and(|hash| {
                hash.len() == 64
                    && hash
                        .bytes()
                        .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
            })
        {
            return Err("invalid_story_document".into());
        }
    }
    Ok(())
}

fn validate_source_block(
    block: &Value,
    ids: &mut BTreeSet<String>,
    document_id: &str,
) -> Result<(), String> {
    let kind = block["type"].as_str().ok_or("invalid_story_document")?;
    let mut names = vec![
        "id",
        "schemaVersion",
        "type",
        "metadata",
        "extensions",
        "renderArtifacts",
    ];
    match kind {
        "code_block" => names.extend(["language", "source"]),
        "math_block" => names.extend(["sourceType", "source", "displayMode"]),
        "math_inline" => names.extend(["sourceType", "source"]),
        "diagram" => names.extend(["sourceType", "source", "altText", "caption"]),
        "file" => names.extend(["assetId", "mediaType", "fileName", "title", "description"]),
        "image" => names.extend([
            "assetId",
            "mediaType",
            "altText",
            "caption",
            "width",
            "height",
        ]),
        "horizontal_rule" => {}
        _ => return Err("unsupported_story_document_node".into()),
    }
    node_fields(block, &names)?;
    let id = block["id"]
        .as_str()
        .filter(|id| super::valid_lower_uuid(id))
        .ok_or("invalid_story_document")?;
    if id == document_id || !ids.insert(id.to_string()) {
        return Err("duplicate_canonical_node_id".into());
    }
    if block["schemaVersion"] != 1 {
        return Err("unsupported_story_document_node".into());
    }
    validate_artifacts(&block["renderArtifacts"])?;
    metadata(&block["metadata"], false)?;
    metadata(&block["extensions"], true)?;
    if ["image", "diagram"].contains(&kind) {
        for inline in block["caption"]
            .as_array()
            .ok_or("invalid_story_document")?
        {
            validate_inline(inline, ids, document_id)?;
        }
    }
    let valid = match kind {
        "code_block" => {
            bounded_string(&block["language"], 1, 100, true) && block["source"].is_string()
        }
        "math_block" => {
            block["sourceType"] == "latex"
                && block["displayMode"] == "block"
                && block["source"].is_string()
        }
        "math_inline" => block["sourceType"] == "latex" && block["source"].is_string(),
        "diagram" => {
            ["mermaid", "svg"].contains(&block["sourceType"].as_str().unwrap_or(""))
                && block["source"].is_string()
                && bounded_string(&block["altText"], 0, 10_000, false)
        }
        "file" => {
            block["assetId"]
                .as_str()
                .is_some_and(super::valid_lower_uuid)
                && bounded_string(&block["mediaType"], 1, 200, false)
                && bounded_string(&block["fileName"], 1, 1000, false)
                && bounded_string(&block["title"], 0, 1000, true)
                && bounded_string(&block["description"], 0, 10_000, true)
        }
        "image" => {
            block["assetId"]
                .as_str()
                .is_some_and(super::valid_lower_uuid)
                && block["mediaType"].as_str().is_some_and(|media| {
                    media.strip_prefix("image/").is_some_and(|subtype| {
                        !subtype.is_empty()
                            && subtype
                                .bytes()
                                .all(|byte| byte.is_ascii_alphanumeric() || b".+-".contains(&byte))
                    })
                })
                && bounded_string(&block["altText"], 0, 10_000, false)
                && ["width", "height"].iter().all(|field| {
                    block[*field].is_null()
                        || block[*field]
                            .as_i64()
                            .is_some_and(|n| n > 0 && n <= 9_007_199_254_740_991)
                })
        }
        "horizontal_rule" => true,
        _ => false,
    };
    if !valid {
        return Err("invalid_story_document".into());
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;
    pub(crate) fn document() -> Value {
        json!({"schemaId":"https://komyaku.example/schemas/document/v1","schemaVersion":1,
        "id":"00000000-0000-4000-8000-000000000001","type":"document","attrs":{"language":"ja","direction":"auto","writingMode":"horizontal-tb"},
        "metadata":{},"extensions":{},"content":[{"id":"00000000-0000-4000-8000-000000000002","schemaVersion":1,"type":"paragraph","attrs":{"lang":null,"dir":"auto"},"content":[],"metadata":{},"extensions":{},"renderArtifacts":[]}]})
    }
    #[test]
    fn rejects_unsupported_and_invalid_fields() {
        let original = document();
        assert!(validate_document_subset(&original).is_ok());
        let mut value = original.clone();
        value["attrs"]["language"] = json!("");
        assert!(validate_document_subset(&value).is_err());
        value = original.clone();
        value["content"] = json!([{"type":"unknown-block"}]);
        assert_eq!(
            validate_document_subset(&value).unwrap_err(),
            "unsupported_story_document_node"
        );
        value = original.clone();
        value["extensions"] = json!({"bad key":true});
        assert!(validate_document_subset(&value).is_err());
    }
    #[test]
    fn preserves_source_and_file_nodes_and_rejects_identity_collisions() {
        let base = serde_json::json!({"id":"00000000-0000-4000-8000-000000000002","schemaVersion":1,"metadata":{},"extensions":{},"renderArtifacts":[]});
        for (kind, extra) in [
            (
                "code_block",
                json!({"language":null,"source":"<script>opaque source</script>"}),
            ),
            (
                "math_block",
                json!({"sourceType":"latex","displayMode":"block","source":"x^2"}),
            ),
            (
                "file",
                json!({"assetId":"00000000-0000-4000-8000-000000000003","mediaType":"text/plain","fileName":"資料.txt","title":null,"description":null}),
            ),
            ("horizontal_rule", json!({})),
        ] {
            let mut block = base.clone();
            block["type"] = json!(kind);
            block
                .as_object_mut()
                .unwrap()
                .extend(extra.as_object().unwrap().clone());
            let mut value = document();
            value["content"] = json!([block.clone()]);
            assert!(validate_document_subset(&value).is_ok(), "{kind}");
            value["content"] = json!([block.clone(), block.clone()]);
            assert_eq!(
                validate_document_subset(&value).unwrap_err(),
                "duplicate_canonical_node_id"
            );
            value["content"] = json!([block]);
            value["content"][0]["id"] = value["id"].clone();
            assert_eq!(
                validate_document_subset(&value).unwrap_err(),
                "duplicate_canonical_node_id"
            );
        }
    }
    #[test]
    fn validates_image_declarations_caption_and_dimensions_without_rendering() {
        let mut value = document();
        value["content"] = json!([{"id":"00000000-0000-4000-8000-000000000002","schemaVersion":1,"type":"image",
            "metadata":{},"extensions":{},"renderArtifacts":[],"assetId":"00000000-0000-4000-8000-000000000003",
            "mediaType":"image/png","altText":"画像の説明","caption":[{"type":"text","text":"説明","marks":[],"metadata":{},"extensions":{}}],"width":320,"height":null}]);
        assert!(validate_document_subset(&value).is_ok());
        for (field, bad) in [
            ("width", json!(0)),
            ("height", json!(1.5)),
            ("mediaType", json!("image/svg+xml; charset=utf-8")),
            ("caption", json!(null)),
        ] {
            let mut invalid = value.clone();
            invalid["content"][0][field] = bad;
            assert!(validate_document_subset(&invalid).is_err(), "{field}");
        }
    }
    #[test]
    fn validates_nested_tables_and_lists_without_implicit_repairs() {
        fn node(n: u32, kind: &str, children: Value) -> Value {
            json!({"id":format!("00000000-0000-4000-8000-{n:012x}"),"schemaVersion":1,"type":kind,"content":children,"metadata":{},"extensions":{},"renderArtifacts":[]})
        }
        let mut paragraph = node(5, "paragraph", json!([]));
        paragraph["attrs"] = json!({"lang":null,"dir":"auto"});
        let mut cell = node(4, "table_cell", json!([paragraph.clone()]));
        cell["attrs"] = json!({"header":false,"colspan":1,"rowspan":1});
        let row = node(3, "table_row", json!([cell.clone()]));
        let table = node(2, "table", json!([row]));
        let mut value = document();
        value["content"] = json!([table]);
        assert_eq!(validate_document_subset(&value).unwrap().len(), 4);
        let mut broken = value.clone();
        broken["content"][0]["content"][0]["content"][0]["attrs"]["colspan"] = json!(0);
        assert!(validate_document_subset(&broken).is_err());
        broken = document();
        broken["content"] = json!([cell]);
        assert_eq!(
            validate_document_subset(&broken).unwrap_err(),
            "invalid_node_parent"
        );
        let item = node(7, "list_item", json!([paragraph]));
        let list = node(6, "bullet_list", json!([item.clone()]));
        value = document();
        value["content"] = json!([list]);
        assert!(validate_document_subset(&value).is_ok());
        value["content"] = json!([item]);
        assert_eq!(
            validate_document_subset(&value).unwrap_err(),
            "invalid_node_parent"
        );
    }
    #[test]
    fn validates_marks_and_safe_link_schemes() {
        assert!(validate_marks(&json!([{"type":"bold"},{"type":"italic"},{"type":"link","href":"https://example.com","title":null}])).is_ok());
        assert_eq!(
            validate_marks(&json!([{"type":"bold"},{"type":"bold"}])).unwrap_err(),
            "duplicate_story_document_mark"
        );
        for href in [
            "javascript:alert(1)",
            "data:text/html,hi",
            "file:///tmp/x",
            "//example.com",
            "/\\example.com",
        ] {
            assert!(
                validate_marks(&json!([{"type":"link","href":href}])).is_err(),
                "{href}"
            );
        }
        for href in [
            "#scene",
            "./draft",
            "../draft",
            "/draft",
            "mailto:author@example.com",
            "https://example.com",
        ] {
            assert!(
                validate_marks(&json!([{"type":"link","href":href}])).is_ok(),
                "{href}"
            );
        }
        assert!(validate_marks(&json!([{"type":"bold","href":"https://example.com"}])).is_err());
    }
    #[test]
    fn validates_diagram_and_inline_math_ids_as_opaque_source() {
        let mut value = document();
        let math = json!({"id":"00000000-0000-4000-8000-000000000003","schemaVersion":1,"type":"math_inline","sourceType":"latex","source":"x^2","metadata":{},"extensions":{},"renderArtifacts":[]});
        let diagram = json!({"id":"00000000-0000-4000-8000-000000000002","schemaVersion":1,"type":"diagram","sourceType":"svg","source":"<svg><script>opaque</script></svg>","altText":"図","caption":[math.clone()],"metadata":{},"extensions":{},"renderArtifacts":[]});
        value["content"] = json!([diagram]);
        assert_eq!(validate_document_subset(&value).unwrap().len(), 2);
        let mut invalid = value.clone();
        invalid["content"][0]["sourceType"] = json!("html");
        assert!(validate_document_subset(&invalid).is_err());
        invalid = value.clone();
        invalid["content"][0]["caption"] = json!([math.clone(), math]);
        assert_eq!(
            validate_document_subset(&invalid).unwrap_err(),
            "duplicate_canonical_node_id"
        );
    }
    #[test]
    fn validates_render_artifact_contract() {
        let artifact = json!({"assetId":"00000000-0000-4000-8000-000000000009","role":"preview","mediaType":"image/png","renderer":"wgpu","sourceHash":"a".repeat(64)});
        let mut value = document();
        value["content"] = json!([{ "id":"00000000-0000-4000-8000-000000000002", "schemaVersion":1,"type":"horizontal_rule","metadata":{},"extensions":{},"renderArtifacts":[artifact.clone()]}]);
        assert!(validate_document_subset(&value).is_ok());
        for (key, bad) in [
            ("role", json!("unknown")),
            ("renderer", Value::Null),
            ("sourceHash", json!("A".repeat(64))),
            ("extra", json!(true)),
        ] {
            let mut invalid = artifact.clone();
            invalid[key] = bad;
            assert!(validate_artifacts(&json!([invalid])).is_err());
        }
        assert!(validate_artifacts(&json!(vec![artifact; 21])).is_err());
    }
    #[test]
    fn shared_normalized_conformance_corpus() {
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../../packages/document-schema/test/fixtures/native-conformance.json"
        ))
        .unwrap();
        for case in corpus.as_array().unwrap() {
            let result = validate_document_subset(&case["document"]);
            assert_eq!(
                result.is_ok(),
                case["valid"].as_bool().unwrap(),
                "{}: {:?}",
                case["name"],
                result
            );
        }
    }
}
