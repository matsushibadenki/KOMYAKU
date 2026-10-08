use crate::{LabelCatalog, TextLabel, labels::label_text};
use std::collections::{BTreeMap, BTreeSet};
use unge_core::{Document, Id, Locale, Rect, SpatialIndex, Viewport, port_anchor};
use unge_interaction::{MAX_SELECTION, PORT_LOD_ZOOM, Preview};

#[repr(C)]
#[derive(Debug, Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
pub struct Quad {
    pub rect: [f32; 4],
    pub color: [f32; 4],
    pub params: [f32; 4],
}
impl Quad {
    fn rectangle(rect: Rect, color: [f32; 4], radius: f32) -> Self {
        Self {
            rect: [
                rect.x + rect.width / 2.0,
                rect.y + rect.height / 2.0,
                rect.width,
                rect.height,
            ],
            color,
            params: [0.0, radius, 0.0, 0.0],
        }
    }
    fn line(a: [f32; 2], b: [f32; 2]) -> Self {
        let dx = b[0] - a[0];
        let dy = b[1] - a[1];
        Self {
            rect: [
                (a[0] + b[0]) / 2.0,
                (a[1] + b[1]) / 2.0,
                dx.hypot(dy).max(0.001) + 4.0,
                4.0,
            ],
            color: [0.32, 0.65, 0.74, 1.0],
            params: [dy.atan2(dx), 2.0, 0.0, 0.0],
        }
    }
}
struct RenderNode {
    rect: Rect,
    inputs: usize,
    outputs: usize,
    type_id: String,
    title: Option<String>,
    input_names: Vec<String>,
    output_names: Vec<String>,
    role: String,
    relation: String,
    accent: [f32; 4],
    portrait: Option<std::sync::Arc<crate::Portrait>>,
    mutual: bool,
}
struct RenderEdge {
    points: [[f32; 2]; 4],
    from: (Id, usize),
    to: (Id, usize),
    color: Option<[f32; 4]>,
    arrow_start: bool,
    arrow_end: bool,
}
/// Build once per document revision, not once per animation frame.
pub struct SceneIndex {
    nodes: BTreeMap<Id, RenderNode>,
    edges: BTreeMap<Id, RenderEdge>,
    node_index: SpatialIndex,
    edge_index: SpatialIndex,
    incident: BTreeMap<Id, BTreeSet<Id>>,
    story: bool,
}
#[derive(Debug, Default)]
pub struct Scene {
    pub quads: Vec<Quad>,
    pub labels: Vec<TextLabel>,
    pub visible_nodes: usize,
    pub visible_edges: usize,
    pub portraits: Vec<std::sync::Arc<crate::Portrait>>,
}
// Hallmark · modern-minimal · mineral paper graph, user palette references
// Pre-emit critique: P4 H5 E4 S5 R5 V4. Soft surfaces with crisp ink and edges.
const fn rgb(hex: u32) -> [f32; 4] {
    [
        ((hex >> 16) & 255) as f32 / 255.,
        ((hex >> 8) & 255) as f32 / 255.,
        (hex & 255) as f32 / 255.,
        1.,
    ]
}
const CANVAS: [f32; 4] = rgb(0xf4f3ef);
const PAPER: [f32; 4] = rgb(0xfcfbf7);
const INK: [f32; 4] = rgb(0x292c36);
const MUTED: [f32; 4] = rgb(0x4f5963);
const RULE: [f32; 4] = rgb(0xb5bbb9);
const SCENE_SURFACE: [f32; 4] = rgb(0xe5e1dd);
const TEAL: [f32; 4] = rgb(0x407e8c);
const SAGE: [f32; 4] = rgb(0x65704b);
const GOLD: [f32; 4] = rgb(0x806b45);
const SILVER: [f32; 4] = rgb(0x606e86);
const PLUM: [f32; 4] = rgb(0x80677a);
fn card_color(accent: [f32; 4]) -> [f32; 4] {
    if accent == TEAL {
        rgb(0xc0d5d6)
    } else if accent == SAGE {
        rgb(0xd4d3b3)
    } else if accent == GOLD {
        rgb(0xe5dcb1)
    } else if accent == SILVER {
        rgb(0xd5dbe4)
    } else {
        rgb(0xe3d6dd)
    }
}
fn character_accent(id: Id) -> [f32; 4] {
    // Mix all UUID bits: IDs sharing a sequential suffix still have distinct colors.
    let mut hash = 0xcbf29ce484222325_u64;
    for byte in id.as_u128().to_be_bytes() {
        hash = (hash ^ u64::from(byte)).wrapping_mul(0x100000001b3);
    }
    relation_color(["trust", "friend", "love", "rival", "family"][(hash % 5) as usize])
}

