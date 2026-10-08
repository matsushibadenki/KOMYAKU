//! Side windows are projections of the shared Rust engine; they own no manuscript.
use super::*;
const PANELS: [&str; 3] = ["navigator", "inspector", "history"];
fn valid(panel: &str) -> std::result::Result<(), String> {
    if PANELS.contains(&panel) {
        Ok(())
    } else {
        Err("layout_invalid".into())
    }
}
pub fn active(app: &tauri::AppHandle) -> Vec<String> {
    PANELS
        .iter()
        .chain(std::iter::once(&"editor"))
        .filter(|label| app.get_webview_window(label).is_some())
        .map(|label| (*label).into())
        .collect()
}
pub fn publish(app: &tauri::AppHandle) {
    let _ = app.emit("story://floating-panels", active(app));
}
#[tauri::command]
pub fn floating_panels(window: tauri::WebviewWindow) -> std::result::Result<Vec<String>, String> {
    allowed(&window)?;
    Ok(active(window.app_handle()))
}
#[tauri::command]
pub fn float_side_panel(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    panel: String,
    floating: bool,
) -> std::result::Result<(), String> {
    allowed(&window)?;
    valid(&panel)?;
    set(window.app_handle(), host.inner(), &panel, floating)
}
pub fn set(
    app: &tauri::AppHandle,
    host: &Host,
    panel: &str,
    floating: bool,
) -> std::result::Result<(), String> {
    valid(panel)?;
    let layout = app.state::<layout::Store>();
    if let Some(existing) = app.get_webview_window(panel) {
        if floating {
            existing.set_focus().map_err(|_| "panel_failed")?;
            layout.float(panel, true)?;
        } else {
            existing.close().map_err(|_| "panel_failed")?;
        }
        return Ok(());
    }
    if !floating {
        layout.float(panel, false)?;
        return Ok(());
    }
    host.engine
        .register_view(
            panel,
            Viewport {
                origin: [0., 0.],
                zoom: 1.,
                size: [420., 680.],
            },
        )
        .map_err(|e| e.code)?;
    let built = tauri::WebviewWindowBuilder::new(
        app,
        panel,
        tauri::WebviewUrl::App(format!("index.html?panel={panel}").into()),
    )
    .title(format!("KOMYAKU · {panel}"))
    .inner_size(420., 680.)
    .min_inner_size(320., 300.)
    .build();
    match built {
        Ok(_) => {
            if let Some(created) = app.get_window(panel) {
                app.state::<layout::Store>().apply(&created);
            }
            layout.float(panel, true)?;
            publish(app);
            Ok(())
        }
        Err(_) => {
            let _ = host.engine.remove_view(panel);
            Err("panel_failed".into())
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn labels_are_closed() {
        for label in PANELS {
            assert!(valid(label).is_ok());
        }
        for label in ["controls", "editor", "canvas", "../navigator", ""] {
            assert!(valid(label).is_err());
        }
    }
}
