//! Export the Rust-owned manuscript; never collect text from mounted controls.
use crate::domain;
use pdf_writer::{Content, Finish, Name, Pdf, Rect, Ref};
use std::{
    collections::{BTreeSet, HashMap},
    io::Write,
    path::Path,
};
use unge_core::{Document, Id, Node};
use unicode_segmentation::UnicodeSegmentation;
#[path = "pdf_settings.rs"]
pub mod pdf_settings;
#[path = "script_pdf.rs"]
mod script_pdf;

#[derive(Clone, Copy)]
pub enum Format {
    Text,
    Markdown,
    Pdf,
    Script,
}
impl Format {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "txt" => Ok(Self::Text),
            "md" => Ok(Self::Markdown),
            "pdf" => Ok(Self::Pdf),
            "script" => Ok(Self::Script),
            _ => Err("invalid_command".into()),
        }
    }
    pub fn extension(self) -> &'static str {
        match self {
            Self::Text => "txt",
            Self::Markdown => "md",
            Self::Pdf | Self::Script => "pdf",
        }
    }
}
#[derive(Debug)]
enum Part {
    Heading(usize, String),
    Paragraph(String),
    Dialogue(String, String),
}
fn title(node: &Node) -> String {
    node.properties
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .replace(['\r', '\n'], " ")
}
fn children<'a>(document: &'a Document, parent: Option<Id>, kind: &str) -> Vec<&'a Node> {
    let parent = parent.map(|id| id.to_string());
    let mut nodes: Vec<_> = document
        .graph()
        .nodes()
        .values()
        .filter(|node| {
            node.type_id == kind
                && node
                    .properties
                    .get("parent")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    == parent.as_deref()
        })
        .collect();
    nodes.sort_by_key(|node| {
        (
            node.properties
                .get("outlineOrder")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            node.id,
        )
    });
    nodes
}
fn inline(node: &serde_json::Value) -> String {
    node["content"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v["text"].as_str())
        .collect()
}
#[derive(Default, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scope {
    pub node: Option<Id>,
    pub path: Option<String>,
}
fn append_scene(parts: &mut Vec<Part>, document: &Document, scene: &Node) -> Result<(), String> {
    parts.push(Part::Heading(4, title(scene)));
    let canonical = super::central_document::canonical(document, scene)?;
    domain::text(canonical)?;
    for node in canonical["content"].as_array().ok_or("invalid_document")? {
        if node["type"] == "paragraph" {
            parts.push(Part::Paragraph(inline(node)));
        } else {
            let cells = &node["content"][0]["content"];
            parts.push(Part::Dialogue(
                inline(&cells[0]["content"][0]),
                inline(&cells[1]["content"][0]),
            ));
        }
    }
    Ok(())
}
fn manuscript_scoped(document: &Document, scope: &Scope) -> Result<Vec<Part>, String> {
    let selected = scope
        .node
        .map(|id| document.graph().nodes().get(&id).ok_or("invalid_command"))
        .transpose()?;
    if selected.is_some_and(|n| {
        ![domain::BLOCK, domain::SEQUENCE, domain::SCENE].contains(&n.type_id.as_str())
    }) {
        return Err("invalid_command".into());
    }
    let route_ids = scope
        .path
        .as_deref()
        .map(|key| {
            domain::compile(document, key)
                .map(|route| route.into_iter().map(|n| n.0).collect::<BTreeSet<_>>())
        })
        .transpose()?;
    let mut included = BTreeSet::new();
    for scene in document
        .graph()
        .nodes()
        .values()
        .filter(|n| n.type_id == domain::SCENE)
    {
        let parent = scene
            .properties
            .get("parent")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<Id>().ok());
        let block = parent
            .and_then(|id| document.graph().nodes().get(&id))
            .and_then(|n| n.properties.get("parent"))
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<Id>().ok());
        if scope
            .node
            .is_none_or(|id| scene.id == id || parent == Some(id) || block == Some(id))
            && route_ids.as_ref().is_none_or(|ids| ids.contains(&scene.id))
        {
            included.insert(scene.id);
            included.extend(parent);
            included.extend(block);
        }
    }
    if let Some(node) = selected {
        included.insert(node.id);
        if let Some(parent) = node
            .properties
            .get("parent")
            .and_then(|v| v.as_str())
            .and_then(|s| s.parse::<Id>().ok())
        {
            included.insert(parent);
        }
    }
    if scope.node.is_none() && scope.path.is_none() {
        included.extend(document.graph().nodes().keys().copied());
    }

    let mut parts = vec![Part::Heading(1, document.title.replace(['\r', '\n'], " "))];
    if let Some(key) = &scope.path {
        let mut previous = (None, None);
        for (id, _, _) in domain::compile(document, key)? {
            if !included.contains(&id) {
                continue;
            }
            let scene = &document.graph().nodes()[&id];
            let sequence_id = scene.properties["parent"]
                .as_str()
                .and_then(|s| s.parse::<Id>().ok())
                .ok_or("invalid_document")?;
            let sequence = &document.graph().nodes()[&sequence_id];
            let block_id = sequence.properties["parent"]
                .as_str()
                .and_then(|s| s.parse::<Id>().ok())
                .ok_or("invalid_document")?;
            if previous.0 != Some(block_id) {
                parts.push(Part::Heading(
                    2,
                    title(&document.graph().nodes()[&block_id]),
                ));
            }
            if previous != (Some(block_id), Some(sequence_id)) {
                parts.push(Part::Heading(3, title(sequence)));
            }
            append_scene(&mut parts, document, scene)?;
            previous = (Some(block_id), Some(sequence_id));
        }
        return Ok(parts);
    }
    let mut visited = BTreeSet::new();
    for block in children(document, None, domain::BLOCK)
        .into_iter()
        .filter(|n| included.contains(&n.id))
    {
        visited.insert(block.id);
        parts.push(Part::Heading(2, title(block)));
        for sequence in children(document, Some(block.id), domain::SEQUENCE)
            .into_iter()
            .filter(|n| included.contains(&n.id))
        {
            visited.insert(sequence.id);
            parts.push(Part::Heading(3, title(sequence)));
            for scene in children(document, Some(sequence.id), domain::SCENE)
                .into_iter()
                .filter(|n| included.contains(&n.id))
            {
                visited.insert(scene.id);
                append_scene(&mut parts, document, scene)?;
            }
        }
    }
    if document.graph().nodes().values().any(|node| {
        [domain::BLOCK, domain::SEQUENCE, domain::SCENE].contains(&node.type_id.as_str())
            && included.contains(&node.id)
            && !visited.contains(&node.id)
    }) {
        return Err("invalid_command".into());
    }
    Ok(parts)
}
fn markdown(value: &str) -> String {
    let mut out = String::new();
    for c in value.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '\\' | '`' | '*' | '_' | '{' | '}' | '[' | ']' | '(' | ')' | '#' | '+' | '-' | '.'
            | '!' | '|' | '~' => {
                out.push('\\');
                out.push(c);
            }
            _ => out.push(c),
        }
    }
    out
}
fn normalized(value: &str) -> String {
    value.replace("\r\n", "\n").replace('\r', "\n")
}
fn serialize(parts: &[Part], md: bool, language: &str) -> String {
    let (actor, dialogue) = match language {
        "en" => ("Actor", "Dialogue"),
        "zh-CN" => ("角色", "台词"),
        _ => ("役者名", "セリフ"),
    };
    let mut out = String::new();
    for part in parts {
        let text = match part {
            Part::Heading(level, text) => {
                if md {
                    format!("{} {}", "#".repeat(*level), markdown(text))
                } else {
                    text.clone()
                }
            }
            Part::Paragraph(text) => {
                if md {
                    markdown(&normalized(text)).replace('\n', "  \n")
                } else {
                    normalized(text)
                }
            }
            Part::Dialogue(name, text) => {
                if md {
                    format!(
                        "| {actor} | {dialogue} |\n| --- | --- |\n| {} | {} |",
                        markdown(&normalized(name)).replace('\n', "<br>"),
                        markdown(&normalized(text)).replace('\n', "<br>")
                    )
                } else {
                    format!("{}\t{}", normalized(name), normalized(text))
                }
            }
        };
        out.push_str(&text);
        out.push_str("\n\n");
    }
    out
}
pub fn filename(title: &str, format: Format) -> String {
    let name: String = title
        .chars()
        .map(|c| {
            if c.is_control() || "/\\:*?\"<>|".contains(c) {
                '_'
            } else {
                c
            }
        })
        .take(100)
        .collect();
    let name = name.trim().trim_matches('.');
    format!(
        "{}{}.{}",
        if name.is_empty() { "manuscript" } else { name },
        if matches!(format, Format::Script) {
            "-script"
        } else {
            ""
        },
        format.extension()
    )
}
pub fn write(path: &Path, bytes: &[u8], format: Format) -> Result<(), String> {
    if path
        .extension()
        .and_then(|v| v.to_str())
        .is_none_or(|s| !s.eq_ignore_ascii_case(format.extension()))
    {
        return Err("export_extension_invalid".into());
    }
    let mut temporary = tempfile::NamedTempFile::new_in(path.parent().ok_or("export_failed")?)
        .map_err(|_| "export_failed")?;
    temporary
        .write_all(bytes)
        .and_then(|_| temporary.as_file().sync_all())
        .map_err(|_| "export_failed")?;
    temporary.persist(path).map_err(|_| "export_failed")?;
    Ok(())
}
#[cfg(test)]
pub fn bytes(document: &Document, format: Format, language: &str) -> Result<Vec<u8>, String> {
    bytes_scoped(document, format, language, &Scope::default())
}
#[cfg(test)]
pub fn bytes_scoped(
    document: &Document,
    format: Format,
    language: &str,
    scope: &Scope,
) -> Result<Vec<u8>, String> {
    bytes_configured(
        document,
        format,
        language,
        scope,
        &pdf_settings::Settings::default(),
    )
}
pub fn bytes_configured(
    document: &Document,
    format: Format,
    language: &str,
    scope: &Scope,
    settings: &pdf_settings::Settings,
) -> Result<Vec<u8>, String> {
    settings.validate()?;
    let mut parts = manuscript_scoped(document, scope)?;
    if let Some(Part::Heading(_, title)) = parts.first_mut()
        && title.trim().is_empty()
    {
        *title = match language {
            "en" => "Untitled work",
            "zh-CN" => "未命名作品",
            _ => "無題の作品",
        }
        .into();
    }
    match format {
        Format::Text => Ok(serialize(&parts, false, language).into_bytes()),
        Format::Markdown => Ok(serialize(&parts, true, language).into_bytes()),
        Format::Pdf => {
            if settings.writing_mode == "vertical" {
                script_pdf::standard(&parts, settings)
            } else {
                pdf_configured(&parts, settings)
            }
        }
        Format::Script => script_pdf::configured(&parts, settings),
    }
}
pub(super) fn xml(text: &str) -> String {
    text.chars()
        .filter(|c| *c == '\t' || *c == '\n' || *c == '\r' || *c >= ' ')
        .map(|c| match c {
            '&' => "&amp;".into(),
            '<' => "&lt;".into(),
            '>' => "&gt;".into(),
            '"' => "&quot;".into(),
            '\'' => "&apos;".into(),
            _ => c.to_string(),
        })
        .collect()
}
#[derive(Clone)]
struct Line {
    text: String,
    size: f32,
    heading: bool,
    actor: Option<String>,
    actor_width: f32,
}
fn wrap(text: &str, capacity: usize) -> Vec<String> {
    let mut lines = Vec::new();
    for row in normalized(text).replace('\t', "    ").split('\n') {
        let graphemes: Vec<_> = row.graphemes(true).collect();
        let mut start = 0;
        if graphemes.is_empty() {
            lines.push(String::new());
            continue;
        }
        while start < graphemes.len() {
            let mut end = (start + capacity.max(1)).min(graphemes.len());
            if end < graphemes.len() {
                if let Some(space) = (start..end).rev().find(|&i| {
                    graphemes[i].chars().all(char::is_whitespace) && i > start + capacity / 2
                }) {
                    end = space + 1;
                }
                while end > start + 1
                    && ("、。，．！？!?)]）］｝」』】〉》”’".contains(graphemes[end])
                        || "([（［｛「『【〈《“‘".contains(graphemes[end - 1]))
                {
                    end -= 1;
                }
            }
            lines.push(graphemes[start..end].concat());
            start = end;
        }
    }
    lines
}
#[cfg(test)]
fn pdf(parts: &[Part]) -> Result<Vec<u8>, String> {
    pdf_configured(parts, &pdf_settings::Settings::default())
}
fn pdf_configured(parts: &[Part], settings: &pdf_settings::Settings) -> Result<Vec<u8>, String> {
    let (width, height) = settings.dimensions();
    let margin = settings.margin();
    let usable = width - 2. * margin;
    let body_height = height - 2. * margin - 2. * settings.font_size - 20.;
    let body_font = settings.font_size;
    let mut pages: Vec<Vec<Line>> = vec![Vec::new()];
    let mut used = 0.0;
    for part in parts {
        let (text, size, heading) = match part {
            Part::Heading(level, text) => (
                text.clone(),
                match level {
                    1 => body_font * 2.,
                    2 => body_font * 1.5,
                    3 => body_font * 1.25,
                    _ => body_font * 1.0833,
                },
                true,
            ),
            Part::Paragraph(text) => (text.clone(), body_font, false),
            Part::Dialogue(actor, text) => (format!("{actor}    {text}"), body_font, false),
        };
        let actor_width = if let Part::Dialogue(actor, _) = part {
            normalized(actor)
                .split('\n')
                .map(|row| row.graphemes(true).count() as f32 * body_font)
                .fold(body_font, f32::max)
                .min(usable / 3.)
        } else {
            0.
        };
        let lines: Vec<_> = if let Part::Dialogue(actor, text) = part {
            let actors = wrap(actor, (actor_width / body_font) as usize);
            let dialogue = wrap(text, ((usable - actor_width - body_font) / size) as usize);
            (0..actors.len().max(dialogue.len()))
                .map(|i| {
                    (
                        dialogue.get(i).cloned().unwrap_or_default(),
                        actors.get(i).cloned(),
                    )
                })
                .collect()
        } else {
            wrap(&text, (usable / size) as usize)
                .into_iter()
                .map(|text| (text, None))
                .collect()
        };
        if heading && used + (lines.len() as f32 * size * 1.6) + 40. > body_height && used > 0. {
            pages.push(Vec::new());
            used = 0.;
        }
        for (text, actor) in lines {
            if used + size * 1.6 > body_height {
                pages.push(Vec::new());
                used = 0.;
            }
            pages.last_mut().unwrap().push(Line {
                text,
                size,
                heading,
                actor,
                actor_width,
            });
            used += size * 1.6;
        }
        if used + 10. < body_height {
            pages.last_mut().unwrap().push(Line {
                text: String::new(),
                size: 6.,
                heading: false,
                actor: None,
                actor_width: 0.,
            });
            used += 9.6;
        }
    }
    let mut svgs = Vec::new();
    for (index, lines) in pages.iter().enumerate() {
        let mut y = margin + body_font * 2.;
        let mut svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\"><g font-family=\"{}\" fill=\"#202631\">",
            settings.family()
        );
        for line in lines {
            let x = margin
                + if line.actor_width > 0. {
                    line.actor_width + body_font
                } else {
                    0.
                };
            if let Some(actor) = &line.actor {
                svg.push_str(&format!("<text x=\"{}\" y=\"{y}\" font-size=\"{body_font}\" text-anchor=\"end\" xml:space=\"preserve\">{}</text>",margin+line.actor_width,xml(actor)));
            }
            svg.push_str(&format!("<text x=\"{x}\" y=\"{y}\" font-size=\"{}\" font-weight=\"{}\" xml:space=\"preserve\">{}</text>",line.size,if line.heading{"bold"}else{"normal"},xml(&line.text)));
            y += line.size * 1.6;
        }
        svg.push_str(&format!("<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"9\" fill=\"#687180\">{} / {}</text></g></svg>",width/2.,height-margin/2.,index+1,pages.len()));
        svgs.push(svg);
    }
    svg_pdf(&svgs)
}
pub(super) fn svg_pdf(pages: &[String]) -> Result<Vec<u8>, String> {
    let mut options = svg2pdf::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    if options.fontdb.faces().next().is_none() {
        return Err("export_pdf_failed".into());
    }
    let mut alloc = Ref::new(1);
    let catalog = alloc.bump();
    let tree_id = alloc.bump();
    let mut pdf = Pdf::new();
    let mut page_ids = Vec::new();
    pdf.catalog(catalog).pages(tree_id);
    for svg in pages {
        let tree = svg2pdf::usvg::Tree::from_str(svg, &options).map_err(|_| "export_pdf_failed")?;
        let (chunk, xobject) = svg2pdf::to_chunk(
            &tree,
            svg2pdf::ConversionOptions {
                pdfa: true,
                ..Default::default()
            },
        )
        .map_err(|_| "export_pdf_failed")?;
        let mut mapping = HashMap::new();
        let chunk = chunk.renumber(|old| *mapping.entry(old).or_insert_with(|| alloc.bump()));
        let object = mapping[&xobject];
        let page_id = alloc.bump();
        let stream = alloc.bump();
        page_ids.push(page_id);
        let mut page = pdf.page(page_id);
        page.parent(tree_id)
            .media_box(Rect::new(0., 0., tree.size().width(), tree.size().height()))
            .contents(stream);
        page.resources()
            .x_objects()
            .pair(Name(b"Manuscript"), object);
        page.finish();
        let mut content = Content::new();
        content
            .transform([tree.size().width(), 0., 0., tree.size().height(), 0., 0.])
            .x_object(Name(b"Manuscript"));
        pdf.stream(stream, &content.finish());
        pdf.extend(&chunk);
    }
    pdf.pages(tree_id)
        .kids(page_ids.iter().copied())
        .count(page_ids.len() as i32);
    Ok(pdf.finish())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn scoped_exports_keep_structure_and_exclude_other_scenes() {
        let registry = domain::registry();
        let doc = domain::initial_document(&registry);
        let scene = doc
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap();
        let parts = manuscript_scoped(
            &doc,
            &Scope {
                node: Some(scene.id),
                path: None,
            },
        )
        .unwrap();
        let titles: Vec<_> = parts
            .iter()
            .filter_map(|p| {
                if let Part::Heading(4, title) = p {
                    Some(title)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(titles, vec![&title(scene)]);
        let route = manuscript_scoped(
            &doc,
            &Scope {
                node: None,
                path: Some("main".into()),
            },
        )
        .unwrap();
        let titles: Vec<_> = route
            .iter()
            .filter_map(|p| {
                if let Part::Heading(4, title) = p {
                    Some(title.clone())
                } else {
                    None
                }
            })
            .collect();
        for scene in doc
            .graph()
            .nodes()
            .values()
            .filter(|n| n.type_id == domain::SCENE)
        {
            let path = scene
                .properties
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("main");
            assert_eq!(
                titles.contains(&title(scene)),
                path == "main" || path == "both"
            );
        }
        assert!(
            manuscript_scoped(
                &doc,
                &Scope {
                    node: Some(Id::new_v4()),
                    path: None
                }
            )
            .is_err()
        );
        assert!(
            manuscript_scoped(
                &doc,
                &Scope {
                    node: None,
                    path: Some("unknown".into())
                }
            )
            .is_err()
        );
    }
    #[test]
    fn formats_preserve_unicode_dialogue_and_literal_markdown() {
        let parts = vec![
            Part::Heading(1, "作品 #1".into()),
            Part::Paragraph("*本文*\r\n中文 🌕".into()),
            Part::Dialogue("坂本".into(), "一行目\n二行目 | <tag>".into()),
        ];
        let txt = serialize(&parts, false, "ja");
        assert!(txt.contains("*本文*\n中文 🌕"));
        assert!(txt.contains("坂本\t一行目\n二行目"));
        let md = serialize(&parts, true, "ja");
        assert!(md.starts_with("# 作品 \\#1"));
        assert!(md.contains("\\*本文\\*  \n中文 🌕"));
        assert!(md.contains("一行目<br>二行目 \\| &lt;tag&gt;"));
        assert!(serialize(&parts, true, "en").contains("| Actor | Dialogue |"));
        assert!(serialize(&parts, true, "zh-CN").contains("| 角色 | 台词 |"));
        assert_eq!(filename("../作品/名前", Format::Pdf), "_作品_名前.pdf");
        assert_eq!(wrap("🌕e\u{301}雨", 2), vec!["🌕e\u{301}", "雨"]);
    }
    #[test]
    fn atomic_export_validates_extension_and_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("work.txt");
        std::fs::write(&path, "old").unwrap();
        write(&path, "日本語".as_bytes(), Format::Text).unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), "日本語");
        let wrong = dir.path().join("workspace.story.json");
        assert!(write(&wrong, b"new", Format::Text).is_err());
        assert!(!wrong.exists());
    }
    #[test]
    fn structural_export_includes_alternatives_in_outline_order_and_omits_notes() {
        use unge_core::{Command, Editor};
        let registry = domain::registry();
        let mut editor = Editor::new(domain::initial_document(&registry), 256).unwrap();
        let id = editor
            .document()
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap()
            .id;
        editor
            .execute(Command::SetProperty {
                id,
                key: "notes".into(),
                value: Some(serde_json::json!("PRIVATE NOTE")),
            })
            .unwrap();
        let txt = String::from_utf8(bytes(editor.document(), Format::Text, "ja").unwrap()).unwrap();
        let headings = [
            "雨の駅から",
            "手紙の物語",
            "起 · 雨の駅",
            "承 · 手紙を開く",
            "承 · 手紙を隠す",
            "転 · 記憶の場所",
            "結 · 新しい朝",
        ];
        let offsets: Vec<_> = headings.iter().map(|h| txt.find(h).unwrap()).collect();
        assert!(offsets.windows(2).all(|p| p[0] < p[1]));
        assert!(!txt.contains("PRIVATE NOTE"));
        editor
            .execute(Command::SetProperty {
                id,
                key: "parent".into(),
                value: Some(serde_json::json!(Id::new_v4().to_string())),
            })
            .unwrap();
        assert!(bytes(editor.document(), Format::Text, "ja").is_err());
        let empty = domain::blank_document(&registry, "ja").unwrap();
        assert!(!bytes(&empty, Format::Markdown, "ja").unwrap().is_empty());
        assert!(Format::parse("html").is_err());
    }
    #[test]
    #[ignore = "Creates an isolated PDF for visual QA; requires system fonts"]
    fn pdf_fixture_for_visual_qa() {
        let parts=vec![Part::Heading(1,"雨の駅 — Story / 故事".into()),Part::Heading(2,"第一部　残された手紙".into()),Part::Heading(3,"シーケンス　再会".into()),Part::Heading(4,"シーン　雨の駅".into()),Part::Paragraph("終電が去った駅で、灯は差出人のない手紙を拾った。\nThe last train had left. 灯在车站捡到一封没有署名的信。".into()),Part::Dialogue("坂本".into(),"今日の駅は寒いですね。\n手紙を見せてもらえますか？".into()),Part::Paragraph("封筒には、十年前に消えた兄の筆跡があった。".repeat(180)),Part::Heading(4,"シーン　朝の光".into()),Part::Paragraph("終わり。The end. 完。".into())];
        let bytes = pdf(&parts).unwrap();
        let parsed = lopdf::Document::load_mem(&bytes).unwrap();
        assert!(parsed.get_pages().len() > 2);
        assert!(
            parsed
                .objects
                .values()
                .any(|object| object.as_dict().is_ok_and(|dict| dict.has(b"ToUnicode")))
        );
        std::fs::write(
            std::env::var("STORY_GRAPH_EXPORT_QA_OUTPUT").expect("QA output path"),
            bytes,
        )
        .unwrap();
    }
}
