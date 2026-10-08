//! Image import stays in Rust; the UI receives only a bounded, normalized asset.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::{ImageDecoder, ImageFormat, ImageReader};
use serde::Serialize;
use std::{
    io::{Cursor, Read},
    path::Path,
};
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    id: unge_core::Id,
    data: String,
    width: u32,
    height: u32,
}
fn normalize(path: &Path) -> Result<Asset, String> {
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .map_err(|_| "portrait_invalid")?
        .take(8 * 1024 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "portrait_invalid")?;
    if bytes.len() > 8 * 1024 * 1024 {
        return Err("portrait_invalid".into());
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "portrait_invalid")?;
    if !matches!(
        reader.format(),
        Some(ImageFormat::Png | ImageFormat::Jpeg | ImageFormat::WebP)
    ) {
        return Err("portrait_invalid".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| "portrait_invalid")?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image = image::DynamicImage::from_decoder(decoder).map_err(|_| "portrait_invalid")?;
    image.apply_orientation(orientation);
    let image = image.thumbnail(1536, 1536);
    let width = image.width();
    let height = image.height();
    let mut png = Cursor::new(Vec::new());
    image
        .write_to(&mut png, ImageFormat::Png)
        .map_err(|_| "portrait_invalid")?;
    if png.get_ref().len() > 8 * 1024 * 1024 {
        return Err("portrait_invalid".into());
    }
    Ok(Asset {
        id: unge_core::Id::new_v4(),
        data: format!("data:image/png;base64,{}", STANDARD.encode(png.get_ref())),
        width,
        height,
    })
}
#[tauri::command]
pub async fn import_manuscript_image(
    window: tauri::WebviewWindow,
) -> Result<Option<Asset>, String> {
    super::allowed(&window)?;
    tauri::async_runtime::spawn_blocking(|| {
        let Some(path) = rfd::FileDialog::new()
            .add_filter("PNG / JPEG / WebP", &["png", "jpg", "jpeg", "webp"])
            .pick_file()
        else {
            return Ok(None);
        };
        normalize(&path).map(Some)
    })
    .await
    .map_err(|_| "portrait_invalid".to_owned())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn imports_preserve_aspect_and_refuse_other_formats() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("image.png");
        image::RgbImage::new(2400, 1200).save(&path).unwrap();
        let asset = normalize(&path).unwrap();
        assert_eq!((asset.width, asset.height), (1536, 768));
        assert!(asset.data.starts_with("data:image/png;base64,"));
        std::fs::write(&path, b"<svg/>").unwrap();
        assert!(normalize(&path).is_err());
    }
}
