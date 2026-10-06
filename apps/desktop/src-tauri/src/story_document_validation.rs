//! Strict normalized Canonical subset with prose, code, block math and files.
//! Other rich blocks/marks/artifacts/provenance fail closed until implemented.
use serde_json::Value;
use std::collections::BTreeSet;
fn fields(value: &Value, names: &[&str]) -> Result<(), String> {
    let object = value.as_object().ok_or("invalid_story_document")?;
    if object.len() != names.len() || names.iter().any(|key| !object.contains_key(*key)) {
        return Err("invalid_story_document".into());
    }
    Ok(())
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
    if blocks.len() > 100_000 {
        return Err("story_document_limit_exceeded".into());
    }
    let mut ids = BTreeSet::new();
    for block in blocks {
        let kind = block["type"].as_str().ok_or("invalid_story_document")?;
        if ["code_block", "math_block", "file", "horizontal_rule"].contains(&kind) {
            validate_source_block(block, &mut ids, document["id"].as_str().unwrap())?;
            continue;
        }
        if !["paragraph", "heading"].contains(&kind) {
            return Err("unsupported_story_document_node".into());
        }
        fields(
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
        if block["schemaVersion"] != 1 || block["renderArtifacts"] != serde_json::json!([]) {
            return Err("unsupported_story_document_node".into());
        }
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
            if inline["type"] == "hard_break" {
                fields(inline, &["type"])?;
                continue;
            }
            if inline["type"] != "text" {
                return Err("unsupported_story_document_node".into());
            }
            fields(inline, &["type", "text", "marks", "metadata", "extensions"])?;
            if !inline["text"].is_string() || inline["marks"] != serde_json::json!([]) {
                return Err("unsupported_story_document_node".into());
            }
            metadata(&inline["metadata"], false)?;
            metadata(&inline["extensions"], true)?;
        }
    }
    Ok(ids)
}

fn bounded_string(value: &Value, min: usize, max: usize, nullable: bool) -> bool {
    (nullable && value.is_null())
        || value.as_str().is_some_and(|text| {
            let n = text.encode_utf16().count();
            n >= min && n <= max
        })
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
        "file" => names.extend(["assetId", "mediaType", "fileName", "title", "description"]),
        "horizontal_rule" => {}
        _ => return Err("unsupported_story_document_node".into()),
    }
    fields(block, &names)?;
    let id = block["id"]
        .as_str()
        .filter(|id| super::valid_lower_uuid(id))
        .ok_or("invalid_story_document")?;
    if id == document_id || !ids.insert(id.to_string()) {
        return Err("duplicate_canonical_node_id".into());
    }
    if block["schemaVersion"] != 1 || block["renderArtifacts"] != serde_json::json!([]) {
        return Err("unsupported_story_document_node".into());
    }
    metadata(&block["metadata"], false)?;
    metadata(&block["extensions"], true)?;
    let valid = match kind {
        "code_block" => {
            bounded_string(&block["language"], 1, 100, true) && block["source"].is_string()
        }
        "math_block" => {
            block["sourceType"] == "latex"
                && block["displayMode"] == "block"
                && block["source"].is_string()
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
        "horizontal_rule" => true,
        _ => false,
    };
    if !valid {
        return Err("invalid_story_document".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    pub(crate) fn document() -> Value {
        json!({"schemaId":"https://komyaku.example/schemas/document/v1","schemaVersion":1,
        "id":"00000000-0000-4000-8000-000000000001","type":"document","attrs":{"language":"ja","direction":"auto","writingMode":"horizontal-tb"},
        "metadata":{},"extensions":{},"content":[]})
    }
    #[test]
    fn rejects_unsupported_and_invalid_fields() {
        let original = document();
        assert!(validate_document_subset(&original).is_ok());
        let mut value = original.clone();
        value["attrs"]["language"] = json!("");
        assert!(validate_document_subset(&value).is_err());
        value = original.clone();
        value["content"] = json!([{"type":"image"}]);
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
}
