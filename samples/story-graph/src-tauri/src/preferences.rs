use serde::{Deserialize, Serialize};
use std::{path::PathBuf, sync::Mutex};
use tauri::{Emitter, Manager};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preferences {
    pub language: String,
    pub body_font: String,
    #[serde(default = "default_writing_mode")]
    pub writing_mode: String,
    #[serde(default)]
    pub actor_bold: bool,
    pub body_size: f32,
    pub line_height: f32,
    pub title_size: f32,
    #[serde(default = "default_block_size")]
    pub block_size: f32,
    #[serde(default = "default_sequence_size")]
    pub sequence_size: f32,
    #[serde(default = "default_panel_open")]
    pub left_panel_open: bool,
    #[serde(default)]
    pub right_panel_open: bool,
}
fn default_writing_mode() -> String {
    "horizontal".into()
}
fn default_panel_open() -> bool {
    true
}
fn default_block_size() -> f32 {
    30.
}
fn default_sequence_size() -> f32 {
    25.
}
impl Default for Preferences {
    fn default() -> Self {
        Self {
            language: "ja".into(),
            body_font: "serif".into(),
            writing_mode: default_writing_mode(),
            actor_bold: false,
            body_size: 18.,
            line_height: 2.1,
            title_size: 22.,
            block_size: default_block_size(),
            sequence_size: default_sequence_size(),
            left_panel_open: true,
            right_panel_open: false,
        }
    }
}
impl Preferences {
    fn validate(&self) -> Result<(), String> {
        if !["ja", "en", "zh-CN"].contains(&self.language.as_str())
            || !["horizontal", "vertical"].contains(&self.writing_mode.as_str())
            || !["serif", "sans", "mono"].contains(&self.body_font.as_str())
            || !self.body_size.is_finite()
            || !(10. ..=40.).contains(&self.body_size)
            || !self.line_height.is_finite()
            || !(1. ..=3.).contains(&self.line_height)
            || !self.title_size.is_finite()
            || !(12. ..=48.).contains(&self.title_size)
            || !self.block_size.is_finite()
            || !(12. ..=48.).contains(&self.block_size)
            || !self.sequence_size.is_finite()
            || !(12. ..=48.).contains(&self.sequence_size)
        {
            return Err("invalid_properties".into());
        }
        Ok(())
    }
}
pub struct Store {
    pub value: Mutex<Preferences>,
    path: PathBuf,
}
impl Store {
    pub fn load(path: PathBuf) -> Result<Self, String> {
        let mut value = if path.exists() {
            serde_json::from_slice::<Preferences>(&std::fs::read(&path).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?
        } else {
            Preferences::default()
        };
        value.validate()?;
        value.right_panel_open = false;
        Ok(Self {
            value: Mutex::new(value),
            path,
        })
    }
    pub(crate) fn save(&self, value: Preferences) -> Result<Preferences, String> {
        use std::io::Write;
        value.validate()?;
        let mut current = self.value.lock().map_err(|_| "state_unavailable")?;
        let temp = self.path.with_extension("pending");
        let mut file = std::fs::File::create(&temp).map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec_pretty(&value).map_err(|e| e.to_string())?)
            .and_then(|_| file.sync_all())
            .map_err(|e| e.to_string())?;
        std::fs::rename(temp, &self.path).map_err(|e| e.to_string())?;
        *current = value.clone();
        Ok(value)
    }
}
#[tauri::command]
pub fn get_preferences(
    window: tauri::WebviewWindow,
    store: tauri::State<Store>,
) -> Result<Preferences, String> {
    super::allowed(&window)?;
    Ok(store.value.lock().map_err(|_| "state_unavailable")?.clone())
}
#[tauri::command]
pub fn set_preferences(
    window: tauri::WebviewWindow,
    store: tauri::State<Store>,
    preferences: Preferences,
) -> Result<Preferences, String> {
    super::allowed(&window)?;
    let value = store.save(preferences)?;
    let locale = match value.language.as_str() {
        "en" => unge_core::Locale::En,
        "zh-CN" => unge_core::Locale::ZhCn,
        _ => unge_core::Locale::Ja,
    };
    window
        .state::<super::Host>()
        .engine
        .dispatch("controls", unge_tauri::Request::SetLocale { locale })
        .map_err(|e| e.code)?;
    window
        .emit("story://preferences", &value)
        .map_err(|_| "event_error")?;
    super::redraw(window.app_handle());
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn existing_preferences_default_to_left_open_right_closed() {
        let legacy =
            r#"{"language":"ja","bodyFont":"serif","bodySize":17,"lineHeight":2.1,"titleSize":18}"#;
        let value: Preferences = serde_json::from_str(legacy).unwrap();
        assert_eq!(value.writing_mode, "horizontal");
        assert!(!value.actor_bold);
        assert_eq!(value.block_size, 30.);
        assert_eq!(value.sequence_size, 25.);
        assert_eq!(value.title_size, 18.);
        let defaults = Preferences::default();
        assert_eq!(
            (
                defaults.body_size,
                defaults.block_size,
                defaults.sequence_size,
                defaults.title_size
            ),
            (18., 30., 25., 22.)
        );
        assert!(value.left_panel_open && !value.right_panel_open);
    }
    #[test]
    fn invalid_settings_do_not_replace_saved_preferences() {
        let path =
            std::env::temp_dir().join(format!("story-prefs-{}.json", unge_core::Id::new_v4()));
        let store = Store::load(path.clone()).unwrap();
        let valid = Preferences {
            language: "zh-CN".into(),
            body_font: "mono".into(),
            writing_mode: "vertical".into(),
            actor_bold: true,
            body_size: 24.,
            line_height: 1.5,
            title_size: 32.,
            block_size: 30.,
            sequence_size: 22.,
            left_panel_open: false,
            right_panel_open: false,
        };
        store.save(valid.clone()).unwrap();
        let mut invalid = valid.clone();
        invalid.writing_mode = "invalid".into();
        assert!(store.save(invalid.clone()).is_err());
        invalid = valid.clone();
        invalid.body_size = f32::NAN;
        assert!(store.save(invalid).is_err());
        for key in ["blockSize", "sequenceSize", "titleSize"] {
            for size in [11., 49.] {
                let mut json = serde_json::to_value(&valid).unwrap();
                json[key] = serde_json::json!(size);
                assert!(store.save(serde_json::from_value(json).unwrap()).is_err());
            }
        }
        invalid = valid.clone();
        invalid.block_size = f32::INFINITY;
        assert!(store.save(invalid).is_err());
        invalid = valid.clone();
        invalid.sequence_size = f32::NAN;
        assert!(store.save(invalid).is_err());
        assert_eq!(
            *Store::load(path.clone()).unwrap().value.lock().unwrap(),
            valid
        );
        std::fs::remove_file(path).unwrap();
    }
}
