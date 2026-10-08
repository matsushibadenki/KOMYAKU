//! Export layout is validated independently of the WebView.
use serde::{Deserialize, Serialize};
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct Settings {
    pub paper: String,
    pub font: String,
    pub font_size: f32,
    pub margin_mm: f32,
    pub writing_mode: String,
    pub script_indent: f32,
    pub script_rule: f32,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            paper: "a4".into(),
            font: "serif".into(),
            font_size: 12.,
            margin_mm: 12.7,
            writing_mode: "horizontal".into(),
            script_indent: 6.,
            script_rule: 1. / 3.,
        }
    }
}
impl Settings {
    pub fn validate(&self) -> Result<(), String> {
        if !matches!(self.paper.as_str(), "a4" | "b5" | "letter")
            || !matches!(self.font.as_str(), "serif" | "sans" | "mono")
            || !matches!(self.writing_mode.as_str(), "horizontal" | "vertical")
            || !self.font_size.is_finite()
            || !(8. ..=24.).contains(&self.font_size)
            || !self.margin_mm.is_finite()
            || !(8. ..=40.).contains(&self.margin_mm)
            || !self.script_indent.is_finite()
            || !(0. ..=12.).contains(&self.script_indent)
            || !self.script_rule.is_finite()
            || !(0.2..=0.5).contains(&self.script_rule)
        {
            return Err("export_settings_invalid".into());
        }
        Ok(())
    }
    pub fn validate_script(&self) -> Result<(), String> {
        self.validate()?;
        let (_, height) = self.dimensions();
        if height
            - self.margin()
            - 20.
            - (height * self.script_rule + 26. + self.script_indent * (self.font_size + 1.))
            < 3. * (self.font_size + 1.)
        {
            return Err("export_settings_invalid".into());
        }
        Ok(())
    }
    pub fn dimensions(&self) -> (f32, f32) {
        match self.paper.as_str() {
            "b5" => (516., 729.),
            "letter" => (612., 792.),
            _ => (595., 842.),
        }
    }
    pub fn margin(&self) -> f32 {
        self.margin_mm * 72. / 25.4
    }
    pub fn family(&self) -> &'static str {
        match self.font.as_str() {
            "sans" => "Hiragino Sans,Noto Sans CJK JP,Noto Sans CJK SC,DejaVu Sans,sans-serif",
            "mono" => "Hiragino Sans,Noto Sans Mono CJK JP,DejaVu Sans Mono,monospace",
            _ => "Hiragino Mincho ProN,Noto Serif CJK JP,Songti SC,DejaVu Serif,serif",
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_non_finite_and_overflowing_layouts() {
        let mut s = Settings::default();
        assert!(s.validate().is_ok());
        s.font_size = f32::NAN;
        assert!(s.validate().is_err());
        s.font_size = 24.;
        s.paper = "b5".into();
        s.margin_mm = 40.;
        s.script_rule = 0.5;
        s.script_indent = 12.;
        assert!(s.validate_script().is_err());
    }
}
