//! Portrait screenplay layout. Scene frames and prose share the same column flow.
use super::{Part, normalized, svg_pdf, wrap, xml};
use unicode_segmentation::UnicodeSegmentation;
#[path = "vertical_glyphs.rs"]
mod vertical_glyphs;

const LEFT: f32 = 36.;
const RIGHT: f32 = 559.;
const RULE: f32 = 281.;
const FRAME_TOP: f32 = 239.;
const BOTTOM: f32 = 786.;
const TEXT_TOP: f32 = 307.;
const FONT: f32 = 12.;
const ADVANCE: f32 = 13.;
const PITCH: f32 = 24.;
const FRAME_GAP: f32 = 1.5 * FONT;
const STAGE_INDENT: f32 = 6. * ADVANCE;

#[derive(Debug)]
enum Item {
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
    parts
        .iter()
        .filter_map(|part| match part {
            Part::Heading(4, title) => {
                number += 1;
                Some(Item::Scene {
                    number,
                    title: title.clone(),
                })
            }
            Part::Paragraph(text) => Some(Item::Text {
                text: text.clone(),
                stage: true,
                actor_length: 0,
            }),
            Part::Dialogue(actor, text) => Some(Item::Text {
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
fn capacity(top: f32) -> usize {
    ((BOTTOM - top - FONT) / ADVANCE).floor() as usize + 1
}
fn layout(parts: &[Part]) -> Vec<Vec<Column>> {
    let mut pages = vec![Vec::new()];
    let mut cursor = RIGHT;
    for item in items(parts) {
        match item {
            Item::Scene { number, title } => {
                let titles = wrap(&title, capacity(TEXT_TOP));
                let width = PITCH * titles.len() as f32 + 12.;
                // cursor is half a column beyond the preceding text centre.
                // Measure both frame gaps from the full-width glyph cell edge.
                let before = FRAME_GAP - (PITCH - FONT) / 2.;
                let after = FRAME_GAP + FONT / 2. - PITCH / 2.;
                if cursor - before - width - after - PITCH < LEFT && cursor < RIGHT {
                    pages.push(Vec::new());
                    cursor = RIGHT;
                }
                // A pathological long title gets additional bounded frames;
                // its scene number is kept, and no text is truncated.
                let max_title_columns =
                    ((RIGHT - LEFT - PITCH - 12. - after) / PITCH).floor() as usize;
                for chunk in titles.chunks(max_title_columns.max(1)) {
                    let width = PITCH * chunk.len() as f32 + 12.;
                    let before = match pages.last().unwrap().last() {
                        None => 0.,
                        Some(Column::Frame { .. }) => FRAME_GAP - after,
                        Some(Column::Body { .. }) => before,
                    };
                    if cursor - before - width - after - PITCH < LEFT {
                        pages.push(Vec::new());
                        cursor = RIGHT;
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
                let top = TEXT_TOP + if stage { STAGE_INDENT } else { 0. };
                let continuation = if stage {
                    top
                } else {
                    // Align continuation text with the first spoken character,
                    // after both the actor name and the opening quotation mark.
                    TEXT_TOP + (actor_length + 1).min(capacity(TEXT_TOP) - 2) as f32 * ADVANCE
                };
                let mut rows = Vec::new();
                for line in normalized(&text).replace('\t', "    ").split('\n') {
                    let start = if rows.is_empty() { top } else { continuation };
                    let first = wrap(line, capacity(start))
                        .into_iter()
                        .next()
                        .unwrap_or_default();
                    let remaining = &line[first.len()..];
                    rows.push((start, first));
                    if !remaining.is_empty() {
                        rows.extend(
                            wrap(remaining, capacity(continuation))
                                .into_iter()
                                .map(|s| (continuation, s)),
                        );
                    }
                }
                for (top, text) in rows {
                    if cursor - PITCH < LEFT {
                        pages.push(Vec::new());
                        cursor = RIGHT;
                    }
                    pages.last_mut().unwrap().push(Column::Body {
                        x: cursor - PITCH / 2.,
                        top,
                        text,
                    });
                    cursor -= PITCH;
                }
            }
        }
    }
    pages
}
fn svgs(parts: &[Part]) -> Result<Vec<String>, String> {
    let mut glyphs = vertical_glyphs::Renderer::new();
    let pages = layout(parts);
    pages.iter().enumerate().map(|(index,columns)| -> Result<String, String> {
        let mut svg=format!("<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"595\" height=\"842\"><g fill=\"#151515\" font-family=\"Hiragino Mincho ProN,Noto Serif CJK JP,Songti SC,DejaVu Serif,serif\" font-size=\"{FONT}\"><path d=\"M {LEFT} {RULE} H {RIGHT}\" fill=\"none\" stroke=\"#555\" stroke-width=\"0.5\"/>");
        for column in columns {
            match column {
                Column::Frame{right,width,number,titles}=>{
                    svg.push_str(&format!("<path d=\"M {} {BOTTOM} V {FRAME_TOP} H {right} V {BOTTOM}\" fill=\"none\" stroke=\"#222\" stroke-width=\"0.6\"/><text x=\"{}\" y=\"268\" text-anchor=\"middle\">{number}</text>",right-width,right-width/2.));
                    for (i,title) in titles.iter().enumerate(){svg.push_str(&glyphs.vertical(right-18.-i as f32*PITCH,TEXT_TOP,title)?);}
                },
                Column::Body{x,top,text}=>svg.push_str(&glyphs.vertical(*x,*top,text)?),
            }
        }
        svg.push_str(&format!("<text x=\"297.5\" y=\"816\" text-anchor=\"middle\" font-size=\"9\" fill=\"#666\">— {} —</text></g></svg>",index+1));Ok(svg)
    }).collect()
}
pub(super) fn render(parts: &[Part]) -> Result<Vec<u8>, String> {
    svg_pdf(&svgs(parts)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use unicode_segmentation::UnicodeSegmentation;
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
