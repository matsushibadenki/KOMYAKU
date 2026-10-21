//! Local Aozora text import with semantic ruby and preserved unknown annotations.
use serde_json::json;
use std::{io::Read, path::Path};
use unge_core::{Command, Document, Editor, Id};
const LIMIT: u64 = 8 * 1024 * 1024;

pub fn read(
    path: &Path,
    registry: &unge_executor::Registry,
    language: &str,
) -> Result<Document, String> {
    if !path
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("txt"))
    {
        return Err("aozora_invalid".into());
    }
    let file = std::fs::File::open(path).map_err(|_| "aozora_invalid")?;
    if !file.metadata().map_err(|_| "aozora_invalid")?.is_file() {
        return Err("aozora_invalid".into());
    }
    let mut bytes = Vec::new();
    file.take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "aozora_invalid")?;
    if bytes.len() as u64 > LIMIT {
        return Err("limit_exceeded".into());
    }
    let text = decode(&bytes)?;
    document(&text, registry, language)
}
fn decode(bytes: &[u8]) -> Result<String, String> {
    if bytes.contains(&0) {
        return Err("aozora_invalid".into());
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(text.trim_start_matches('\u{feff}').into());
    }
    let (text, errors) = encoding_rs::SHIFT_JIS.decode_without_bom_handling(bytes);
    if errors {
        return Err("aozora_encoding".into());
    }
    Ok(text.into_owned())
}
fn parse(text: &str) -> Result<(String, String, String), String> {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    if normalized
        .chars()
        .any(|c| c.is_control() && c != '\n' && c != '\t')
    {
        return Err("aozora_invalid".into());
    }
    let lines: Vec<_> = normalized.lines().collect();
    let first = lines
        .iter()
        .position(|line| !line.trim().is_empty())
        .ok_or("aozora_invalid")?;
    let title = lines[first].trim();
    if title.chars().count() > 200 {
        return Err("aozora_invalid".into());
    }
    // Only remove the standard explanatory header enclosed by dashed rules.
    // Without it, retain the entire file (including the title/author) as body.
    let rule = |line: &&str| line.len() >= 20 && line.chars().all(|c| c == '-');
    let mut body_start = first;
    let mut header = String::new();
    if let Some(open) = lines
        .iter()
        .enumerate()
        .skip(first + 1)
        .take(20)
        .find(|(_, l)| rule(l))
        .map(|(i, _)| i)
        && let Some(close) = lines
            .iter()
            .enumerate()
            .skip(open + 1)
            .take(100)
            .find(|(_, l)| rule(l))
            .map(|(i, _)| i)
        && lines[open + 1..close]
            .iter()
            .any(|l| l.contains("テキスト中に現れる記号"))
    {
        body_start = close + 1;
        header = lines[..body_start].join("\n");
    }
    // Preserve the original provenance, including bottom edition and credits.
    let footer = lines
        .iter()
        .enumerate()
        .skip(body_start)
        .find(|(_, l)| l.starts_with("底本："))
        .map(|(i, _)| i)
        .unwrap_or(lines.len());
    let body = lines[body_start..footer].join("\n");
    if body.trim().is_empty() {
        return Err("aozora_invalid".into());
    }
    let memo = [header, lines[footer..].join("\n")]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join("\n\n");
    Ok((title.into(), body, memo))
}
fn kanji(c: char) -> bool {
    matches!(c, '々' | '〆' | '〇')
        || ('\u{3400}'..='\u{9fff}').contains(&c)
        || ('\u{f900}'..='\u{faff}').contains(&c)
        || ('\u{20000}'..='\u{323af}').contains(&c)
}
fn ruby_content(text: &str) -> Vec<serde_json::Value> {
    let mut out = Vec::new();
    let mut plain = String::new();
    let mut rest = text;
    let node = |text: String, marks: serde_json::Value| json!({"type":"text","text":text,"marks":marks,"metadata":{},"extensions":{}});
    while let Some(open) = rest.find('《') {
        plain.push_str(&rest[..open]);
        rest = &rest[open + '《'.len_utf8()..];
        let Some(close) = rest.find('》') else {
            plain.push('《');
            plain.push_str(rest);
            rest = "";
            break;
        };
        let reading = &rest[..close];
        let explicit = plain.rfind('｜').filter(|index| {
            !plain[index + '｜'.len_utf8()..].contains(['\n', '\r'])
                && plain.len() > index + '｜'.len_utf8()
        });
        let start = explicit.map(|index| index + '｜'.len_utf8()).or_else(|| {
            plain
                .char_indices()
                .rev()
                .take_while(|(_, c)| kanji(*c))
                .last()
                .map(|(i, _)| i)
        });
        if !reading.is_empty()
            && reading.encode_utf16().count() <= 256
            && !reading.chars().any(|c| c.is_control())
            && let Some(start) = start
        {
            let base = plain[start..].to_string();
            let prefix = explicit.unwrap_or(start);
            plain.truncate(prefix);
            if !plain.is_empty() {
                out.push(node(std::mem::take(&mut plain), json!([])));
            }
            out.push(node(base, json!([{"type":"ruby","reading":reading}])));
        } else {
            plain.push('《');
            plain.push_str(reading);
            plain.push('》');
        }
        rest = &rest[close + '》'.len_utf8()..];
    }
    plain.push_str(rest);
    if !plain.is_empty() {
        out.push(node(plain, json!([])));
    }
    out
}
fn document(
    text: &str,
    registry: &unge_executor::Registry,
    language: &str,
) -> Result<Document, String> {
    let (title, body, memo) = parse(text)?;
    if memo.chars().count() > 16000 {
        return Err("limit_exceeded".into());
    }
    let mut doc =
        super::domain::blank_document(registry, language).map_err(|_| "aozora_invalid")?;
    doc.title = title.clone();
    let ids: Vec<_> = doc
        .graph()
        .nodes()
        .values()
        .map(|n| (n.id, n.type_id.clone()))
        .collect();
    let mut editor = Editor::new(doc, 256).map_err(|_| "aozora_invalid")?;
    for (id, kind) in ids {
        if kind == super::domain::BLOCK || kind == super::domain::SCENE {
            editor
                .execute(Command::SetProperty {
                    id,
                    key: "title".into(),
                    value: Some(json!(title)),
                })
                .map_err(|_| "aozora_invalid")?;
        }
        if kind == super::domain::SCENE {
            for (key, value) in [
                ("canonical", {
                    let mut canonical = super::domain::canonical("", Id::new_v4(), Id::new_v4());
                    canonical["content"][0]["content"] = json!(ruby_content(&body));
                    canonical
                }),
                ("notes", json!(memo)),
            ] {
                editor
                    .execute(Command::SetProperty {
                        id,
                        key: key.into(),
                        value: Some(value),
                    })
                    .map_err(|_| "aozora_invalid")?;
            }
        }
    }
    registry
        .validate_edit(editor.document().graph())
        .map_err(|_| "aozora_invalid")?;
    Ok(editor.document().clone())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ruby_forms_keep_base_reading_and_unknown_notation() {
        let nodes = ruby_content("漢字《かんじ》と｜青い空《あおいそら》。かな《literal》、未完《");
        let base = nodes
            .iter()
            .map(|n| n["text"].as_str().unwrap())
            .collect::<String>();
        assert_eq!(base, "漢字と青い空。かな《literal》、未完《");
        assert_eq!(nodes[0]["marks"][0]["reading"], "かんじ");
        assert!(
            nodes
                .iter()
                .any(|n| n["text"] == "青い空" && n["marks"][0]["reading"] == "あおいそら")
        );
        assert_eq!(
            ruby_content("｜途中\n漢字《かんじ》")
                .iter()
                .map(|n| n["text"].as_str().unwrap())
                .collect::<String>(),
            "｜途中\n漢字"
        );
    }
    #[test]
    fn imported_work_validates_saves_and_retains_notes() {
        let registry = super::super::domain::registry();
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("book.txt");
        let source = "題\n作者\n\n--------------------\n【テキスト中に現れる記号について】\n--------------------\n　漢字《かんじ》。\n\n底本：底本\n入力：入力者";
        std::fs::write(&path, source).unwrap();
        let doc = read(&path, &registry, "ja").unwrap();
        use unge_core::DocumentValidator;
        super::super::domain::Validator(registry)
            .validate(&doc)
            .unwrap();
        let scene = doc
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == super::super::domain::SCENE)
            .unwrap();
        assert!(
            super::super::domain::text(&scene.properties["canonical"])
                .unwrap()
                .contains("　漢字。")
        );
        assert!(
            scene.properties["notes"]
                .as_str()
                .unwrap()
                .contains("入力：入力者")
        );
        let snapshot = temp.path().join("snapshot.json");
        super::super::save(&snapshot, &doc).unwrap();
        assert_eq!(
            super::super::load(&snapshot).unwrap().to_json().unwrap(),
            doc.to_json().unwrap()
        );
        assert_eq!(std::fs::read_to_string(path).unwrap(), source);
    }
    #[test]
    fn encoding_and_provenance_are_preserved() {
        let source = "作品\r\n作者\r\n\r\n--------------------\r\n【テキスト中に現れる記号について】\r\n《》：ルビ\r\n--------------------\r\n\r\n　｜青空《あおぞら》［＃傍点］。\r\n\r\n底本：原典\r\n入力：入力者";
        let (encoded, _, errors) = encoding_rs::SHIFT_JIS.encode(source);
        assert!(!errors);
        let text = decode(&encoded).unwrap();
        let (title, body, memo) = parse(&text).unwrap();
        assert_eq!(title, "作品");
        assert!(body.contains("　｜青空《あおぞら》［＃傍点］。"));
        assert!(!body.contains("テキスト中"));
        assert!(memo.contains("作者"));
        assert!(memo.contains("底本：原典"));
        assert!(memo.contains("入力：入力者"));
        assert_eq!(decode("\u{feff}題\n😀".as_bytes()).unwrap(), "題\n😀");
        assert!(decode(&[0x81]).is_err());
        assert!(decode(b"a\0b").is_err());
    }
    #[test]
    fn ordinary_rules_and_unknown_annotations_are_not_removed() {
        let text = "題\n著者\n--------------------\n本文\n--------------------\n※［＃外字］";
        assert_eq!(parse(text).unwrap().1, text);
        assert!(parse(" \n").is_err());
    }
}