/// Relationship colors are shared by badges, connectors and the character accent palette.
fn relation_color(kind: &str) -> [f32; 4] {
    match kind {
        "family" => SILVER,
        "friend" => TEAL,
        "rival" => GOLD,
        "love" => PLUM,
        _ => SAGE,
    }
}
fn relation_name(kind: &str, locale: Locale) -> &str {
    match (kind, locale) {
        ("family", Locale::Ja) => "家族",
        ("friend", Locale::Ja) => "友人",
        ("rival", Locale::Ja) => "ライバル",
        ("love", Locale::Ja) => "恋愛",
        (_, Locale::Ja) => "信頼",
        ("family", Locale::ZhCn) => "家人",
        ("friend", Locale::ZhCn) => "朋友",
        ("rival", Locale::ZhCn) => "对手",
        ("love", Locale::ZhCn) => "恋爱",
        (_, Locale::ZhCn) => "信任",
        ("family", _) => "Family",
        ("friend", _) => "Friends",
        ("rival", _) => "Rivals",
        ("love", _) => "Love",
        _ => "Trust",
    }
}
fn curve(a: [f32; 2], b: [f32; 2]) -> [[f32; 2]; 4] {
    let dx = ((b[0] - a[0]).abs() * 0.5).max(50.0);
    [a, [a[0] + dx, a[1]], [b[0] - dx, b[1]], b]
}
fn curve_bounds(points: [[f32; 2]; 4]) -> Rect {
    let min_x = points.iter().map(|p| p[0]).fold(f32::INFINITY, f32::min) - 14.0;
    let max_x = points
        .iter()
        .map(|p| p[0])
        .fold(f32::NEG_INFINITY, f32::max)
        + 14.0;
    let min_y = points[0][1].min(points[3][1]) - 14.0;
    let max_y = points[0][1].max(points[3][1]) + 14.0;
    Rect {
        x: min_x,
        y: min_y,
        width: max_x - min_x,
        height: max_y - min_y,
    }
}
const ARROW_LENGTH: f32 = 18.;
const ARROW_WIDTH: f32 = 18.;
const PORT_CLEARANCE: f32 = 7.;
fn curve_point(points: [[f32; 2]; 4], t: f32) -> [f32; 2] {
    let u = 1. - t;
    [0, 1].map(|axis| {
        u * u * u * points[0][axis]
            + 3. * u * u * t * points[1][axis]
            + 3. * u * t * t * points[2][axis]
            + t * t * t * points[3][axis]
    })
}
fn endpoint_parameter(points: [[f32; 2]; 4], reverse: bool, distance: f32) -> f32 {
    let endpoint = if reverse { points[0] } else { points[3] };
    let mut low = 0.;
    let mut high = 0.5;
    for _ in 0..16 {
        let mid = (low + high) * 0.5;
        let point = curve_point(points, if reverse { mid } else { 1. - mid });
        if (point[0] - endpoint[0]).hypot(point[1] - endpoint[1]) < distance {
            low = mid;
        } else {
            high = mid;
        }
    }
    if reverse { high } else { 1. - high }
}
fn push_curve(
    scene: &mut Scene,
    points: [[f32; 2]; 4],
    zoom: f32,
    color: Option<[f32; 4]>,
    arrows: [bool; 2],
) {
    // Stop the shaft at the broad base: it must never blunt the arrow tip.
    let start = if arrows[0] {
        endpoint_parameter(points, true, PORT_CLEARANCE + ARROW_LENGTH)
    } else {
        0.
    };
    let end = if arrows[1] {
        endpoint_parameter(points, false, PORT_CLEARANCE + ARROW_LENGTH)
    } else {
        1.
    };
    let segments = if zoom < PORT_LOD_ZOOM {
        8
    } else {
        (24. * zoom.sqrt()).clamp(24., 96.) as usize
    };
    let mut previous = curve_point(points, start);
    for i in 1..=segments {
        let next = curve_point(points, start + (end - start) * i as f32 / segments as f32);
        let mut quad = Quad::line(previous, next);
        if let Some(color) = color {
            quad.color = color;
        }
        scene.quads.push(quad);
        previous = next;
    }
}
fn push_arrow(
    scene: &mut Scene,
    points: [[f32; 2]; 4],
    _zoom: f32,
    color: Option<[f32; 4]>,
    reverse: bool,
) {
    // Follow the actual curve near the socket, including short, steep connections.
    let tip = curve_point(points, endpoint_parameter(points, reverse, PORT_CLEARANCE));
    let base = curve_point(
        points,
        endpoint_parameter(points, reverse, PORT_CLEARANCE + ARROW_LENGTH),
    );
    let tangent = [tip[0] - base[0], tip[1] - base[1]];
    let length = tangent[0].hypot(tangent[1]);
    if length < 0.001 {
        return;
    }
    let center = [0, 1].map(|axis| (tip[axis] + base[axis]) * 0.5);
    scene.quads.push(Quad {
        rect: [center[0], center[1], length, ARROW_WIDTH],
        color: color.unwrap_or([0.32, 0.65, 0.74, 1.]),
        params: [tangent[1].atan2(tangent[0]), 0., -1., 0.],
    });
}
impl SceneIndex {
    pub fn new(doc: &Document) -> Self {
        let nodes: BTreeMap<_, _> = doc
            .graph()
            .nodes()
            .values()
            .map(|node| {
                (
                    node.id,
                    RenderNode {
                        rect: doc.placement().get(&node.id).copied().unwrap_or_default(),
                        inputs: node.inputs.len(),
                        outputs: node.outputs.len(),
                        type_id: node.type_id.clone(),
                        title: node
                            .properties
                            .get("title")
                            .and_then(|v| v.as_str())
                            .map(|s| s.chars().take(200).collect()),
                        input_names: node.inputs.iter().map(|p| p.name.clone()).collect(),
                        output_names: node.outputs.iter().map(|p| p.name.clone()).collect(),
                        role: node
                            .properties
                            .get("role")
                            .and_then(|v| v.as_str())
                            .unwrap_or("")
                            .chars()
                            .take(200)
                            .collect(),
                        relation: node
                            .properties
                            .get("kind")
                            .and_then(|v| v.as_str())
                            .unwrap_or("trust")
                            .into(),
                        accent: if node.type_id == "story.relationship" {
                            relation_color(
                                node.properties
                                    .get("kind")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("trust"),
                            )
                        } else if node.type_id == "story.character" {
                            character_accent(node.id)
                        } else {
                            relation_color("friend")
                        },
                        portrait: if node.type_id == "story.character" {
                            node.properties
                                .get("portrait")
                                .and_then(|v| v.as_str())
                                .and_then(crate::decode_portrait)
                        } else {
                            None
                        },
                        mutual: node
                            .properties
                            .get("mutual")
                            .and_then(|value| value.as_bool())
                            .unwrap_or(false),
                    },
                )
            })
            .collect();
        let mut edges = BTreeMap::new();
        let mut bounds = Vec::new();
        let mut incident: BTreeMap<Id, BTreeSet<Id>> = BTreeMap::new();
        for edge in doc.graph().edges().values() {
            let Some(from) = nodes.get(&edge.from.node) else {
                continue;
            };
            let Some(to) = nodes.get(&edge.to.node) else {
                continue;
            };
            let Some(i) = doc.graph().nodes()[&edge.from.node]
                .outputs
                .iter()
                .position(|p| p.name == edge.from.port)
            else {
                continue;
            };
            let Some(j) = doc.graph().nodes()[&edge.to.node]
                .inputs
                .iter()
                .position(|p| p.name == edge.to.port)
            else {
                continue;
            };
            let a = port_anchor(from.rect, i, from.outputs, true);
            let b = port_anchor(to.rect, j, to.inputs, false);
            let points = curve(a, b);
            bounds.push((edge.id, curve_bounds(points)));
            edges.insert(
                edge.id,
                RenderEdge {
                    points,
                    from: (edge.from.node, i),
                    to: (edge.to.node, j),
                    color: (to.type_id == "story.relationship" || to.type_id == "story.scene")
                        .then_some(to.accent),
                    arrow_start: to.type_id == "story.relationship"
                        && (to.mutual || edge.to.port == "to"),
                    arrow_end: to.type_id != "story.relationship"
                        || to.mutual
                        || edge.to.port != "to",
                },
            );
            for id in [edge.from.node, edge.to.node] {
                incident.entry(id).or_default().insert(edge.id);
            }
        }

        Self {
            story: nodes
                .values()
                .any(|node| node.type_id.starts_with("story.")),
            nodes,
            edges,
            incident,
            node_index: SpatialIndex::new(doc),
            edge_index: SpatialIndex::from_rects(bounds),
        }
    }
    pub fn scene(&self, viewport: Viewport, selection: &BTreeSet<Id>) -> unge_core::Result<Scene> {
        self.scene_with_preview(viewport, selection, &Preview::default())
    }
    pub fn spatial_index(&self) -> &SpatialIndex {
        &self.node_index
    }
    /// Reuse committed BVHs; only moved nodes and incident edges bypass old bounds.
    pub fn scene_with_preview(
        &self,
        viewport: Viewport,
        selection: &BTreeSet<Id>,
        preview: &Preview,
    ) -> unge_core::Result<Scene> {
        self.scene_with_labels(
            viewport,
            selection,
            preview,
            &LabelCatalog::new(),
            Locale::En,
        )
    }
    pub fn scene_with_labels(
        &self,
        viewport: Viewport,
        selection: &BTreeSet<Id>,
        preview: &Preview,
        catalog: &LabelCatalog,
        locale: Locale,
    ) -> unge_core::Result<Scene> {
        self.scene_with_edge_selection(viewport, selection, preview, catalog, locale, None)
    }
    pub fn scene_with_edge_selection(
        &self,
        viewport: Viewport,
        selection: &BTreeSet<Id>,
        preview: &Preview,
        catalog: &LabelCatalog,
        locale: Locale,
        selected_edge: Option<Id>,
    ) -> unge_core::Result<Scene> {
        viewport.validate()?;
        if preview.placement.len() > MAX_SELECTION
            || preview
                .placement
                .iter()
                .any(|(id, rect)| !self.nodes.contains_key(id) || !rect.valid())
            || preview.marquee.is_some_and(|rect| !rect.valid())
            || preview.cable.as_ref().is_some_and(|c| {
                c.from
                    .iter()
                    .chain(c.to.iter())
                    .any(|v| !v.is_finite() || v.abs() > 1.0e9)
            })
        {
            return Err(unge_core::Error::Invalid(
                "invalid interaction preview".into(),
            ));
        }
        let area = viewport.world_rect();
        let mut scene = Scene::default();
        let mut grid = Quad::rectangle(
            area,
            if self.story {
                CANVAS
            } else {
                [0.04, 0.052, 0.075, 1.0]
            },
            0.0,
        );
        grid.params[2] = 1.0;
        scene.quads.push(grid);
        let mut edges: BTreeSet<_> = self.edge_index.query(area).into_iter().collect();
        for id in preview.placement.keys() {
            edges.extend(self.incident.get(id).into_iter().flatten());
        }
        for id in edges {
            let edge = &self.edges[&id];
            let points = if preview.placement.contains_key(&edge.from.0)
                || preview.placement.contains_key(&edge.to.0)
            {
                let from = &self.nodes[&edge.from.0];
                let to = &self.nodes[&edge.to.0];
                curve(
                    port_anchor(
                        preview
                            .placement
                            .get(&edge.from.0)
                            .copied()
                            .unwrap_or(from.rect),
                        edge.from.1,
                        from.outputs,
                        true,
                    ),
                    port_anchor(
                        preview
                            .placement
                            .get(&edge.to.0)
                            .copied()
                            .unwrap_or(to.rect),
                        edge.to.1,
                        to.inputs,
                        false,
                    ),
                )
            } else {
                edge.points
            };
            if !curve_bounds(points).intersects(area) {
                continue;
            }
            if selected_edge == Some(id) {
                let start = scene.quads.len();
                push_curve(
                    &mut scene,
                    points,
                    viewport.zoom,
                    Some([TEAL[0], TEAL[1], TEAL[2], 0.28]),
                    [edge.arrow_start, edge.arrow_end],
                );
                for quad in &mut scene.quads[start..] {
                    quad.rect[3] = 10.;
                    quad.params[1] = 5.;
                }
            }
            push_curve(
                &mut scene,
                points,
                viewport.zoom,
                edge.color,
                [edge.arrow_start, edge.arrow_end],
            );
            if edge.arrow_start {
                push_arrow(&mut scene, points, viewport.zoom, edge.color, true);
            }
            if edge.arrow_end {
                push_arrow(&mut scene, points, viewport.zoom, edge.color, false);
            }
            scene.visible_edges += 1;
        }
        // Include ports/selection borders protruding from the node bounds.
        let padded = Rect {
            x: area.x - 8.0,
            y: area.y - 8.0,
            width: area.width + 16.0,
            height: area.height + 16.0,
        };
        let mut nodes: BTreeSet<_> = self.node_index.query(padded).into_iter().collect();
        nodes.extend(preview.placement.keys());
        for id in nodes {
            let node = &self.nodes[&id];
            let rect = preview.placement.get(&id).copied().unwrap_or(node.rect);
            if !rect.intersects(padded) {
                continue;
            }
            let selected = selection.contains(&id);
            if self.story && rect.width >= 80. && rect.height >= 60. {
                Self::story_card(
                    &mut scene,
                    node,
                    rect,
                    selected,
                    viewport.zoom,
                    catalog,
                    locale,
                );
                scene.visible_nodes += 1;
                continue;
            }
            let border = if selected {
                [0.2, 0.8, 0.72, 1.0]
            } else {
                [0.24, 0.29, 0.37, 1.0]
            };
            scene.quads.push(Quad::rectangle(rect, border, 8.0));
            scene.quads.push(Quad::rectangle(
                Rect {
                    x: rect.x + 1.5,
                    y: rect.y + 1.5,
                    width: (rect.width - 3.0).max(0.1),
                    height: (rect.height - 3.0).max(0.1),
                },
                [0.09, 0.115, 0.16, 1.0],
                7.0,
            ));
            if viewport.zoom >= PORT_LOD_ZOOM {
                for (count, output) in [(node.inputs, false), (node.outputs, true)] {
                    for i in 0..count {
                        let p = port_anchor(rect, i, count, output);
                        scene.quads.push(Quad::rectangle(
                            Rect {
                                x: p[0] - 4.0,
                                y: p[1] - 4.0,
                                width: 8.0,
                                height: 8.0,
                            },
                            [0.35, 0.78, 0.72, 1.0],
                            4.0,
                        ));
                    }
                }
            }
            if viewport.zoom >= 0.6 && rect.width >= 48.0 && rect.height >= 40.0 {
                let labels = catalog.get(&node.type_id);
                let after_quad = scene.quads.len();
                scene.labels.push(TextLabel {
                    text: label_text(
                        if node.title.is_some() {
                            None
                        } else {
                            labels.map(|v| &v.title)
                        },
                        node.title.as_deref().unwrap_or(&node.type_id),
                        locale,
                    ),
                    rect: Rect {
                        x: rect.x + 12.0,
                        y: rect.y + 4.0,
                        width: rect.width - 24.0,
                        height: 18.0,
                    },
                    font_size: 14.0,
                    right_aligned: false,
                    color: [0.86, 0.9, 0.96, 1.0],
                    after_quad,
                });
                if viewport.zoom >= 0.75 {
                    for (names, output) in [(&node.input_names, false), (&node.output_names, true)]
                    {
                        // Dense port rows would overlap; retain circles and omit labels.
                        if rect.height / ((names.len() + 1) as f32) < 16.0 {
                            continue;
                        }
                        for (i, name) in names.iter().enumerate() {
                            let y = port_anchor(rect, i, names.len(), output)[1] - 7.0;
                            if y < rect.y + 23.0 || y + 14.0 > rect.y + rect.height - 5.0 {
                                continue;
                            }
                            let localized = labels.and_then(|v| {
                                if output {
                                    v.outputs.get(name)
                                } else {
                                    v.inputs.get(name)
                                }
                            });
                            scene.labels.push(TextLabel {
                                text: label_text(localized, name, locale),
                                rect: Rect {
                                    x: rect.x + if output { rect.width / 2.0 + 4.0 } else { 12.0 },
                                    y,
                                    width: rect.width / 2.0 - 16.0,
                                    height: 14.0,
                                },
                                font_size: 11.0,
                                right_aligned: output,
                                color: [0.65, 0.73, 0.82, 1.0],
                                after_quad,
                            });
                        }
                    }
                }
            }
            scene.visible_nodes += 1;
        }
        if let Some(cable) = &preview.cable {
            push_curve(
                &mut scene,
                curve(cable.from, cable.to),
                viewport.zoom,
                Some(if cable.valid {
                    [0.2, 0.9, 0.65, 1.0]
                } else {
                    [0.9, 0.5, 0.25, 1.0]
                }),
                [false, false],
            );
        }
        if let Some(rect) = preview.marquee {
            scene
                .quads
                .push(Quad::rectangle(rect, [0.2, 0.8, 0.72, 0.15], 0.0));
            let width = (1.0 / viewport.zoom).min(rect.width.min(rect.height));
            for border in [
                Rect {
                    height: width,
                    ..rect
                },
                Rect {
                    y: rect.y + rect.height - width,
                    height: width,
                    ..rect
                },
                Rect { width, ..rect },
                Rect {
                    x: rect.x + rect.width - width,
                    width,
                    ..rect
                },
            ] {
                scene
                    .quads
                    .push(Quad::rectangle(border, [0.2, 0.8, 0.72, 1.0], 0.0));
            }
        }
        Ok(scene)
    }
    fn story_card(
        scene: &mut Scene,
        node: &RenderNode,
        rect: Rect,
        selected: bool,
        zoom: f32,
        catalog: &LabelCatalog,
        locale: Locale,
    ) {
        let character = node.type_id == "story.character";
        let relation = node.type_id == "story.relationship";
        let accent = node.accent;
        // Shadows and selection live outside the unchanged interaction bounds.
        {
            let (spread, offset, alpha) = (1., 2., 0.045);
            scene.quads.push(Quad::rectangle(
                Rect {
                    x: rect.x - spread,
                    y: rect.y - spread + offset,
                    width: rect.width + spread * 2.,
                    height: rect.height + spread * 2.,
                },
                [INK[0], INK[1], INK[2], alpha],
                8. + spread,
            ));
        }
        if selected {
            scene.quads.push(Quad::rectangle(
                Rect {
                    x: rect.x - 4.,
                    y: rect.y - 4.,
                    width: rect.width + 8.,
                    height: rect.height + 8.,
                },
                [accent[0], accent[1], accent[2], 0.24],
                12.,
            ));
        }
        scene.quads.push(Quad::rectangle(
            rect,
            if selected { accent } else { RULE },
            8.,
        ));
        scene.quads.push(Quad::rectangle(
            Rect {
                x: rect.x + 1.5,
                y: rect.y + 1.5,
                width: rect.width - 3.,
                height: rect.height - 3.,
            },
            if character || relation {
                card_color(accent)
            } else {
                SCENE_SURFACE
            },
            6.5,
        ));
        let mut text_x = rect.x + 16.;
        if character {
            let side = (rect.height - 32.)
                .min(72.)
                .min((rect.width - 44.) * 0.45)
                .max(20.);
            let photo_rect = Rect {
                x: rect.x + 14.,
                y: rect.y + (rect.height - side) * 0.5,
                width: side,
                height: side,
            };
            let mut photo = Quad::rectangle(photo_rect, accent, 5.);
            if let Some(portrait) = &node.portrait
                && scene.portraits.len() < crate::PORTRAIT_SLOTS
            {
                scene.portraits.push(portrait.clone());
                photo.params[3] = scene.portraits.len() as f32;
            }
            scene.quads.push(photo);
            if photo.params[3] == 0. && zoom >= 0.4 {
                scene.labels.push(TextLabel {
                    text: node
                        .title
                        .as_deref()
                        .unwrap_or("?")
                        .chars()
                        .take(1)
                        .collect(),
                    rect: Rect {
                        x: photo_rect.x + side * 0.28,
                        y: photo_rect.y + side * 0.20,
                        width: side * 0.65,
                        height: side * 0.7,
                    },
                    font_size: side * 0.44,
                    right_aligned: false,
                    color: PAPER,
                    after_quad: scene.quads.len(),
                });
            }
            text_x = photo_rect.x + side + 12.;
        } else {
            // A compact category marker replaces the old full-width accent stripe.
            scene.quads.push(Quad::rectangle(
                Rect {
                    x: rect.x + 16.,
                    y: rect.y + 19.,
                    width: 6.,
                    height: 6.,
                },
                accent,
                3.,
            ));
        }
        if zoom >= PORT_LOD_ZOOM {
            for (count, output) in [(node.inputs, false), (node.outputs, true)] {
                for i in 0..count {
                    let p = port_anchor(rect, i, count, output);
                    scene.quads.push(Quad::rectangle(
                        Rect {
                            x: p[0] - 6.,
                            y: p[1] - 6.,
                            width: 12.,
                            height: 12.,
                        },
                        PAPER,
                        6.,
                    ));
                    scene.quads.push(Quad::rectangle(
                        Rect {
                            x: p[0] - 4.,
                            y: p[1] - 4.,
                            width: 8.,
                            height: 8.,
                        },
                        accent,
                        4.,
                    ));
                }
            }
        }
        if zoom < 0.4 {
            return;
        }
        let title = label_text(
            catalog
                .get(&node.type_id)
                .filter(|_| node.title.is_none())
                .map(|labels| &labels.title),
            node.title.as_deref().unwrap_or(&node.type_id),
            locale,
        );
        let after_quad = scene.quads.len();
        scene.labels.push(TextLabel {
            text: title,
            rect: Rect {
                x: text_x,
                y: rect.y
                    + if character {
                        (rect.height * 0.25).min(27.)
                    } else {
                        (rect.height - 28.).min(42.)
                    },
                width: (rect.x + rect.width - text_x - 14.).max(1.),
                height: 24.,
            },
            font_size: if character { 18. } else { 16. },
            right_aligned: false,
            color: INK,
            after_quad,
        });
        let subtitle = if character {
            label_text(None, &node.role, locale)
        } else if relation {
            relation_name(&node.relation, locale).to_owned()
        } else {
            label_text(
                catalog.get(&node.type_id).map(|labels| &labels.title),
                &node.type_id,
                locale,
            )
        };
        if !subtitle.is_empty() {
            scene.labels.push(TextLabel {
                text: subtitle,
                rect: Rect {
                    x: if character { text_x } else { rect.x + 30. },
                    y: rect.y
                        + if character {
                            (rect.height - 20.).min(58.)
                        } else {
                            14.
                        },
                    width: (rect.x + rect.width
                        - if character { text_x } else { rect.x + 30. }
                        - 14.)
                        .max(1.),
                    height: (rect.height - 16.).clamp(1., 20.),
                },
                font_size: 12.,
                right_aligned: false,
                color: if relation {
                    [accent[0] * 0.55, accent[1] * 0.55, accent[2] * 0.55, 1.]
                } else {
                    MUTED
                },
                after_quad,
            });
        }
    }
}
