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
                dx.hypot(dy).max(0.001),
                2.0,
            ],
            color: [0.32, 0.65, 0.74, 1.0],
            params: [dy.atan2(dx), 0.8, 0.0, 0.0],
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
}
struct RenderEdge {
    points: [[f32; 2]; 4],
    from: (Id, usize),
    to: (Id, usize),
}
/// Build once per document revision, not once per animation frame.
pub struct SceneIndex {
    nodes: BTreeMap<Id, RenderNode>,
    edges: BTreeMap<Id, RenderEdge>,
    node_index: SpatialIndex,
    edge_index: SpatialIndex,
    incident: BTreeMap<Id, BTreeSet<Id>>,
}
#[derive(Debug, Default)]
pub struct Scene {
    pub quads: Vec<Quad>,
    pub labels: Vec<TextLabel>,
    pub visible_nodes: usize,
    pub visible_edges: usize,
}
fn curve(a: [f32; 2], b: [f32; 2]) -> [[f32; 2]; 4] {
    let dx = ((b[0] - a[0]).abs() * 0.5).max(50.0);
    [a, [a[0] + dx, a[1]], [b[0] - dx, b[1]], b]
}
fn curve_bounds(points: [[f32; 2]; 4]) -> Rect {
    let min_x = points.iter().map(|p| p[0]).fold(f32::INFINITY, f32::min) - 2.0;
    let max_x = points
        .iter()
        .map(|p| p[0])
        .fold(f32::NEG_INFINITY, f32::max)
        + 2.0;
    let min_y = points[0][1].min(points[3][1]) - 2.0;
    let max_y = points[0][1].max(points[3][1]) + 2.0;
    Rect {
        x: min_x,
        y: min_y,
        width: max_x - min_x,
        height: max_y - min_y,
    }
}
fn push_curve(scene: &mut Scene, points: [[f32; 2]; 4], zoom: f32, color: Option<[f32; 4]>) {
    let segments = if zoom < PORT_LOD_ZOOM { 8 } else { 24 };
    let mut previous = points[0];
    for i in 1..=segments {
        let t = i as f32 / segments as f32;
        let u = 1.0 - t;
        let next = [0, 1].map(|axis| {
            u * u * u * points[0][axis]
                + 3.0 * u * u * t * points[1][axis]
                + 3.0 * u * t * t * points[2][axis]
                + t * t * t * points[3][axis]
        });
        let mut quad = Quad::line(previous, next);
        if let Some(color) = color {
            quad.color = color;
        }
        scene.quads.push(quad);
        previous = next;
    }
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
                },
            );
            for id in [edge.from.node, edge.to.node] {
                incident.entry(id).or_default().insert(edge.id);
            }
        }

        Self {
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
        let mut grid = Quad::rectangle(area, [0.04, 0.052, 0.075, 1.0], 0.0);
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
            push_curve(&mut scene, points, viewport.zoom, None);
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
}
