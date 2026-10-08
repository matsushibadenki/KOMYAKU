//! Portrait screenplay layout. Scene frames and prose share the same column flow.
use super::{Part, normalized, pdf_settings::Settings, render_parts, svg_pdf, xml};
use unicode_segmentation::UnicodeSegmentation;
#[path = "vertical_glyphs.rs"]
mod vertical_glyphs;

#[cfg(test)]
const LEFT: f32 = 36.;
#[cfg(test)]
const RIGHT: f32 = 559.;
#[cfg(test)]
const BOTTOM: f32 = 786.;
#[cfg(test)]
const TEXT_TOP: f32 = 307.;
#[cfg(test)]
const FONT: f32 = 12.;
#[cfg(test)]
const ADVANCE: f32 = 13.;
#[cfg(test)]
const PITCH: f32 = 24.;
#[cfg(test)]
const FRAME_GAP: f32 = 1.5 * FONT;
#[cfg(test)]
const STAGE_INDENT: f32 = 6. * ADVANCE;

struct Layout {
    left: f32,
    right: f32,
    rule: f32,
    frame_top: f32,
    bottom: f32,
    text_top: f32,
    font: f32,
    advance: f32,
    pitch: f32,
    frame_gap: f32,
    stage_indent: f32,
    width: f32,
    height: f32,
}
impl Layout {
    fn new(s: &Settings) -> Self {
        let (width, height) = s.dimensions();
        let font = s.font_size;
        let rule = (height * s.script_rule).round();
        Self {
            left: s.margin(),
            right: width - s.margin(),
            rule,
            frame_top: rule - 3.5 * font,
            bottom: height - s.margin() - 20.,
            text_top: rule + 26.,
            font,
            advance: font + 1.,
            pitch: font * 2.,
            frame_gap: 1.5 * font,
            stage_indent: s.script_indent * (font + 1.),
            width,
            height,
        }
    }
}
#[derive(Debug)]
enum Item {
    Image {
        caption: String,
        data: String,
        width: f32,
        height: f32,
    },
    Scene {
        number: usize,
        title: String,
    },
    Text {
        text: String,
        stage: bool,
        actor_length: usize,
    },
}
#[derive(Debug)]
enum Column {
    Image {
        x: f32,
        top: f32,
        data: String,
        width: f32,
        height: f32,
    },
    Frame {
        right: f32,
        width: f32,
        number: usize,
        titles: Vec<String>,
    },
    Body {
        x: f32,
        top: f32,
        text: String,
    },
}
fn items(parts: &[Part]) -> Vec<Item> {
    let mut number = 0;
    render_parts(parts)
        .into_iter()
        .filter_map(|part| match part {
            Part::Heading(4, title) => {
                number += 1;
                Some(Item::Scene {
                    number,
                    title: title.clone(),
                })
            }
            Part::Image(caption, _, data, width, height) if !data.is_empty() => Some(Item::Image {
                caption: caption.clone(),
                data: data.clone(),
                width: *width,
                height: *height,
            }),
            Part::Paragraph(text)
            | Part::RichHeading(_, text, _)
            | Part::Rich(text, _)
            | Part::RichContainer(text, _, _)
            | Part::Image(text, _, _, _, _) => Some(Item::Text {
                text: text.clone(),
                stage: true,
                actor_length: 0,
            }),
            Part::Dialogue(actor, text) | Part::RichDialogue(actor, text, _) => Some(Item::Text {
                text: format!("{}「{}」", normalized(actor).replace('\n', "　"), text),
                stage: false,
                actor_length: normalized(actor)
                    .replace('\n', "　")
                    .graphemes(true)
                    .count(),
            }),
            _ => None,
        })
        .collect()
}
fn wrap(text: &str, capacity: usize) -> Vec<String> {
    let mut result = Vec::new();
    for line in normalized(text).split('\n') {
        let cells = vertical_glyphs::vertical_cells(line);
        if cells.is_empty() {
            result.push(String::new());
            continue;
        }
        let mut start = 0;
        while start < cells.len() {
            let mut end = (start + capacity.max(1)).min(cells.len());
            if end < cells.len() {
                while end > start + 1
                    && ("、。，．！？!?)]）］｝」』】〉》”’".contains(cells[end])
                        || "([（［｛「『【〈《“‘".contains(cells[end - 1]))
                {
                    end -= 1;
                }
            }
            result.push(cells[start..end].concat());
            start = end;
        }
    }
    result
}
fn capacity(top: f32, l: &Layout) -> usize {
    ((l.bottom - top - l.font) / l.advance).floor() as usize + 1
}
#[cfg(test)]
fn layout(parts: &[Part]) -> Vec<Vec<Column>> {
    layout_configured(parts, &Layout::new(&Settings::default()))
}
fn layout_configured(parts: &[Part], l: &Layout) -> Vec<Vec<Column>> {
    let mut pages = vec![Vec::new()];
    let mut cursor = l.right;
    for item in items(parts) {
        match item {
            Item::Image {
                caption,
                data,
                width,
                height,
            } => {
                let scale = ((l.right - l.left) / width.max(1.))
                    .min((l.bottom - l.text_top) / height.max(1.))
                    .min(1.);
                let (width, height) = (width * scale, height * scale);
                if cursor - width < l.left {
                    pages.push(Vec::new());
                    cursor = l.right;
                }
                pages.last_mut().unwrap().push(Column::Image {
                    x: cursor - width,
                    top: l.text_top,
                    data,
                    width,
                    height,
                });
                cursor -= width + l.frame_gap;
                if !caption.is_empty() {
                    let top = l.text_top + l.stage_indent;
                    for text in wrap(&caption, capacity(top, l)) {
                        if cursor - l.pitch < l.left {
                            pages.push(Vec::new());
                            cursor = l.right;
                        }
                        pages.last_mut().unwrap().push(Column::Body {
                            x: cursor - l.pitch / 2.,
                            top,
                            text,
                        });
                        cursor -= l.pitch;
                    }
                }
            }
            Item::Scene { number, title } => {
                let titles = wrap(&title, capacity(l.text_top, l));
                let width = l.pitch * titles.len() as f32 + l.font;
                // cursor is half a column beyond the preceding text centre.
                // Measure both frame gaps from the full-width glyph cell edge.
                let before = l.frame_gap - (l.pitch - l.font) / 2.;
                let after = l.frame_gap + l.font / 2. - l.pitch / 2.;
                if cursor - before - width - after - l.pitch < l.left && cursor < l.right {
                    pages.push(Vec::new());
                    cursor = l.right;
                }
                // A pathological long title gets additional bounded frames;
                // its scene number is kept, and no text is truncated.
                let max_title_columns =
                    ((l.right - l.left - l.pitch - l.font - after) / l.pitch).floor() as usize;
                for chunk in titles.chunks(max_title_columns.max(1)) {
                    let width = l.pitch * chunk.len() as f32 + l.font;
                    let before = match pages.last().unwrap().last() {
                        None => 0.,
                        Some(Column::Frame { .. }) => l.frame_gap - after,
                        Some(Column::Body { .. } | Column::Image { .. }) => before,
                    };
                    if cursor - before - width - after - l.pitch < l.left {
                        pages.push(Vec::new());
                        cursor = l.right;
                    }
                    if !pages.last().unwrap().is_empty() {
                        cursor -= before;
                    }
                    pages.last_mut().unwrap().push(Column::Frame {
                        right: cursor,
                        width,
                        number,
                        titles: chunk.to_vec(),
                    });
                    cursor -= width + after;
                }
            }
            Item::Text {
                text,
                stage,
                actor_length,
            } => {
                let top = l.text_top + if stage { l.stage_indent } else { 0. };
                let continuation = if stage {
                    top
                } else {
                    // Align continuation text with the first spoken character,
                    // after both the actor name and the opening quotation mark.
                    l.text_top
                        + (actor_length + 1).min(capacity(l.text_top, l) - 2) as f32 * l.advance
                };
                let mut rows = Vec::new();
                for line in normalized(&text).replace('\t', "    ").split('\n') {
                    let start = if rows.is_empty() { top } else { continuation };
                    let first = wrap(line, capacity(start, l))
                        .into_iter()
                        .next()
                        .unwrap_or_default();
                    let remaining = &line[first.len()..];
                    rows.push((start, first));
                    if !remaining.is_empty() {
                        rows.extend(
                            wrap(remaining, capacity(continuation, l))
                                .into_iter()
                                .map(|s| (continuation, s)),
                        );
                    }
                }
                for (top, text) in rows {
                    if cursor - l.pitch < l.left {
                        pages.push(Vec::new());
                        cursor = l.right;
                    }
                    pages.last_mut().unwrap().push(Column::Body {
                        x: cursor - l.pitch / 2.,
                        top,
                        text,
                    });
                    cursor -= l.pitch;
                }
            }
        }
    }
    pages
}
fn svgs_configured(parts: &[Part], settings: &Settings) -> Result<Vec<String>, String> {
    let l = Layout::new(settings);
    let Layout {
        left,
        right,
        rule,
        frame_top,
        bottom,
        text_top,
        font,
        advance: _,
        pitch,
        frame_gap: _,
        stage_indent: _,
        width,
        height,
    } = l;
    let mut glyphs = vertical_glyphs::Renderer::configured(font, font + 1., &settings.font);
    let pages = layout_configured(parts, &l);
    pages.iter().enumerate().map(|(index,columns)| -> Result<String, String> {
        let mut svg=format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\"><g fill=\"#151515\" font-family=\"{}\" font-size=\"{font}\"><path d=\"M {left} {rule} H {right}\" fill=\"none\" stroke=\"#555\" stroke-width=\"0.5\"/>",settings.family());
        for column in columns {
            match column {
                Column::Frame{right,width,number,titles}=>{
                    svg.push_str(&format!("<path d=\"M {} {bottom} V {frame_top} H {right} V {bottom}\" fill=\"none\" stroke=\"#222\" stroke-width=\"0.6\"/><text x=\"{}\" y=\"{}\" text-anchor=\"middle\">{number}</text>",right-width,right-width/2.,rule-font-1.));
                    for (i,title) in titles.iter().enumerate(){svg.push_str(&glyphs.vertical(right-1.5*font-i as f32*pitch,text_top,title)?);}
                },
                Column::Body{x,top,text}=>svg.push_str(&glyphs.vertical(*x,*top,text)?),
                Column::Image{x,top,data,width,height}=>svg.push_str(&format!("<image x=\"{x}\" y=\"{top}\" width=\"{width}\" height=\"{height}\" href=\"{}\"/>",xml(data))),
            }
        }
        svg.push_str(&format!("<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"9\" fill=\"#666\">— {} —</text></g></svg>",width/2.,height-settings.margin()/2.,index+1));Ok(svg)
    }).collect()
}
#[cfg(test)]
pub(super) fn render(parts: &[Part]) -> Result<Vec<u8>, String> {
    configured(parts, &Settings::default())
}
pub(super) fn configured(parts: &[Part], settings: &Settings) -> Result<Vec<u8>, String> {
    settings.validate_script()?;
    svg_pdf(&svgs_configured(parts, settings)?)
}
pub(super) fn standard(parts: &[Part], settings: &Settings) -> Result<Vec<u8>, String> {
    settings.validate()?;
    let l = Layout::new(settings);
    let top = settings.margin();
    let count = ((l.bottom - top - l.font) / l.advance).floor() as usize + 1;
    let mut glyphs = vertical_glyphs::Renderer::configured(l.font, l.advance, &settings.font);
    let mut pages = vec![Vec::new()];
    let mut images = std::collections::BTreeMap::new();
    let mut x = l.right - l.font;
    for part in render_parts(parts) {
        if let Part::Image(_, _, data, w, h) = part
            && !data.is_empty()
        {
            if !pages.last().unwrap().is_empty() {
                pages.push(Vec::new());
            }
            let scale = ((l.right - l.left) / w.max(1.))
                .min((l.bottom - top) / h.max(1.))
                .min(1.);
            images.insert(
                pages.len() - 1,
                format!(
                    "<image x=\"{}\" y=\"{top}\" width=\"{}\" height=\"{}\" href=\"{}\"/>",
                    l.left,
                    w * scale,
                    h * scale,
                    xml(data)
                ),
            );
            pages.push(Vec::new());
            x = l.right - l.font;
        }
        let text = match part {
            Part::Heading(_, s)
            | Part::RichHeading(_, s, _)
            | Part::Paragraph(s)
            | Part::Rich(s, _)
            | Part::RichContainer(s, _, _)
            | Part::Image(s, _, _, _, _) => s.clone(),
            Part::Dialogue(actor, text) | Part::RichDialogue(actor, text, _) => {
                format!("{actor}「{text}」")
            }
        };
        for column in wrap(&text, count) {
            if x - l.font / 2. < l.left {
                pages.push(Vec::new());
                x = l.right - l.font;
            }
            pages.last_mut().unwrap().push((x, column));
            x -= l.pitch;
        }
        x -= l.font;
    }
    let svgs=pages.iter().enumerate().map(|(index,columns)|{let mut svg=format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{}\" height=\"{}\"><g fill=\"#151515\" font-family=\"{}\" font-size=\"{}\">",l.width,l.height,settings.family(),l.font);if let Some(image)=images.get(&index){svg.push_str(image);}for (x,text) in columns{svg.push_str(&glyphs.vertical(*x,top,text)?);}svg.push_str(&format!("<text x=\"{}\" y=\"{}\" text-anchor=\"middle\" font-size=\"9\">— {} —</text></g></svg>",l.width/2.,l.height-settings.margin()/2.,index+1));Ok(svg)}).collect::<Result<Vec<_>,String>>()?;
    svg_pdf(&svgs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use unicode_segmentation::UnicodeSegmentation;
    #[test]
    fn configurable_pages_keep_frames_and_all_glyph_cells_inside_margins() {
        for paper in ["a4", "b5", "letter"] {
            for size in [8., 12., 18.] {
                let settings = Settings {
                    paper: paper.into(),
                    font_size: size,
                    margin_mm: 16.,
                    script_indent: 3.,
                    script_rule: 0.3,
                    ..Default::default()
                };
                settings.validate().unwrap();
                let l = Layout::new(&settings);
                for page in layout_configured(
                    &[
                        Part::Heading(4, "長い場面タイトル".repeat(80)),
                        Part::Dialogue("高橋".into(), "台詞、続く。".repeat(300)),
                        Part::Paragraph("ト書き。".repeat(300)),
                    ],
                    &l,
                ) {
                    for column in page {
                        match column {
                            Column::Image {
                                x,
                                top,
                                width,
                                height,
                                ..
                            } => {
                                assert!(
                                    x >= l.left && x + width <= l.right && top + height <= l.bottom
                                );
                            }
                            Column::Frame { right, width, .. } => {
                                assert!(right <= l.right);
                                assert!(right - width >= l.left);
                            }
                            Column::Body { x, top, text } => {
                                assert!(x - l.font / 2. >= l.left);
                                assert!(x + l.font / 2. <= l.right);
                                assert!(
                                    top + text.graphemes(true).count().saturating_sub(1) as f32
                                        * l.advance
                                        + l.font
                                        <= l.bottom + 0.01
                                );
                            }
                        }
                    }
                }
            }
        }
    }
    #[test]
    #[ignore = "writes PDF layout fixtures with system fonts"]
    fn configured_pdf_fixtures() {
        let parts = [
            Part::Heading(1, "雨の駅から".into()),
            Part::Heading(4, "公園（夏・晴れ）".into()),
            Part::Paragraph(
                "浴衣を着ている女性・花子（20）が立っている。誰かを待っているような感じ。"
                    .repeat(8),
            ),
            Part::Dialogue(
                "太郎".into(),
                "あ、先輩！……今日の駅は寒いですね。どうなってるんだ？".repeat(10),
            ),
        ];
        for (name, settings, script) in [
            (
                "standard-vertical",
                Settings {
                    writing_mode: "vertical".into(),
                    ..Default::default()
                },
                false,
            ),
            (
                "script-b5",
                Settings {
                    paper: "b5".into(),
                    font_size: 14.,
                    font: "sans".into(),
                    script_indent: 3.,
                    script_rule: 0.3,
                    ..Default::default()
                },
                true,
            ),
            (
                "standard-letter",
                Settings {
                    paper: "letter".into(),
                    font_size: 16.,
                    margin_mm: 20.,
                    font: "sans".into(),
                    ..Default::default()
                },
                false,
            ),
        ] {
            let bytes = if script {
                configured(&parts, &settings)
            } else if settings.writing_mode == "vertical" {
                standard(&parts, &settings)
            } else {
                super::super::pdf_configured(&parts, &settings)
            }
            .unwrap();
            let pdf = lopdf::Document::load_mem(&bytes).unwrap();
            assert!(!pdf.get_pages().is_empty());
            std::fs::write(format!("/private/tmp/komyaku-{name}.pdf"), bytes).unwrap();
        }
    }
    #[test]
    fn frame_gaps_are_equal_and_dialogue_continuations_hang_below_actor() {
        let pages = layout(&[
            Part::Paragraph("前".into()),
            Part::Heading(4, "場面".into()),
            Part::Dialogue(
                "高橋".into(),
                format!("{}\n改行後", "セリフ、続く。".repeat(150)),
            ),
        ]);
        let [
            Column::Body { x: before, .. },
            Column::Frame { right, width, .. },
            Column::Body { x: after, top, .. },
            ..,
        ] = &pages[0][..]
        else {
            panic!("frame between text columns");
        };
        assert_eq!(before - FONT / 2. - right, FRAME_GAP);
        assert_eq!(right - width - (after + FONT / 2.), FRAME_GAP);
        assert_eq!(*top, TEXT_TOP);
        assert!(pages.len() > 1);
        let bodies = pages
            .iter()
            .flatten()
            .filter_map(|c| {
                if let Column::Body { top, text, .. } = c {
                    Some((*top, text))
                } else {
                    None
                }
            })
            .skip(2)
            .collect::<Vec<_>>();
        assert!(
            bodies
                .iter()
                .all(|(top, _)| *top == TEXT_TOP + 3. * ADVANCE)
        );
        let copied: String = pages
            .iter()
            .flatten()
            .filter_map(|c| {
                if let Column::Body { text, .. } = c {
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .skip(1)
            .collect();
        assert_eq!(
            copied,
            format!("高橋「{}改行後」", "セリフ、続く。".repeat(150))
        );
        let adjacent = layout(&[
            Part::Heading(4, "空の場面".into()),
            Part::Heading(4, "次の場面".into()),
        ]);
        let [
            Column::Frame { right, width, .. },
            Column::Frame { right: next, .. },
        ] = &adjacent[0][..]
        else {
            panic!("adjacent frames");
        };
        assert_eq!(right - width - next, FRAME_GAP);
    }
    #[test]
    fn script_columns_keep_scene_numbers_indent_and_page_bounds() {
        let parts = vec![
            Part::Heading(1, "作品".into()),
            Part::Heading(4, "公園（夏・晴れ）".into()),
            Part::Paragraph("浴衣を着ている女性・花子が立っている。".into()),
            Part::Dialogue("太郎".into(), "こんにちは。".into()),
            Part::Heading(4, "道〜公園".into()),
            Part::Paragraph("雨".repeat(20000)),
        ];
        let pages = layout(&parts);
        assert!(pages.len() > 2);
        let columns: Vec<_> = pages.iter().flatten().collect();
        let numbers: Vec<_> = columns
            .iter()
            .filter_map(|c| {
                if let Column::Frame { number, .. } = c {
                    Some(*number)
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(numbers, vec![1, 2]);
        let starts: Vec<_> = columns
            .iter()
            .filter_map(|c| {
                if let Column::Body { top, .. } = c {
                    Some(*top)
                } else {
                    None
                }
            })
            .take(2)
            .collect();
        assert_eq!(starts, vec![TEXT_TOP + STAGE_INDENT, TEXT_TOP]);
        let copied: String = columns
            .iter()
            .filter_map(|c| {
                if let Column::Body { text, .. } = c {
                    Some(text.as_str())
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(copied.matches('雨').count(), 20000);
        assert!(copied.contains("太郎「こんにちは。」"));
        for column in columns {
            match column {
                Column::Image {
                    x,
                    top,
                    width,
                    height,
                    ..
                } => {
                    assert!(*x >= LEFT && x + width <= RIGHT && top + height <= BOTTOM);
                }
                Column::Frame { right, width, .. } => {
                    assert!(*right <= RIGHT && right - width >= LEFT)
                }
                Column::Body { x, top, text } => {
                    assert!(*x >= LEFT + PITCH / 2. && *x <= RIGHT - PITCH / 2.);
                    assert!(
                        *top + (text.graphemes(true).count().saturating_sub(1)) as f32 * ADVANCE
                            + FONT
                            <= BOTTOM
                    );
                }
            }
        }
    }
    #[test]
    fn scene_frame_moves_with_first_body_column_and_long_titles_are_not_truncated() {
        let mut parts: Vec<_> = (0..19).map(|_| Part::Paragraph(String::new())).collect();
        parts.push(Part::Heading(4, "次の場面".into()));
        parts.push(Part::Dialogue("花子".into(), "始めましょう。".into()));
        let pages = layout(&parts);
        assert_eq!(pages.len(), 2);
        assert!(matches!(pages[1][0], Column::Frame { number: 1, .. }));
        assert!(matches!(pages[1][1], Column::Body { .. }));
        let pages = layout(&[Part::Heading(4, "長いタイトル".repeat(300))]);
        assert!(pages.iter().all(|page| !page.is_empty()));
        let title: String = pages
            .iter()
            .flatten()
            .filter_map(|column| {
                if let Column::Frame { titles, .. } = column {
                    Some(titles.concat())
                } else {
                    None
                }
            })
            .collect();
        assert_eq!(title, "長いタイトル".repeat(300));
    }
    #[test]
    #[ignore = "Creates screenplay PDF for visual QA using system fonts"]
    fn script_fixture_for_visual_qa() {
        vertical_glyphs::verify_glyph_cells();
        let mut parts=vec![Part::Heading(4,"公園（夏・晴れ）".into()),Part::Paragraph("浴衣を着ている女性・花子（20）が立っている。\n誰かを待っているような感じ。".into()),Part::Heading(4,"道〜公園".into()),Part::Paragraph("歩いてくる男性・太郎（18）。\nコンビニ袋と傘を手に持っている。\n花子が待っている公園に、太郎が通りかかる。\n花子に気づく太郎。".into()),Part::Dialogue("太郎".into(),"あ、先輩".into()),Part::Dialogue("花子".into(),"!?　あ、太郎".into()),Part::Dialogue("太郎".into(),"ご無沙汰してます".into()),Part::Dialogue("花子".into(),"久し振りー".into()),Part::Paragraph("変な感じの間。".into()),Part::Dialogue("太郎".into(),"あー……。えーと……。なにしてるんですか？".into())];
        parts.push(Part::Heading(4, "長文・改ページの確認".into()));
        parts.push(Part::Paragraph(
            "雨の公園で、二人は手紙を読み返した。".repeat(80),
        ));
        parts.push(Part::Dialogue("花子".into(), "終わり。".into()));
        parts.push(Part::Heading(4, "約物（夏・晴れ）「確認」".into()));
        parts.push(Part::Paragraph("句読点。、小書きぁぃぅぇぉっゃゅょァィゥェォッャュョ。\n括弧「引用」『二重』（）［］【】、長音ー、三点……。".into()));
        parts.push(Part::Dialogue(
            "高橋".into(),
            format!(
                "{}\n改行後も役者名の下から続ける。",
                "どうなっているんだ？　えーと……。".repeat(10)
            ),
        ));
        let bytes = render(&parts).unwrap();
        assert!(lopdf::Document::load_mem(&bytes).unwrap().get_pages().len() > 1);
        std::fs::write(
            std::env::var("STORY_GRAPH_EXPORT_QA_OUTPUT").expect("QA output path"),
            bytes,
        )
        .unwrap();
    }
}
