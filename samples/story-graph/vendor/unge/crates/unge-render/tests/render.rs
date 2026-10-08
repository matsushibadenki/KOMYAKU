use std::collections::BTreeSet;
use unge_core::*;
use unge_render::*;
fn document() -> Document {
    let mut editor = Editor::new(Document::default(), 0).unwrap();
    editor
        .execute(Command::AddNode {
            node: Node {
                id: Id::new_v4(),
                type_id: "test".into(),
                inputs: vec![],
                outputs: vec![],
                properties: Properties::new(),
            },
            rect: Rect {
                x: 20.,
                y: 20.,
                width: 180.,
                height: 90.,
            },
        })
        .unwrap();
    editor.document().clone()
}
#[test]
fn relationship_arrows_follow_semantic_direction_and_mutual_setting() {
    let mut editor = Editor::new(Document::default(), 10).unwrap();
    let port = |name: &str| Port {
        name: name.into(),
        data_type: DataType::Float,
        cardinality: Cardinality::Single,
        required: false,
    };
    for (id, y) in [(1, 20.), (2, 200.)] {
        editor
            .execute(Command::AddNode {
                node: Node {
                    id: Id::from_u128(id),
                    type_id: "story.character".into(),
                    inputs: vec![],
                    outputs: vec![port("person")],
                    properties: Properties::new(),
                },
                rect: Rect {
                    x: 20.,
                    y,
                    width: 220.,
                    height: 110.,
                },
            })
            .unwrap();
    }
    let relation = Id::from_u128(3);
    editor
        .execute(Command::AddNode {
            node: Node {
                id: relation,
                type_id: "story.relationship".into(),
                inputs: vec![port("from"), port("to")],
                outputs: vec![],
                properties: [
                    ("kind".into(), "trust".into()),
                    ("mutual".into(), false.into()),
                ]
                .into(),
            },
            rect: Rect {
                x: 350.,
                y: 80.,
                width: 220.,
                height: 110.,
            },
        })
        .unwrap();
    for (id, name) in [(1, "from"), (2, "to")] {
        editor
            .execute(Command::Connect {
                edge: Edge {
                    id: Id::new_v4(),
                    from: Endpoint {
                        node: Id::from_u128(id),
                        port: "person".into(),
                    },
                    to: Endpoint {
                        node: relation,
                        port: name.into(),
                    },
                },
            })
            .unwrap();
    }
    let view = Viewport {
        origin: [0., 0.],
        zoom: 1.,
        size: [900., 400.],
    };
    for mutual in [false, true] {
        editor
            .execute(Command::SetProperty {
                id: relation,
                key: "mutual".into(),
                value: Some(mutual.into()),
            })
            .unwrap();
        let scene = SceneIndex::new(editor.document())
            .scene(view, &BTreeSet::new())
            .unwrap();
        let arrows: Vec<_> = scene
            .quads
            .iter()
            .filter(|quad| quad.params[2] < -0.5)
            .collect();
        assert_eq!(arrows.len(), if mutual { 4 } else { 2 });
        assert_eq!(
            arrows
                .iter()
                .filter(|quad| quad.params[0].cos() > 0.)
                .count(),
            if mutual { 2 } else { 1 }
        );
        assert_eq!(
            arrows
                .iter()
                .filter(|quad| quad.params[0].cos() < 0.)
                .count(),
            if mutual { 2 } else { 1 }
        );
        assert!(scene.quads.iter().any(|quad| quad.rect[3] == 4.));
        for zoom in [0.6, 1.5, 3.] {
            let zoomed = SceneIndex::new(editor.document())
                .scene(
                    Viewport {
                        zoom,
                        size: [2400., 1200.],
                        ..view
                    },
                    &BTreeSet::new(),
                )
                .unwrap();
            for arrow in zoomed.quads.iter().filter(|quad| quad.params[2] < -0.5) {
                assert!(arrow.rect[2] >= 17.9, "arrow length scales with the shaft");
                assert_eq!(
                    arrow.rect[3], 18.,
                    "arrow base stays distinct from the 4px shaft"
                );
                let tip = [
                    arrow.rect[0] + arrow.params[0].cos() * arrow.rect[2] / 2.,
                    arrow.rect[1] + arrow.params[0].sin() * arrow.rect[2] / 2.,
                ];
                let clearance = [
                    [240., 75.],
                    [240., 255.],
                    [350., 80. + 110. / 3.],
                    [350., 80. + 220. / 3.],
                ]
                .into_iter()
                .map(|port| (tip[0] - port[0]).hypot(tip[1] - port[1]))
                .fold(f32::INFINITY, f32::min);
                assert!(
                    (clearance - 7.).abs() < 0.1,
                    "arrow tip follows the curve outside the socket at zoom {zoom}"
                );
            }
        }
    }
}
#[test]
fn story_portraits_roles_and_relationship_colors_survive_selection_and_zoom() {
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(128, 128)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let portrait = normalize_portrait(png.get_ref()).unwrap();
    let mut editor = Editor::new(Document::default(), 10).unwrap();
    let person = Id::from_u128(1);
    for (id, kind, x, properties) in [
        (
            person,
            "story.character",
            20.,
            [
                ("title".into(), "灯".into()),
                ("role".into(), "駅員".into()),
                ("portrait".into(), portrait.into()),
            ]
            .into(),
        ),
        (
            Id::from_u128(2),
            "story.relationship",
            280.,
            [
                ("title".into(), "姉妹".into()),
                ("kind".into(), "family".into()),
            ]
            .into(),
        ),
        (
            Id::from_u128(3),
            "story.relationship",
            540.,
            [
                ("title".into(), "親友".into()),
                ("kind".into(), "friend".into()),
            ]
            .into(),
        ),
    ] {
        editor
            .execute(Command::AddNode {
                node: Node {
                    id,
                    type_id: kind.into(),
                    inputs: vec![],
                    outputs: vec![],
                    properties,
                },
                rect: Rect {
                    x,
                    y: 20.,
                    width: 220.,
                    height: 110.,
                },
            })
            .unwrap();
    }
    let view = Viewport {
        origin: [0., 0.],
        zoom: 1.,
        size: [900., 300.],
    };
    let index = SceneIndex::new(editor.document());
    let scene = index.scene(view, &[person].into()).unwrap();
    assert_eq!(scene.portraits.len(), 1);
    assert_eq!(
        scene
            .quads
            .iter()
            .filter(|quad| quad.params[3] > 0.)
            .count(),
        1
    );
    assert!(scene.labels.iter().any(|label| label.text == "駅員"));
    assert!(scene.labels.iter().any(|label| label.text == "Family"));
    let colors: Vec<_> = scene
        .labels
        .iter()
        .filter(|label| label.text == "Family" || label.text == "Friends")
        .map(|label| label.color)
        .collect();
    assert_eq!(colors.len(), 2);
    assert_ne!(colors[0], colors[1]);
    assert!(
        index
            .scene(Viewport { zoom: 0.25, ..view }, &BTreeSet::new())
            .unwrap()
            .labels
            .is_empty()
    );
    assert!(
        index
            .scene(
                Viewport {
                    origin: [2000., 0.],
                    ..view
                },
                &BTreeSet::new()
            )
            .unwrap()
            .portraits
            .is_empty()
    );
}
#[test]
fn culls_nodes_and_reduces_ports_at_low_zoom() {
    let index = SceneIndex::new(&document());
    let view = Viewport {
        origin: [0., 0.],
        zoom: 1.,
        size: [256., 256.],
    };
    assert_eq!(
        index.scene(view, &BTreeSet::new()).unwrap().visible_nodes,
        1
    );
    assert_eq!(
        index
            .scene(
                Viewport {
                    origin: [1000., 1000.],
                    ..view
                },
                &BTreeSet::new()
            )
            .unwrap()
            .visible_nodes,
        0
    );
    assert!(
        index
            .scene(Viewport { zoom: 0., ..view }, &BTreeSet::new())
            .is_err()
    );
}
#[test]
fn edges_crossing_viewport_survive_endpoint_culling() {
    let port = Port {
        name: "p".into(),
        data_type: DataType::Float,
        cardinality: Cardinality::Single,
        required: true,
    };
    let a = Node {
        id: Id::new_v4(),
        type_id: "test".into(),
        inputs: vec![port.clone()],
        outputs: vec![port],
        properties: Properties::new(),
    };
    let b = Node {
        id: Id::new_v4(),
        ..a.clone()
    };
    let (aid, bid) = (a.id, b.id);
    let mut editor = Editor::new(Document::default(), 0).unwrap();
    editor
        .execute(Command::Batch {
            commands: vec![
                Command::AddNode {
                    node: a,
                    rect: Rect {
                        x: -400.,
                        y: 10.,
                        width: 180.,
                        height: 90.,
                    },
                },
                Command::AddNode {
                    node: b,
                    rect: Rect {
                        x: 400.,
                        y: 10.,
                        width: 180.,
                        height: 90.,
                    },
                },
                Command::Connect {
                    edge: Edge {
                        id: Id::new_v4(),
                        from: Endpoint {
                            node: aid,
                            port: "p".into(),
                        },
                        to: Endpoint {
                            node: bid,
                            port: "p".into(),
                        },
                    },
                },
            ],
        })
        .unwrap();
    let scene = SceneIndex::new(editor.document())
        .scene(
            Viewport {
                origin: [0., 0.],
                zoom: 1.,
                size: [200., 200.],
            },
            &BTreeSet::new(),
        )
        .unwrap();
    assert_eq!(scene.visible_nodes, 0);
    assert_eq!(scene.visible_edges, 1);
    let index = SceneIndex::new(editor.document());
    let mut preview = unge_interaction::Preview::default();
    for id in [aid, bid] {
        preview.placement.insert(
            id,
            Rect {
                y: 400.,
                ..editor.document().placement()[&id]
            },
        );
    }
    let viewport = Viewport {
        origin: [0., 0.],
        zoom: 1.,
        size: [200., 200.],
    };
    assert_eq!(
        index
            .scene_with_preview(viewport, &BTreeSet::new(), &preview)
            .unwrap()
            .visible_edges,
        0
    );
    assert_eq!(
        index
            .scene_with_preview(
                Viewport {
                    origin: [0., 400.],
                    ..viewport
                },
                &BTreeSet::new(),
                &preview
            )
            .unwrap()
            .visible_edges,
        1
    );
}
#[test]
#[ignore = "requires a working GPU adapter; run explicitly on a desktop"]
fn gpu_portrait_atlas_renders_distinct_images_and_refreshes_reused_slots() {
    pollster::block_on(async {
        let adapter = wgpu::Instance::default()
            .request_adapter(&Default::default())
            .await
            .unwrap();
        let (device, queue) = adapter.request_device(&Default::default()).await.unwrap();
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        let mut editor = Editor::new(Document::default(), 0).unwrap();
        for (i, color) in [[255, 0, 0, 255], [0, 0, 255, 255]].into_iter().enumerate() {
            let image = image::RgbaImage::from_pixel(128, 128, image::Rgba(color));
            let mut png = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(image)
                .write_to(&mut png, image::ImageFormat::Png)
                .unwrap();
            editor
                .execute(Command::AddNode {
                    node: Node {
                        id: Id::from_u128(i as u128 + 1),
                        type_id: "story.character".into(),
                        inputs: vec![],
                        outputs: vec![],
                        properties: [
                            ("title".into(), "Person".into()),
                            (
                                "portrait".into(),
                                normalize_portrait(png.get_ref()).unwrap().into(),
                            ),
                        ]
                        .into(),
                    },
                    rect: Rect {
                        x: 10. + i as f32 * 130.,
                        y: 10.,
                        width: 120.,
                        height: 110.,
                    },
                })
                .unwrap();
        }
        let view = Viewport {
            origin: [0., 0.],
            zoom: 1.,
            size: [256., 256.],
        };
        let mut scene = SceneIndex::new(editor.document())
            .scene(view, &BTreeSet::new())
            .unwrap();
        let format = wgpu::TextureFormat::Rgba8UnormSrgb;
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d {
                width: 256,
                height: 256,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 256 * 256 * 4,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut renderer = GpuRenderer::new(&device, format);
        let error = device.pop_error_scope().await;
        assert!(error.is_none(), "shader validation: {error:?}");
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        for swapped in [false, true] {
            if swapped {
                scene.portraits.reverse();
            }
            renderer.prepare(&device, &queue, &scene, view).unwrap();
            renderer.prepare(&device, &queue, &scene, view).unwrap();
            let mut encoder = device.create_command_encoder(&Default::default());
            renderer.render(&mut encoder, &texture.create_view(&Default::default()));
            encoder.copy_texture_to_buffer(
                texture.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(1024),
                        rows_per_image: Some(256),
                    },
                },
                wgpu::Extent3d {
                    width: 256,
                    height: 256,
                    depth_or_array_layers: 1,
                },
            );
            queue.submit([encoder.finish()]);
            let (tx, rx) = std::sync::mpsc::channel();
            buffer
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |result| tx.send(result).unwrap());
            device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
            rx.recv().unwrap().unwrap();
            let pixels = buffer.slice(..).get_mapped_range();
            let pixel = |x: usize| &pixels[(50 * 256 + x) * 4..(50 * 256 + x) * 4 + 4];
            assert_eq!(
                pixel(40),
                if swapped {
                    &[0, 0, 255, 255]
                } else {
                    &[255, 0, 0, 255]
                }
            );
            assert_eq!(
                pixel(170),
                if swapped {
                    &[255, 0, 0, 255]
                } else {
                    &[0, 0, 255, 255]
                }
            );
            assert!(pixel(250)[0] > 200, "paper background remains visible");
            drop(pixels);
            buffer.unmap();
        }
        assert!(device.pop_error_scope().await.is_none());
    });
}
#[test]
#[ignore = "requires a working GPU adapter; run explicitly on a desktop"]
fn gpu_renders_pixels_without_validation_errors() {
    pollster::block_on(async {
        let instance = wgpu::Instance::default();
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .expect("GPU adapter required");
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .unwrap();
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: None,
            size: wgpu::Extent3d {
                width: 256,
                height: 256,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8Unorm,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let mut renderer = GpuRenderer::new(&device, wgpu::TextureFormat::Rgba8Unorm);
        let viewport = Viewport {
            origin: [0., 0.],
            zoom: 1.,
            size: [256., 256.],
        };
        let document = document();
        let id = *document.graph().nodes().keys().next().unwrap();
        let mut preview = unge_interaction::Preview::default();
        preview.placement.insert(
            id,
            Rect {
                x: 100.,
                y: 120.,
                ..Rect::default()
            },
        );
        preview.marquee = Some(Rect {
            x: 20.,
            y: 10.,
            width: 40.,
            height: 30.,
        });
        let scene = SceneIndex::new(&document)
            .scene_with_preview(viewport, &BTreeSet::from([id]), &preview)
            .unwrap();
        renderer.prepare(&device, &queue, &scene, viewport).unwrap();
        let mut encoder = device.create_command_encoder(&Default::default());
        renderer.render_clipped(
            &mut encoder,
            &texture.create_view(&Default::default()),
            Some([48, 0, 208, 256]),
        );
        let buffer = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 256 * 256 * 4,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        encoder.copy_texture_to_buffer(
            texture.as_image_copy(),
            wgpu::TexelCopyBufferInfo {
                buffer: &buffer,
                layout: wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(1024),
                    rows_per_image: Some(256),
                },
            },
            wgpu::Extent3d {
                width: 256,
                height: 256,
                depth_or_array_layers: 1,
            },
        );
        queue.submit([encoder.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        buffer
            .slice(..)
            .map_async(wgpu::MapMode::Read, move |result| {
                tx.send(result).unwrap();
            });
        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
        rx.recv().unwrap().unwrap();
        let pixels = buffer.slice(..).get_mapped_range();
        let center = &pixels[(160 * 256 + 160) * 4..(160 * 256 + 160) * 4 + 4];
        assert!(
            center[0] > 18 && center[0] < 30,
            "node body pixel: {center:?}"
        );
        assert_eq!(center[3], 255);
        let background = &pixels[(60 * 256 + 60) * 4..(60 * 256 + 60) * 4 + 4];
        assert!(background[0] < 18);
        let reserved = &pixels[(15 * 256 + 20) * 4..(15 * 256 + 20) * 4 + 4];
        assert!(
            reserved[0] < 18,
            "menu strip must exclude marquee geometry: {reserved:?}"
        );
        drop(pixels);
        buffer.unmap();
        assert!(device.pop_error_scope().await.is_none());
    });
}

#[test]
fn preview_reuses_committed_index_without_ghost_nodes_and_validates_geometry() {
    let doc = document();
    let id = *doc.graph().nodes().keys().next().unwrap();
    let index = SceneIndex::new(&doc);
    let viewport = Viewport {
        origin: [0., 0.],
        zoom: 1.,
        size: [256., 256.],
    };
    let mut preview = unge_interaction::Preview::default();
    preview.placement.insert(
        id,
        Rect {
            x: 1000.,
            y: 1000.,
            ..Rect::default()
        },
    );
    assert_eq!(
        index
            .scene_with_preview(viewport, &BTreeSet::new(), &preview)
            .unwrap()
            .visible_nodes,
        0
    );
    assert_eq!(
        index
            .scene_with_preview(
                Viewport {
                    origin: [1000., 1000.],
                    ..viewport
                },
                &BTreeSet::new(),
                &preview
            )
            .unwrap()
            .visible_nodes,
        1
    );
    assert_eq!(
        index
            .scene(viewport, &BTreeSet::new())
            .unwrap()
            .visible_nodes,
        1
    );
    assert_eq!(doc.placement()[&id].x, 20.);
    preview.placement.get_mut(&id).unwrap().x = f32::NAN;
    assert!(
        index
            .scene_with_preview(viewport, &BTreeSet::new(), &preview)
            .is_err()
    );
}

#[test]
fn labels_localize_without_changing_ports_follow_previews_and_obey_lod() {
    let mut editor = Editor::new(document(), 0).unwrap();
    let mut node = editor
        .document()
        .graph()
        .nodes()
        .values()
        .next()
        .unwrap()
        .clone();
    let id = node.id;
    editor.execute(Command::RemoveNode { id }).unwrap();
    let port = |name: &str| Port {
        name: name.into(),
        data_type: DataType::Float,
        cardinality: Cardinality::Single,
        required: false,
    };
    node.inputs = vec![port("a"), port("b")];
    node.outputs = vec![port("value")];
    editor
        .execute(Command::AddNode {
            node,
            rect: Rect::default(),
        })
        .unwrap();
    let index = SceneIndex::new(editor.document());
    let catalog = [(
        "test".into(),
        NodeLabels {
            title: LabelText {
                en: "Sum".into(),
                ja: "加算".into(),
                zh_cn: "加法".into(),
            },
            inputs: [(
                "a".into(),
                LabelText {
                    en: "Input A".into(),
                    ja: "入力 A".into(),
                    zh_cn: "输入 A".into(),
                },
            )]
            .into(),
            ..Default::default()
        },
    )]
    .into();
    let view = Viewport {
        origin: [0., 0.],
        zoom: 1.,
        size: [512., 512.],
    };
    let mut preview = unge_interaction::Preview::default();
    preview.placement.insert(
        id,
        Rect {
            x: 80.,
            y: 50.,
            ..Rect::default()
        },
    );
    for (locale, title, input) in [
        (Locale::En, "Sum", "Input A"),
        (Locale::Ja, "加算", "入力 A"),
        (Locale::ZhCn, "加法", "输入 A"),
    ] {
        let scene = index
            .scene_with_labels(view, &BTreeSet::new(), &preview, &catalog, locale)
            .unwrap();
        assert_eq!(scene.labels.len(), 4);
        assert_eq!(scene.labels[0].text, title);
        assert_eq!(scene.labels[1].text, input);
        assert_eq!(scene.labels[2].text, "b");
        assert_eq!(scene.labels[3].text, "value");
        assert!(scene.labels[3].right_aligned);
        assert_eq!(scene.labels[0].rect.x, 92.);
        assert!(
            scene
                .labels
                .iter()
                .all(|l| l.after_quad == scene.quads.len())
        );
    }
    assert!(
        index
            .scene(Viewport { zoom: 0.25, ..view }, &BTreeSet::new())
            .unwrap()
            .labels
            .is_empty()
    );
    assert_eq!(
        index
            .scene(Viewport { zoom: 0.65, ..view }, &BTreeSet::new())
            .unwrap()
            .labels
            .len(),
        1
    );
    assert!(
        index
            .scene(
                Viewport {
                    origin: [2000., 2000.],
                    ..view
                },
                &BTreeSet::new()
            )
            .unwrap()
            .labels
            .is_empty()
    );
    assert_eq!(editor.document().graph().nodes()[&id].inputs[0].name, "a");
}

#[test]
fn label_metadata_is_bounded_and_stacking_matches_node_order() {
    let mut editor = Editor::new(document(), 0).unwrap();
    let first = editor
        .document()
        .graph()
        .nodes()
        .values()
        .next()
        .unwrap()
        .clone();
    editor
        .execute(Command::AddNode {
            node: Node {
                id: Id::new_v4(),
                ..first
            },
            rect: Rect::default(),
        })
        .unwrap();
    let catalog = [(
        "test".into(),
        NodeLabels {
            title: LabelText {
                en: format!("line\n{}", "数".repeat(1000)),
                ..Default::default()
            },
            ..Default::default()
        },
    )]
    .into();
    let scene = SceneIndex::new(editor.document())
        .scene_with_labels(
            Viewport {
                origin: [0., 0.],
                zoom: 1.,
                size: [256., 256.],
            },
            &BTreeSet::new(),
            &Default::default(),
            &catalog,
            Locale::En,
        )
        .unwrap();
    assert_eq!(scene.labels.len(), 2);
    assert_eq!(scene.labels[0].text.chars().count(), 256);
    assert!(!scene.labels[0].text.contains('\n'));
    assert!(scene.labels[0].after_quad < scene.labels[1].after_quad);
}

#[test]
#[ignore = "requires a GPU and system fonts covering English, Japanese and Simplified Chinese"]
fn gpu_text_clips_stacks_and_renders_cjk_at_two_pixel_densities() {
    pollster::block_on(async {
        let adapter = wgpu::Instance::default()
            .request_adapter(&Default::default())
            .await
            .unwrap();
        let (device, queue) = adapter.request_device(&Default::default()).await.unwrap();
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        let mut renderer = GpuRenderer::new(&device, wgpu::TextureFormat::Rgba8Unorm);
        let mut editor = Editor::new(Document::default(), 0).unwrap();
        for (id, x) in [(1, 20.), (2, 100.)] {
            editor
                .execute(Command::AddNode {
                    node: Node {
                        id: Id::from_u128(id),
                        type_id: "test".into(),
                        inputs: vec![],
                        outputs: vec![],
                        properties: Properties::new(),
                    },
                    rect: Rect {
                        x,
                        y: 20.,
                        width: 180.,
                        height: 90.,
                    },
                })
                .unwrap();
        }
        let view = Viewport {
            origin: [0., 0.],
            zoom: 1.,
            size: [256., 256.],
        };
        let mut scene = SceneIndex::new(editor.document())
            .scene(view, &BTreeSet::new())
            .unwrap();
        scene.labels.truncate(1);
        scene.labels[0].text = "MMMMMMMMMMMMMMMMMMMM".into();
        scene.labels.push(TextLabel {
            text: "数値 加算".into(),
            rect: Rect {
                x: 20.,
                y: 140.,
                width: 180.,
                height: 22.,
            },
            font_size: 16.,
            right_aligned: false,
            color: [1.; 4],
            after_quad: scene.quads.len(),
        });
        scene.labels.push(TextLabel {
            text: "输入 数值".into(),
            rect: Rect {
                x: 20.,
                y: 175.,
                width: 180.,
                height: 22.,
            },
            ..scene.labels[1].clone()
        });
        // Check clipping independently of occlusion, with an intentionally narrow box.
        scene.labels.push(TextLabel {
            text: "MMMMMMMMM".into(),
            rect: Rect {
                x: 20.,
                y: 210.,
                width: 25.,
                height: 22.,
            },
            ..scene.labels[1].clone()
        });
        for density in [1u32, 2] {
            let side = 256 * density;
            let texture = device.create_texture(&wgpu::TextureDescriptor {
                label: None,
                size: wgpu::Extent3d {
                    width: side,
                    height: side,
                    depth_or_array_layers: 1,
                },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::Rgba8Unorm,
                usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
                view_formats: &[],
            });
            renderer
                .prepare_sized(&device, &queue, &scene, view, [side, side])
                .unwrap();
            assert_eq!(
                renderer.text_stats().missing_glyphs,
                0,
                "install CJK fonts for this desktop test"
            );
            assert!(renderer.text_stats().visible_glyphs > 15);
            let entries = renderer.text_stats().atlas_entries;
            // A repeated frame reuses both shaping and atlas entries.
            renderer
                .prepare_sized(&device, &queue, &scene, view, [side, side])
                .unwrap();
            assert_eq!(renderer.text_stats().atlas_entries, entries);
            let mut encoder = device.create_command_encoder(&Default::default());
            renderer.render(&mut encoder, &texture.create_view(&Default::default()));
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: None,
                size: u64::from(side * side * 4),
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            encoder.copy_texture_to_buffer(
                texture.as_image_copy(),
                wgpu::TexelCopyBufferInfo {
                    buffer: &buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: 0,
                        bytes_per_row: Some(side * 4),
                        rows_per_image: Some(side),
                    },
                },
                wgpu::Extent3d {
                    width: side,
                    height: side,
                    depth_or_array_layers: 1,
                },
            );
            queue.submit([encoder.finish()]);
            let (tx, rx) = std::sync::mpsc::channel();
            buffer
                .slice(..)
                .map_async(wgpu::MapMode::Read, move |result| tx.send(result).unwrap());
            device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
            rx.recv().unwrap().unwrap();
            let pixels = buffer.slice(..).get_mapped_range();
            let bright = |x0, y0, x1, y1| -> usize {
                (y0 * density..y1 * density)
                    .flat_map(|y| {
                        (x0 * density..x1 * density).map(move |x| (y * side + x) as usize * 4)
                    })
                    .filter(|i| pixels[*i] > 120)
                    .count()
            };
            assert!(bright(33, 25, 95, 43) > 60, "English title visible");
            assert_eq!(
                bright(110, 25, 190, 43),
                0,
                "foreground node hides underlying title"
            );
            assert!(bright(20, 140, 150, 162) > 100, "Japanese glyphs visible");
            assert!(bright(20, 175, 150, 197) > 100, "Chinese glyphs visible");
            assert!(bright(20, 210, 45, 232) > 40, "narrow label visible");
            assert_eq!(bright(46, 210, 150, 232), 0, "text cannot escape clip rect");
            drop(pixels);
            buffer.unmap();
        }
        let mut invalid = scene;
        invalid.labels[0].after_quad = usize::MAX;
        assert!(renderer.prepare(&device, &queue, &invalid, view).is_err());
        assert!(device.pop_error_scope().await.is_none());
    });
}

#[test]
fn instance_titles_override_type_titles_and_are_bounded() {
    let doc = document();
    let id = *doc.graph().nodes().keys().next().unwrap();
    let mut editor = Editor::new(doc, 10).unwrap();
    editor
        .execute(Command::SetProperty {
            id,
            key: "title".into(),
            value: Some(format!("灯\n{}", "人".repeat(300)).into()),
        })
        .unwrap();
    let scene = SceneIndex::new(editor.document())
        .scene_with_preview(
            Viewport {
                origin: [0., 0.],
                zoom: 1.,
                size: [256., 256.],
            },
            &BTreeSet::new(),
            &unge_interaction::Preview::default(),
        )
        .unwrap();
    assert!(scene.labels[0].text.starts_with("灯 "));
    assert_eq!(scene.labels[0].text.chars().count(), 200);
}

#[test]
#[ignore = "manual release graph rendering benchmark; reports timings, not a timing assertion"]
fn benchmark_large_story_graphs() {
    use std::time::Instant;
    for count in [1_000, 5_000, 10_000] {
        let (document, snapshot_bytes) = large_graph_document(count);
        let start = Instant::now();
        let index = SceneIndex::new(&document);
        let indexing = start.elapsed();
        for zoom in [1., 0.1] {
            let mut samples = Vec::new();
            let mut instances = 0;
            let mut visible = 0;
            for frame in 0..100 {
                let start = Instant::now();
                let scene = index
                    .scene(
                        Viewport {
                            origin: [(frame % 10) as f32 * 100., (frame / 10) as f32 * 100.],
                            zoom,
                            size: [1100., 800.],
                        },
                        &BTreeSet::new(),
                    )
                    .unwrap();
                samples.push(start.elapsed().as_secs_f64() * 1000.);
                instances = instances.max(scene.quads.len());
                visible = visible.max(scene.visible_nodes);
            }
            samples.sort_by(f64::total_cmp);
            println!(
                "GRAPH_BENCH nodes={count} edges={} snapshot_bytes={} index_ms={:.3} zoom={zoom} scene_p50_ms={:.3} scene_p95_ms={:.3} max_quads={instances} max_visible={visible}",
                count - 1,
                snapshot_bytes,
                indexing.as_secs_f64() * 1000.,
                samples[50],
                samples[95]
            );
        }
    }
}

fn large_graph_document(count: usize) -> (Document, usize) {
    let mut value = serde_json::to_value(Document::default()).unwrap();
    let mut nodes = serde_json::Map::new();
    let mut placement = serde_json::Map::new();
    let mut edges = serde_json::Map::new();
    let mut previous = None;
    for i in 0..count {
        let id = Id::new_v4();
        let port = |name: &str| Port {
            name: name.into(),
            data_type: DataType::Float,
            cardinality: Cardinality::Single,
            required: false,
        };
        let node = Node {
            id,
            type_id: "story.scene".into(),
            inputs: vec![port("previous")],
            outputs: vec![port("next")],
            properties: Properties::from([(
                "title".into(),
                serde_json::json!(format!("Scene {i} / 場面 / 场景")),
            )]),
        };
        nodes.insert(id.to_string(), serde_json::to_value(node).unwrap());
        placement.insert(id.to_string(),serde_json::json!({"x":(i%50) as f32*260.,"y":(i/50) as f32*160.,"width":220.,"height":110.}));
        if let Some(from) = previous {
            let edge = Edge {
                id: Id::new_v4(),
                from: Endpoint {
                    node: from,
                    port: "next".into(),
                },
                to: Endpoint {
                    node: id,
                    port: "previous".into(),
                },
            };
            edges.insert(edge.id.to_string(), serde_json::to_value(edge).unwrap());
        }
        previous = Some(id);
    }
    value["graph"]["nodes"] = serde_json::Value::Object(nodes);
    value["graph"]["edges"] = serde_json::Value::Object(edges);
    value["placement"] = serde_json::Value::Object(placement);
    let bytes = serde_json::to_vec(&value).unwrap();
    let document = Document::from_json(&bytes).unwrap();
    (document, bytes.len())
}

#[test]
#[ignore = "desktop GPU timestamp and DPI benchmark; no wall-clock assertion"]
fn benchmark_native_gpu_graphs() {
    use std::time::Instant;
    pollster::block_on(async {
        let adapter = wgpu::Instance::default()
            .request_adapter(&Default::default())
            .await
            .expect("native GPU required");
        assert!(
            adapter.features().contains(wgpu::Features::TIMESTAMP_QUERY),
            "GPU timestamps required"
        );
        println!("GPU_BENCH adapter={:?}", adapter.get_info());
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                required_features: wgpu::Features::TIMESTAMP_QUERY,
                ..Default::default()
            })
            .await
            .unwrap();
        device.push_error_scope(wgpu::ErrorFilter::Validation);
        let queries = device.create_query_set(&wgpu::QuerySetDescriptor {
            label: Some("graph frame timestamps"),
            ty: wgpu::QueryType::Timestamp,
            count: 2,
        });
        let resolve = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 16,
            usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: None,
            size: 16,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        for count in [1000, 5000, 10000] {
            let (document, _) = large_graph_document(count);
            let index = SceneIndex::new(&document);
            for dpi in [1, 2] {
                let size = [1100 * dpi, 800 * dpi];
                let texture = device.create_texture(&wgpu::TextureDescriptor {
                    label: None,
                    size: wgpu::Extent3d {
                        width: size[0],
                        height: size[1],
                        depth_or_array_layers: 1,
                    },
                    mip_level_count: 1,
                    sample_count: 1,
                    dimension: wgpu::TextureDimension::D2,
                    format: wgpu::TextureFormat::Rgba8Unorm,
                    usage: wgpu::TextureUsages::RENDER_ATTACHMENT,
                    view_formats: &[],
                });
                let target = texture.create_view(&Default::default());
                let mut renderer = GpuRenderer::new(&device, wgpu::TextureFormat::Rgba8Unorm);
                for zoom in [1., 0.1] {
                    let mut gpu = Vec::new();
                    let mut invalid_timestamps = 0;
                    let mut wall = Vec::new();
                    let mut visible = 0;
                    let mut quads = 0;
                    for frame in 0..22 {
                        let start = Instant::now();
                        let viewport = Viewport {
                            origin: [(frame % 10) as f32 * 100., (frame / 10) as f32 * 100.],
                            zoom,
                            size: [1100., 800.],
                        };
                        let scene = index.scene(viewport, &BTreeSet::new()).unwrap();
                        visible = visible.max(scene.visible_nodes);
                        quads = quads.max(scene.quads.len());
                        renderer
                            .prepare_sized(&device, &queue, &scene, viewport, size)
                            .unwrap();
                        let mut encoder = device.create_command_encoder(&Default::default());
                        renderer.render_timed(&mut encoder, &target, &queries);
                        encoder.resolve_query_set(&queries, 0..2, &resolve, 0);
                        encoder.copy_buffer_to_buffer(&resolve, 0, &readback, 0, 16);
                        queue.submit([encoder.finish()]);
                        let (tx, rx) = std::sync::mpsc::channel();
                        readback
                            .slice(..)
                            .map_async(wgpu::MapMode::Read, move |value| {
                                tx.send(value).unwrap();
                            });
                        device.poll(wgpu::PollType::wait_indefinitely()).unwrap();
                        rx.recv_timeout(std::time::Duration::from_secs(30))
                            .unwrap()
                            .unwrap();
                        let mapped = readback.slice(..).get_mapped_range();
                        let begin = u64::from_le_bytes(mapped[..8].try_into().unwrap());
                        let end = u64::from_le_bytes(mapped[8..16].try_into().unwrap());
                        let elapsed = (end > begin).then(|| {
                            (end - begin) as f64 * queue.get_timestamp_period() as f64 / 1_000_000.
                        });
                        drop(mapped);
                        readback.unmap();
                        if frame >= 2 {
                            if let Some(elapsed) = elapsed {
                                gpu.push(elapsed);
                            } else {
                                invalid_timestamps += 1;
                            }
                            wall.push(start.elapsed().as_secs_f64() * 1000.);
                        }
                    }

                    gpu.sort_by(f64::total_cmp);
                    wall.sort_by(f64::total_cmp);
                    println!(
                        "GPU_BENCH nodes={count} dpi={dpi} zoom={zoom} gpu_p50_ms={:.3} gpu_p95_ms={:.3} frame_p50_ms={:.3} frame_p95_ms={:.3} max_visible={visible} max_quads={quads} invalid_timestamps={invalid_timestamps}",
                        if invalid_timestamps == 0 {
                            gpu[10]
                        } else {
                            f64::NAN
                        },
                        if invalid_timestamps == 0 {
                            gpu[19]
                        } else {
                            f64::NAN
                        },
                        wall[10],
                        wall[19]
                    );
                }
            }
        }
        assert!(device.pop_error_scope().await.is_none());
    });
}
