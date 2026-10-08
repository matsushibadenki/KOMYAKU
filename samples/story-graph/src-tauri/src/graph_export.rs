//! Relationship graph export captures one immutable snapshot and uses native GPU rendering.
use super::*;
use std::collections::BTreeSet;
fn capture(
    document: &Document,
    language: &str,
) -> std::result::Result<(unge_render::Scene, unge_core::Viewport), String> {
    let mut editor = Editor::new(document.clone(), 0).map_err(|_| "graph_export_failed")?;
    let commands = document
        .graph()
        .nodes()
        .values()
        .filter(|n| ![domain::CHARACTER, domain::RELATION].contains(&n.type_id.as_str()))
        .map(|n| Command::RemoveNode { id: n.id })
        .collect();
    editor
        .execute(Command::Batch { commands })
        .map_err(|_| "graph_export_failed")?;
    let document = editor.document();
    let bounds = unge_render::minimap_bounds(document.placement().values().map(|r| Rect {
        x: r.x - 24.,
        y: r.y - 48.,
        width: r.width + 48.,
        height: r.height + 72.,
    }))
    .ok_or("graph_export_empty")?;
    let size = [1536., 1024.];
    let zoom = ((size[0] - 96.) / bounds.width)
        .min((size[1] - 96.) / bounds.height)
        .min(4.);
    if zoom < 0.02 {
        return Err("graph_export_too_large".into());
    }
    let viewport = unge_core::Viewport {
        origin: [
            bounds.x + bounds.width / 2. - size[0] / zoom / 2.,
            bounds.y + bounds.height / 2. - size[1] / zoom / 2.,
        ],
        zoom,
        size,
    };
    let mut scene = unge_render::SceneIndex::new(document)
        .without_minimap()
        .scene_with_labels(
            viewport,
            &BTreeSet::new(),
            &unge_interaction::Preview::default(),
            &labels(&domain::registry()),
            match language {
                "ja" => Locale::Ja,
                "zh-CN" => Locale::ZhCn,
                _ => Locale::En,
            },
        )
        .map_err(|_| "graph_export_failed")?;
    let top = viewport.to_world([32., 8.]);
    scene.labels.push(unge_render::TextLabel {
        text: document
            .title
            .chars()
            .take(256)
            .map(|c| if c.is_control() { ' ' } else { c })
            .collect(),
        rect: Rect {
            x: top[0],
            y: top[1],
            width: (size[0] - 64.) / zoom,
            height: 48. / zoom,
        },
        font_size: (20. / zoom).min(512.),
        right_aligned: false,
        color: [0.16, 0.17, 0.21, 1.],
        after_quad: scene.quads.len(),
    });
    Ok((scene, viewport))
}
fn image_pdf(png: &[u8]) -> std::result::Result<Vec<u8>, String> {
    use pdf_writer::{Content, Filter, Finish, Name, Pdf, Rect as PdfRect, Ref};
    use std::io::Write;
    let image = image::load_from_memory_with_format(png, image::ImageFormat::Png)
        .map_err(|_| "graph_export_failed")?
        .to_rgb8();
    let mut compressed =
        flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
    compressed
        .write_all(image.as_raw())
        .map_err(|_| "graph_export_failed")?;
    let compressed = compressed.finish().map_err(|_| "graph_export_failed")?;
    let mut pdf = Pdf::new();
    let catalog = Ref::new(1);
    let pages = Ref::new(2);
    let page = Ref::new(3);
    let image_id = Ref::new(4);
    let stream = Ref::new(5);
    pdf.catalog(catalog).pages(pages);
    pdf.pages(pages).kids([page]).count(1);
    let mut image_object = pdf.image_xobject(image_id, &compressed);
    image_object
        .width(image.width() as i32)
        .height(image.height() as i32)
        .bits_per_component(8);
    image_object.filter(Filter::FlateDecode);
    image_object.color_space().device_rgb();
    image_object.finish();
    let mut page_object = pdf.page(page);
    page_object
        .parent(pages)
        .media_box(PdfRect::new(0., 0., 842., 595.))
        .contents(stream);
    page_object
        .resources()
        .x_objects()
        .pair(Name(b"Graph"), image_id);
    page_object.finish();
    let mut content = Content::new();
    content
        .transform([794., 0., 0., 794. * 2. / 3., 24., 32.])
        .x_object(Name(b"Graph"));
    pdf.stream(stream, &content.finish());
    Ok(pdf.finish())
}
#[tauri::command]
pub async fn export_graph(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    format: String,
    language: String,
) -> std::result::Result<Option<String>, String> {
    allowed(&window)?;
    if !matches!(format.as_str(), "png" | "pdf") {
        return Err("graph_export_invalid".into());
    }
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let document = host.engine.snapshot().map_err(|e| e.code)?;
        let title = match language.as_str() {
            "en" => "Export relationship graph",
            "zh-CN" => "导出人物关系图",
            _ => "人物相関図を書き出す",
        };
        let Some(path) = rfd::FileDialog::new()
            .set_title(title)
            .set_file_name(format!("relationships.{format}"))
            .add_filter(format.to_uppercase(), &[format.as_str()])
            .save_file()
        else {
            return Ok(None);
        };
        if path
            .extension()
            .and_then(|v| v.to_str())
            .is_none_or(|v| !v.eq_ignore_ascii_case(&format))
        {
            return Err("export_extension_invalid".into());
        }
        let (scene, viewport) = capture(&document, &language)?;
        let png = pollster::block_on(unge_render::render_png(&scene, viewport, [3072, 2048]))?;
        let bytes = if format == "png" {
            png
        } else {
            image_pdf(&png)?
        };
        use std::io::Write;
        let mut temporary =
            tempfile::NamedTempFile::new_in(path.parent().ok_or("graph_export_failed")?)
                .map_err(|_| "graph_export_failed")?;
        temporary
            .write_all(&bytes)
            .and_then(|_| temporary.as_file().sync_all())
            .map_err(|_| "graph_export_failed")?;
        temporary
            .persist(&path)
            .map_err(|_| "graph_export_failed")?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "graph_export_failed".to_owned())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn relationship_capture_excludes_prose_and_minimap() {
        let mut doc = domain::initial_document(&domain::registry());
        doc.title = "雨の駅から / Relationship map".into();
        let (scene, viewport) = capture(&doc, "ja").unwrap();
        assert_eq!(scene.visible_nodes, 6);
        assert!(
            scene
                .labels
                .iter()
                .all(|label| !label.text.contains("起 · 雨の駅"))
        );
        assert!(viewport.validate().is_ok());
    }
    #[test]
    #[ignore = "requires desktop GPU and system fonts"]
    fn native_export_fixture() {
        let mut doc = domain::initial_document(&domain::registry());
        doc.title = "雨の駅から / Relationship map".into();
        let nodes = doc
            .graph()
            .nodes()
            .values()
            .filter(|n| n.type_id == domain::CHARACTER)
            .take(2)
            .map(|n| n.id)
            .collect();
        let mut editor = Editor::new(doc, 0).unwrap();
        editor
            .execute(
                character_groups::command(
                    editor.document(),
                    None,
                    "家族 / Family".into(),
                    nodes,
                    false,
                )
                .unwrap(),
            )
            .unwrap();
        let doc = editor.document();
        let (scene, viewport) = capture(doc, "ja").unwrap();
        let png =
            pollster::block_on(unge_render::render_png(&scene, viewport, [3072, 2048])).unwrap();
        std::fs::write("/private/tmp/komyaku-relationship-export.png", &png).unwrap();
        assert!(png.starts_with(b"\x89PNG"));
        let pdf = image_pdf(&png).unwrap();
        let parsed = lopdf::Document::load_mem(&pdf).unwrap();
        assert_eq!(parsed.get_pages().len(), 1);
        std::fs::write("/private/tmp/komyaku-relationship-export.pdf", pdf).unwrap();
    }
}
