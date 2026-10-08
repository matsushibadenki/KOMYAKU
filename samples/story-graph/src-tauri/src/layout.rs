//! Rust-owned presentation state, separate from manuscript revisions/history.
use super::*;
use std::collections::BTreeMap;
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Geometry {
    pub x: i32,
    pub y: i32,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    pub version: u8,
    pub navigator_width: f64,
    pub inspector_width: f64,
    pub windows: BTreeMap<String, Geometry>,
    #[serde(default = "default_docks")]
    pub docks: BTreeMap<String, String>,
    #[serde(default)]
    pub floating_panels: std::collections::BTreeSet<String>,
}
fn default_docks() -> BTreeMap<String, String> {
    BTreeMap::from([
        ("navigator".into(), "left".into()),
        ("inspector".into(), "right".into()),
    ])
}
impl Default for Layout {
    fn default() -> Self {
        Self {
            version: 1,
            navigator_width: 210.,
            inspector_width: 235.,
            windows: BTreeMap::new(),
            docks: default_docks(),
            floating_panels: Default::default(),
        }
    }
}
impl Layout {
    fn validate(&self) -> std::result::Result<(), String> {
        if self.version != 1
            || !self.navigator_width.is_finite()
            || !self.inspector_width.is_finite()
            || !(180. ..=480.).contains(&self.navigator_width)
            || !(200. ..=480.).contains(&self.inspector_width)
            || self.docks.len() != 2
            || ["navigator", "inspector"].iter().any(|key| {
                self.docks.get(*key).is_none_or(|position| {
                    !["left", "right", "top", "bottom"].contains(&position.as_str())
                })
            })
            || self
                .docks
                .values()
                .collect::<std::collections::BTreeSet<_>>()
                .len()
                != 2
            || self.floating_panels.iter().any(|label| {
                !["navigator", "inspector", "history", "editor"].contains(&label.as_str())
            })
            || self.windows.len() > 6
            || self.windows.iter().any(|(key, g)| {
                !known(key)
                    || !g.width.is_finite()
                    || !g.height.is_finite()
                    || !(320. ..=8192.).contains(&g.width)
                    || !(240. ..=8192.).contains(&g.height)
            })
        {
            return Err("layout_invalid".into());
        }
        Ok(())
    }
}
fn known(label: &str) -> bool {
    [
        "controls",
        "editor",
        "canvas",
        "navigator",
        "inspector",
        "history",
    ]
    .contains(&label)
}
pub struct Store {
    value: Arc<Mutex<Layout>>,
    worker: autosave::Worker,
    closing: std::sync::atomic::AtomicBool,
}
fn write(path: &std::path::Path, value: &Layout) -> std::result::Result<(), String> {
    use std::io::Write;
    value.validate()?;
    let mut tmp = tempfile::NamedTempFile::new_in(path.parent().ok_or("layout_failed")?)
        .map_err(|_| "layout_failed")?;
    serde_json::to_writer(tmp.as_file_mut(), value).map_err(|_| "layout_failed")?;
    tmp.flush()
        .and_then(|_| tmp.as_file().sync_all())
        .map_err(|_| "layout_failed")?;
    tmp.persist(path).map_err(|_| "layout_failed")?;
    Ok(())
}
impl Store {
    pub fn load(path: std::path::PathBuf) -> std::result::Result<Self, String> {
        let value = std::fs::read(&path)
            .ok()
            .filter(|bytes| bytes.len() <= 8192)
            .and_then(|bytes| serde_json::from_slice::<Layout>(&bytes).ok())
            .filter(|v| v.validate().is_ok())
            .unwrap_or_default();
        let value = Arc::new(Mutex::new(value));
        let captured = value.clone();
        let worker = autosave::Worker::new(move || {
            let value = captured.lock().map_err(|_| "layout_failed")?.clone();
            write(&path, &value)
        })
        .map_err(|_| "layout_failed")?;
        Ok(Self {
            value,
            worker,
            closing: std::sync::atomic::AtomicBool::new(false),
        })
    }
    pub fn value(&self) -> std::result::Result<Layout, String> {
        self.value
            .lock()
            .map(|v| v.clone())
            .map_err(|_| "layout_failed".into())
    }
    pub fn begin_shutdown(&self) {
        self.closing
            .store(true, std::sync::atomic::Ordering::Relaxed);
    }
    pub fn closed_panel(&self, panel: &str) {
        if !self.closing.load(std::sync::atomic::Ordering::Relaxed) {
            let _ = self.float(panel, false);
        }
    }
    pub fn float(&self, panel: &str, floating: bool) -> std::result::Result<(), String> {
        if !["navigator", "inspector", "history", "editor"].contains(&panel) {
            return Err("layout_invalid".into());
        }
        let mut value = self.value.lock().map_err(|_| "layout_failed")?;
        let changed = if floating {
            value.floating_panels.insert(panel.into())
        } else {
            value.floating_panels.remove(panel)
        };
        drop(value);
        if changed {
            self.worker.request();
        }
        Ok(())
    }
    pub fn flush(&self) -> std::result::Result<(), String> {
        self.worker.flush()
    }
    pub fn remember(&self, window: &tauri::Window) {
        if !known(window.label())
            || window.is_minimized().unwrap_or(false)
            || window.is_maximized().unwrap_or(false)
        {
            return;
        }
        let (Ok(position), Ok(size), Ok(scale)) = (
            window.outer_position(),
            window.inner_size(),
            window.scale_factor(),
        ) else {
            return;
        };
        let geometry = Geometry {
            x: position.x,
            y: position.y,
            width: f64::from(size.width) / scale,
            height: f64::from(size.height) / scale,
        };
        if !(320. ..=8192.).contains(&geometry.width) || !(240. ..=8192.).contains(&geometry.height)
        {
            return;
        }
        if let Ok(mut value) = self.value.lock() {
            if value.windows.get(window.label()) == Some(&geometry) {
                return;
            }
            value.windows.insert(window.label().into(), geometry);
            drop(value);
            self.worker.request();
        }
    }
    pub fn apply(&self, window: &tauri::Window) {
        let Some(saved) = self
            .value()
            .ok()
            .and_then(|value| value.windows.get(window.label()).cloned())
        else {
            return;
        };
        let Ok(monitors) = window.available_monitors() else {
            return;
        };
        let monitor = monitors
            .iter()
            .find(|m| {
                let p = m.position();
                let s = m.size();
                i64::from(saved.x) >= i64::from(p.x)
                    && i64::from(saved.x) < i64::from(p.x) + i64::from(s.width)
                    && i64::from(saved.y) >= i64::from(p.y)
                    && i64::from(saved.y) < i64::from(p.y) + i64::from(s.height)
            })
            .or_else(|| monitors.first());
        let Some(monitor) = monitor else {
            return;
        };
        let p = monitor.position();
        let s = monitor.size();
        let scale = monitor.scale_factor();
        let width = saved.width.min(f64::from(s.width) / scale).max(320.);
        let height = saved.height.min(f64::from(s.height) / scale).max(240.);
        let max_x =
            (i64::from(p.x) + i64::from(s.width) - (width * scale) as i64).max(i64::from(p.x));
        let max_y =
            (i64::from(p.y) + i64::from(s.height) - (height * scale) as i64).max(i64::from(p.y));
        let _ = window.set_size(tauri::LogicalSize::new(width, height));
        let _ = window.set_position(tauri::PhysicalPosition::new(
            i64::from(saved.x).clamp(i64::from(p.x), max_x) as i32,
            i64::from(saved.y).clamp(i64::from(p.y), max_y) as i32,
        ));
    }
    pub fn dock(&self, panel: &str, position: &str) -> std::result::Result<Layout, String> {
        let mut value = self.value.lock().map_err(|_| "layout_failed")?;
        let mut next = value.clone();
        let previous = next.docks.get(panel).ok_or("layout_invalid")?.clone();
        if let Some(other) = next
            .docks
            .iter()
            .find(|(name, slot)| name.as_str() != panel && slot.as_str() == position)
            .map(|(name, _)| name.clone())
        {
            next.docks.insert(other, previous);
        }
        next.docks.insert(panel.into(), position.into());
        next.validate()?;
        *value = next.clone();
        drop(value);
        self.worker.request();
        Ok(next)
    }
    pub fn pane(&self, panel: &str, width: f64) -> std::result::Result<Layout, String> {
        let mut value = self.value.lock().map_err(|_| "layout_failed")?;
        let mut next = value.clone();
        match panel {
            "navigator" => next.navigator_width = width,
            "inspector" => next.inspector_width = width,
            _ => return Err("layout_invalid".into()),
        }
        next.validate()?;
        *value = next.clone();
        drop(value);
        self.worker.request();
        Ok(next)
    }
}
#[tauri::command]
pub fn get_layout(
    window: tauri::WebviewWindow,
    store: tauri::State<Store>,
) -> std::result::Result<Layout, String> {
    allowed(&window)?;
    store.value()
}
#[tauri::command]
pub fn resize_panel(
    window: tauri::WebviewWindow,
    store: tauri::State<Store>,
    panel: String,
    width: f64,
) -> std::result::Result<Layout, String> {
    allowed(&window)?;
    let value = store.pane(&panel, width)?;
    window
        .app_handle()
        .emit("story://layout", &value)
        .map_err(|_| "event_error")?;
    Ok(value)
}
#[tauri::command]
pub fn dock_panel(
    window: tauri::WebviewWindow,
    store: tauri::State<Store>,
    panel: String,
    position: String,
) -> std::result::Result<Layout, String> {
    allowed(&window)?;
    let value = store.dock(&panel, &position)?;
    window
        .app_handle()
        .emit("story://layout", &value)
        .map_err(|_| "event_error")?;
    Ok(value)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn floating_restore_survives_shutdown_and_normal_close_redocks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("layout.json");
        let store = Store::load(path.clone()).unwrap();
        store.float("navigator", true).unwrap();
        store.float("editor", true).unwrap();
        store.float("history", true).unwrap();
        store.closed_panel("history");
        store.begin_shutdown();
        store.closed_panel("navigator");
        store.closed_panel("editor");
        store.flush().unwrap();
        let restored = Store::load(path).unwrap();
        assert!(
            restored
                .value()
                .unwrap()
                .floating_panels
                .contains("navigator")
        );
        assert!(
            !restored
                .value()
                .unwrap()
                .floating_panels
                .contains("history")
        );
        assert!(restored.value().unwrap().floating_panels.contains("editor"));
        // Existing v1 layouts omit this field and retain their original docks.
        let mut legacy = serde_json::to_value(Layout::default()).unwrap();
        legacy.as_object_mut().unwrap().remove("floatingPanels");
        assert_eq!(
            serde_json::from_value::<Layout>(legacy).unwrap(),
            Layout::default()
        );
    }
    #[test]
    fn layout_roundtrip_invalid_input_and_background_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("layout.json");
        let store = Store::load(path.clone()).unwrap();
        store.pane("navigator", 300.).unwrap();
        store.float("navigator", true).unwrap();
        store.float("history", true).unwrap();
        store.float("history", false).unwrap();
        assert!(store.float("unknown", true).is_err());
        let state = store.dock("navigator", "right").unwrap();
        assert_eq!(
            state.floating_panels.iter().collect::<Vec<_>>(),
            vec!["navigator"]
        );
        assert_eq!(state.docks["inspector"], "left");
        assert!(store.dock("navigator", "center").is_err());
        assert!(store.dock("unknown", "top").is_err());
        assert!(store.pane("navigator", f64::NAN).is_err());
        assert!(store.pane("document", 250.).is_err());
        assert_eq!(store.value().unwrap(), state);
        store.worker.flush().unwrap();
        let next = Store::load(path.clone()).unwrap();
        assert_eq!(next.value().unwrap(), state);
        drop(next);
        drop(store);
        std::fs::write(&path, b"invalid").unwrap();
        assert_eq!(
            Store::load(path).unwrap().value().unwrap(),
            Layout::default()
        );
    }
}
