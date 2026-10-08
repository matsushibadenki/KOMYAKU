//! Bounded import previews retain original image bytes only in Rust until adoption.
use super::*;
use std::collections::BTreeMap;
#[derive(Default)]
pub struct Store(Mutex<BTreeMap<String, Import>>);
struct Import {
    token: Id,
    scene: Id,
    revision: u64,
    bytes: Vec<u8>,
}
#[derive(Serialize)]
pub struct Preview {
    token: Id,
    image: String,
}
#[tauri::command]
pub async fn prepare_portrait(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    id: Id,
    expected_revision: u64,
) -> std::result::Result<Option<Preview>, String> {
    allowed(&window)?;
    let host = app.state::<Host>();
    let (doc, summary) = host.engine.snapshot_with_summary().map_err(|e| e.code)?;
    if summary.revision != expected_revision {
        return Err("revision_conflict".into());
    }
    if doc
        .graph()
        .nodes()
        .get(&id)
        .is_none_or(|n| n.type_id != domain::CHARACTER)
    {
        return Err("invalid_command".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("PNG / JPEG / WebP", &["png", "jpg", "jpeg", "webp"])
            .pick_file()
        else {
            return Ok(None);
        };
        use std::io::Read;
        let mut bytes = Vec::new();
        std::fs::File::open(path)
            .map_err(|_| "portrait_invalid")?
            .take(8 * 1024 * 1024 + 1)
            .read_to_end(&mut bytes)
            .map_err(|_| "portrait_invalid")?;
        let image = unge_render::normalize_portrait(&bytes)?;
        let token = Id::new_v4();
        app.state::<Store>()
            .0
            .lock()
            .map_err(|_| "state_unavailable")?
            .insert(
                window.label().into(),
                Import {
                    token,
                    scene: id,
                    revision: expected_revision,
                    bytes,
                },
            );
        Ok(Some(Preview { token, image }))
    })
    .await
    .map_err(|_| "portrait_invalid".to_owned())?
}
#[tauri::command]
pub async fn crop_portrait(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    token: Id,
    x: f32,
    y: f32,
    zoom: f32,
    apply: bool,
) -> std::result::Result<Value, String> {
    allowed(&window)?;
    tauri::async_runtime::spawn_blocking(move || {
        let store = app.state::<Store>();
        let imports = store.0.lock().map_err(|_| "state_unavailable")?;
        let import = imports
            .get(window.label())
            .filter(|i| i.token == token)
            .ok_or("portrait_invalid")?;
        let image = unge_render::normalize_portrait_at(&import.bytes, x, y, zoom)?;
        if !apply {
            return Ok(json!({"image":image}));
        }
        let id = import.scene;
        let revision = import.revision;
        drop(imports);
        let result = edit_blocking(
            window.clone(),
            app.state::<Host>().inner().clone(),
            revision,
            Action::Property {
                id,
                key: "portrait".into(),
                value: json!(image),
            },
        )?;
        store
            .0
            .lock()
            .map_err(|_| "state_unavailable")?
            .remove(window.label());
        Ok(result)
    })
    .await
    .map_err(|_| "portrait_invalid".to_owned())?
}
#[tauri::command]
pub fn cancel_portrait(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    token: Id,
) -> std::result::Result<(), String> {
    allowed(&window)?;
    let store = app.state::<Store>();
    let mut imports = store.0.lock().map_err(|_| "state_unavailable")?;
    if imports
        .get(window.label())
        .is_some_and(|i| i.token == token)
    {
        imports.remove(window.label());
    }
    Ok(())
}
