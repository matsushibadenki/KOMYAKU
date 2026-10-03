//! Bounded, normalized document images. Pixels never travel through the WebView per frame.
use base64::{Engine as _, engine::general_purpose::STANDARD};
use image::ImageDecoder;
use std::{
    collections::BTreeMap,
    hash::{Hash, Hasher},
    io::Cursor,
    sync::{Arc, Mutex, OnceLock, Weak},
};

pub const PORTRAIT_SIZE: u32 = 128;
pub const PORTRAIT_SLOTS: usize = 256;
const PREFIX: &str = "data:image/png;base64,";
const MAX_ENCODED: usize = 100_000;
#[derive(Debug)]
pub struct Portrait {
    pub key: u64,
    pub rgba: Vec<u8>,
    encoded: String,
}
pub fn portrait_key(encoded: &str) -> u64 {
    let mut hash = std::collections::hash_map::DefaultHasher::new();
    encoded.hash(&mut hash);
    hash.finish()
}
/// Import PNG/JPEG/WebP, center crop, discard metadata, and store a portable PNG.
pub fn normalize_portrait(bytes: &[u8]) -> Result<String, String> {
    if bytes.is_empty() || bytes.len() > 8 * 1024 * 1024 {
        return Err("portrait_invalid".into());
    }
    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "portrait_invalid")?;
    if !matches!(
        reader.format(),
        Some(image::ImageFormat::Png | image::ImageFormat::Jpeg | image::ImageFormat::WebP)
    ) {
        return Err("portrait_invalid".into());
    }
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(8192);
    limits.max_image_height = Some(8192);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(|_| "portrait_invalid")?;
    if decoder.total_bytes() > 128 * 1024 * 1024 {
        return Err("portrait_invalid".into());
    }
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut image = image::DynamicImage::from_decoder(decoder).map_err(|_| "portrait_invalid")?;
    image.apply_orientation(orientation);
    let image = image
        .resize_to_fill(
            PORTRAIT_SIZE,
            PORTRAIT_SIZE,
            image::imageops::FilterType::Lanczos3,
        )
        .to_rgba8();
    let mut png = Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(image)
        .write_to(&mut png, image::ImageFormat::Png)
        .map_err(|_| "portrait_invalid")?;
    Ok(format!("{PREFIX}{}", STANDARD.encode(png.into_inner())))
}
pub fn decode_portrait(encoded: &str) -> Option<Arc<Portrait>> {
    if encoded.len() > MAX_ENCODED {
        return None;
    }
    let body = encoded.strip_prefix(PREFIX)?;
    static CACHE: OnceLock<Mutex<BTreeMap<u64, Weak<Portrait>>>> = OnceLock::new();
    let key = portrait_key(encoded);
    let cache = CACHE.get_or_init(Default::default);
    if let Some(found) = cache.lock().ok()?.get(&key).and_then(Weak::upgrade)
        && found.encoded == encoded
    {
        return Some(found);
    }
    let bytes = STANDARD.decode(body).ok()?;
    let reader = image::ImageReader::with_format(Cursor::new(&bytes), image::ImageFormat::Png);
    if reader.into_dimensions().ok()? != (PORTRAIT_SIZE, PORTRAIT_SIZE) {
        return None;
    }
    let rgba = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .ok()?
        .to_rgba8()
        .into_raw();
    let portrait = Arc::new(Portrait {
        key,
        rgba,
        encoded: encoded.to_owned(),
    });
    let mut cache = cache.lock().ok()?;
    cache.retain(|_, value| value.strong_count() > 0);
    if cache.len() < PORTRAIT_SLOTS {
        cache.insert(key, Arc::downgrade(&portrait));
    }
    Some(portrait)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn normalized_images_are_portable_bounded_and_cached() {
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(300, 180)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let encoded = normalize_portrait(bytes.get_ref()).unwrap();
        let first = decode_portrait(&encoded).unwrap();
        assert_eq!(first.rgba.len(), 128 * 128 * 4);
        assert!(Arc::ptr_eq(&first, &decode_portrait(&encoded).unwrap()));
        assert!(encoded.len() < MAX_ENCODED);
    }
    #[test]
    fn jpeg_orientation_and_webp_are_supported() {
        let source = image::RgbImage::from_fn(128, 128, |_, y| {
            image::Rgb(if y < 64 { [255, 0, 0] } else { [0, 0, 255] })
        });
        let mut jpeg = Cursor::new(Vec::new());
        image::DynamicImage::ImageRgb8(source)
            .write_to(&mut jpeg, image::ImageFormat::Jpeg)
            .unwrap();
        // EXIF orientation 6: the original top half becomes the right half.
        let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut oriented = vec![0xff, 0xd8, 0xff, 0xe1];
        oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        oriented.extend_from_slice(exif);
        oriented.extend_from_slice(&jpeg.get_ref()[2..]);
        let portrait = decode_portrait(&normalize_portrait(&oriented).unwrap()).unwrap();
        let left = (64 * 128 + 32) * 4;
        let right = (64 * 128 + 96) * 4;
        assert!(portrait.rgba[left + 2] > 240 && portrait.rgba[left] < 15);
        assert!(portrait.rgba[right] > 240 && portrait.rgba[right + 2] < 15);
        let mut webp = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(64, 32)
            .write_to(&mut webp, image::ImageFormat::WebP)
            .unwrap();
        assert!(decode_portrait(&normalize_portrait(webp.get_ref()).unwrap()).is_some());
    }
    #[test]
    fn invalid_and_oversized_inputs_are_rejected() {
        assert!(normalize_portrait(b"not an image").is_err());
        assert!(normalize_portrait(&vec![0; 8 * 1024 * 1024 + 1]).is_err());
        assert!(decode_portrait("data:image/svg+xml;base64,PHN2Zz4=").is_none());
        let mut png = Cursor::new(Vec::new());
        image::DynamicImage::new_rgb8(129, 128)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        assert!(
            decode_portrait(&format!("{PREFIX}{}", STANDARD.encode(png.into_inner()))).is_none()
        );
    }
}
