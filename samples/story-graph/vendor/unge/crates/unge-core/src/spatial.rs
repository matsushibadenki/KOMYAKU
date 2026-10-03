use crate::{Document, Id, Rect};

/// Balanced BVH. Rebuild on committed geometry changes, query during pan/zoom.
#[derive(Debug)]
enum Branch {
    Leaf {
        bounds: Rect,
        id: Id,
    },
    Split {
        bounds: Rect,
        left: Box<Branch>,
        right: Box<Branch>,
    },
}
impl Branch {
    fn bounds(&self) -> Rect {
        match self {
            Self::Leaf { bounds, .. } | Self::Split { bounds, .. } => *bounds,
        }
    }
    fn build(items: &mut [(Id, Rect)], depth: usize) -> Self {
        if items.len() == 1 {
            return Self::Leaf {
                id: items[0].0,
                bounds: items[0].1,
            };
        }
        items.sort_by(|a, b| {
            if depth.is_multiple_of(2) {
                a.1.x.total_cmp(&b.1.x)
            } else {
                a.1.y.total_cmp(&b.1.y)
            }
        });
        let (a, b) = items.split_at_mut(items.len() / 2);
        let left = Box::new(Self::build(a, depth + 1));
        let right = Box::new(Self::build(b, depth + 1));
        let (a, b) = (left.bounds(), right.bounds());
        let x = a.x.min(b.x);
        let y = a.y.min(b.y);
        let bounds = Rect {
            x,
            y,
            width: (a.x + a.width).max(b.x + b.width) - x,
            height: (a.y + a.height).max(b.y + b.height) - y,
        };
        Self::Split {
            bounds,
            left,
            right,
        }
    }
    fn query(&self, area: Rect, output: &mut Vec<Id>) {
        if !self.bounds().intersects(area) {
            return;
        }
        match self {
            Self::Leaf { id, .. } => output.push(*id),
            Self::Split { left, right, .. } => {
                left.query(area, output);
                right.query(area, output);
            }
        }
    }
}
#[derive(Debug, Default)]
pub struct SpatialIndex {
    root: Option<Branch>,
}
impl SpatialIndex {
    pub fn new(doc: &Document) -> Self {
        let items = doc
            .graph()
            .nodes()
            .keys()
            .map(|id| (*id, doc.placement().get(id).copied().unwrap_or_default()))
            .collect();
        Self::from_rects(items)
    }
    pub fn from_rects(mut items: Vec<(Id, Rect)>) -> Self {
        items.retain(|(_, rect)| rect.valid());
        Self {
            root: (!items.is_empty()).then(|| Branch::build(&mut items, 0)),
        }
    }
    pub fn query(&self, area: Rect) -> Vec<Id> {
        let mut result = Vec::new();
        if area.valid()
            && let Some(root) = &self.root
        {
            root.query(area, &mut result);
        }
        result.sort();
        result
    }
    pub fn hit_test(&self, point: [f32; 2]) -> Option<Id> {
        self.query(Rect {
            x: point[0],
            y: point[1],
            width: 0.001,
            height: 0.001,
        })
        .last()
        .copied()
    }
}

#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize)]
pub struct Viewport {
    pub origin: [f32; 2],
    pub zoom: f32,
    pub size: [f32; 2],
}
impl Viewport {
    pub fn validate(self) -> crate::Result<()> {
        if self
            .origin
            .iter()
            .chain(self.size.iter())
            .any(|v| !v.is_finite())
            || !self.zoom.is_finite()
            || !(0.02..=16.0).contains(&self.zoom)
            || self.size.iter().any(|v| *v <= 0.0)
            || !self.world_rect().valid()
        {
            return Err(crate::Error::Invalid("invalid viewport".into()));
        }
        Ok(())
    }
    pub fn world_rect(self) -> Rect {
        Rect {
            x: self.origin[0],
            y: self.origin[1],
            width: self.size[0] / self.zoom,
            height: self.size[1] / self.zoom,
        }
    }
    pub fn to_world(self, screen: [f32; 2]) -> [f32; 2] {
        [
            screen[0] / self.zoom + self.origin[0],
            screen[1] / self.zoom + self.origin[1],
        ]
    }
    pub fn pan(&mut self, delta: [f32; 2]) {
        self.origin[0] -= delta[0] / self.zoom;
        self.origin[1] -= delta[1] / self.zoom;
    }
    pub fn zoom_at(&mut self, screen: [f32; 2], factor: f32) {
        if !factor.is_finite() || factor <= 0.0 {
            return;
        }
        let before = self.to_world(screen);
        self.zoom = (self.zoom * factor).clamp(0.02, 16.0);
        self.origin = [
            before[0] - screen[0] / self.zoom,
            before[1] - screen[1] / self.zoom,
        ];
    }
}

/// Shared world-space port geometry for rendering and hit testing.
pub fn port_anchor(rect: Rect, index: usize, count: usize, output: bool) -> [f32; 2] {
    [
        rect.x + if output { rect.width } else { 0.0 },
        rect.y + rect.height * ((index as f32 + 1.0) / (count as f32 + 1.0)),
    ]
}
