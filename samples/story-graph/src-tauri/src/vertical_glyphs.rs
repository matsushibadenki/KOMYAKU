//! Shape vertical glyphs before outlining: SVG's writing-mode alone does not
//! enable OpenType vert/vrt2 in usvg. Keep original text in an invisible PDF
//! text layer so the shaped outlines remain searchable/selectable.
use super::{ADVANCE, FONT, xml};
use rustybuzz::{
    Direction, UnicodeBuffer,
    ttf_parser::{GlyphId, OutlineBuilder},
};
use std::{collections::HashMap, fmt::Write};
use svg2pdf::usvg::fontdb::{Database, Family, Query};
use unicode_segmentation::UnicodeSegmentation;

#[derive(Default)]
struct Outline(String);
impl OutlineBuilder for Outline {
    fn move_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.0, "M{x} {y}");
    }
    fn line_to(&mut self, x: f32, y: f32) {
        let _ = write!(self.0, "L{x} {y}");
    }
    fn quad_to(&mut self, x1: f32, y1: f32, x: f32, y: f32) {
        let _ = write!(self.0, "Q{x1} {y1} {x} {y}");
    }
    fn curve_to(&mut self, x1: f32, y1: f32, x2: f32, y2: f32, x: f32, y: f32) {
        let _ = write!(self.0, "C{x1} {y1} {x2} {y2} {x} {y}");
    }
    fn close(&mut self) {
        self.0.push('Z');
    }
}

#[cfg(test)]
pub(super) fn verify_glyph_cells() {
    let mut renderer = Renderer::new();
    for character in ["A", "?", "!", "。", "ぁ", "っ", "「", "（", "ー", "…"] {
        let shape = renderer.glyph(character).unwrap();
        let svg = format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"595\" height=\"842\">{shape}</svg>"
        );
        let tree = svg2pdf::usvg::Tree::from_str(&svg, &Default::default()).unwrap();
        let bounds = tree.root().bounding_box();
        assert!(
            bounds.left() >= -FONT / 2. - 1. && bounds.right() <= FONT / 2. + 1.,
            "{character}: {bounds:?}"
        );
        assert!(
            bounds.top() >= -1. && bounds.bottom() <= FONT + 1.,
            "{character}: {bounds:?}"
        );
    }
}
pub(super) struct Renderer {
    fonts: Database,
    cache: HashMap<String, String>,
}
impl Renderer {
    pub(super) fn new() -> Self {
        let mut fonts = Database::new();
        fonts.load_system_fonts();
        Self {
            fonts,
            cache: HashMap::new(),
        }
    }
    fn glyph(&mut self, grapheme: &str) -> Result<&str, String> {
        if !self.cache.contains_key(grapheme) {
            let preferred = self.fonts.query(&Query {
                families: &[
                    Family::Name("Hiragino Mincho ProN"),
                    Family::Name("Noto Serif CJK JP"),
                    Family::Name("Songti SC"),
                    Family::Serif,
                ],
                ..Default::default()
            });
            let mut candidates = preferred.into_iter().collect::<Vec<_>>();
            candidates.extend(self.fonts.faces().map(|face| face.id));
            let result = candidates
                .into_iter()
                .find_map(|id| {
                    self.fonts
                        .with_face_data(id, |data, index| {
                            let face = rustybuzz::Face::from_slice(data, index)?;
                            if grapheme.chars().any(|c| {
                                face.glyph_index(c).is_none() && c != '\u{fe0f}' && c != '\u{200d}'
                            }) {
                                return None;
                            }
                            let orientation =
                                unicode_vo::char_orientation(grapheme.chars().next()?);
                            let mut rotated =
                                matches!(orientation, unicode_vo::Orientation::Rotated);
                            let mut buffer = UnicodeBuffer::new();
                            buffer.push_str(grapheme);
                            buffer.set_direction(if rotated {
                                Direction::LeftToRight
                            } else {
                                Direction::TopToBottom
                            });
                            buffer.guess_segment_properties();
                            let mut shaped = rustybuzz::shape(&face, &[], buffer);
                            if orientation == unicode_vo::Orientation::TransformedOrRotated {
                                let mut horizontal = UnicodeBuffer::new();
                                horizontal.push_str(grapheme);
                                horizontal.set_direction(Direction::LeftToRight);
                                horizontal.guess_segment_properties();
                                let horizontal = rustybuzz::shape(&face, &[], horizontal);
                                if shaped
                                    .glyph_infos()
                                    .iter()
                                    .map(|g| g.glyph_id)
                                    .eq(horizontal.glyph_infos().iter().map(|g| g.glyph_id))
                                {
                                    rotated = true;
                                    shaped = horizontal;
                                }
                            }
                            if shaped.glyph_infos().iter().any(|g| g.glyph_id == 0) {
                                return None;
                            }
                            let scale = FONT / face.units_per_em() as f32;
                            let mut out = String::new();
                            let mut dx = 0.;
                            let mut dy = 0.;
                            for (info, pos) in
                                shaped.glyph_infos().iter().zip(shaped.glyph_positions())
                            {
                                let mut path = Outline::default();
                                face.outline_glyph(GlyphId(info.glyph_id as u16), &mut path);
                                if !path.0.is_empty() {
                                    let _ = write!(
                                        out,
                                        "<path transform=\"translate({} {})\" d=\"{}\"/>",
                                        dx + pos.x_offset as f32,
                                        dy + pos.y_offset as f32,
                                        path.0
                                    );
                                }
                                dx += pos.x_advance as f32;
                                dy += pos.y_advance as f32;
                            }
                            if out.is_empty() && !grapheme.chars().all(char::is_whitespace) {
                                return None;
                            }
                            let transform = if rotated {
                                // Centre sideways Latin within the same full-width cell.
                                format!(
                                    "translate({} {}) rotate(90) scale({scale} {})",
                                    -(face.ascender() as f32 + face.descender() as f32) * scale
                                        / 2.,
                                    (FONT - dx * scale) / 2.,
                                    -scale
                                )
                            } else {
                                format!("scale({scale} {})", -scale)
                            };
                            Some(format!("<g transform=\"{transform}\">{out}</g>"))
                        })
                        .flatten()
                })
                .ok_or("export_pdf_failed")?;
            self.cache.insert(grapheme.to_owned(), result);
        }
        Ok(self.cache.get(grapheme).unwrap())
    }
    pub(super) fn vertical(&mut self, x: f32, top: f32, text: &str) -> Result<String, String> {
        // This text is retained by svg2pdf for Unicode extraction, but painted
        // white beneath the visible glyph outlines on the white manuscript page.
        let mut out = format!(
            "<text x=\"{x}\" y=\"{top}\" writing-mode=\"tb\" letter-spacing=\"1\" fill=\"white\" xml:space=\"preserve\">{}</text>",
            xml(text)
        );
        for (i, grapheme) in text.graphemes(true).enumerate() {
            let glyph = self.glyph(grapheme)?;
            let _ = write!(
                out,
                "<g transform=\"translate({x} {})\">{glyph}</g>",
                top + i as f32 * ADVANCE
            );
        }
        Ok(out)
    }
}
