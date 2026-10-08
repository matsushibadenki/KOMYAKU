//! Screen-fixed navigation geometry; all rendering data stays in Rust/GPU.
use unge_core::{Rect, Viewport};
#[derive(Clone, Copy)]
pub struct Minimap {
    pub frame: Rect,
    pub bounds: Rect,
    pub scale: f32,
    pub origin: [f32; 2],
}
pub fn minimap_bounds(rects: impl Iterator<Item = Rect>) -> Option<Rect> {
    rects.filter(|r| r.valid()).fold(None, |bounds, r| {
        Some(match bounds {
            None => r,
            Some(a) => {
                let x = a.x.min(r.x);
                let y = a.y.min(r.y);
                Rect {
                    x,
                    y,
                    width: (a.x + a.width).max(r.x + r.width) - x,
                    height: (a.y + a.height).max(r.y + r.height) - y,
                }
            }
        })
    })
}
impl Minimap {
    pub fn new(bounds: Rect, viewport: Viewport) -> Option<Self> {
        if viewport.size[0] < 320. || viewport.size[1] < 240. || !bounds.valid() {
            return None;
        }
        let frame = Rect {
            x: 68.,
            y: viewport.size[1] - 136.,
            width: 180.,
            height: 120.,
        };
        let scale = (160. / bounds.width).min(100. / bounds.height);
        let origin = [
            frame.x + (frame.width - bounds.width * scale) / 2.,
            frame.y + (frame.height - bounds.height * scale) / 2.,
        ];
        Some(Self {
            frame,
            bounds,
            scale,
            origin,
        })
    }
    pub fn project(self, r: Rect) -> Rect {
        Rect {
            x: self.origin[0] + (r.x - self.bounds.x) * self.scale,
            y: self.origin[1] + (r.y - self.bounds.y) * self.scale,
            width: (r.width * self.scale).max(2.),
            height: (r.height * self.scale).max(2.),
        }
    }
    pub fn navigate(self, point: [f32; 2]) -> Option<[f32; 2]> {
        let f = self.frame;
        if point[0] < f.x || point[0] > f.x + f.width || point[1] < f.y || point[1] > f.y + f.height
        {
            return None;
        }
        Some([
            self.bounds.x + (point[0] - self.origin[0]) / self.scale,
            self.bounds.y + (point[1] - self.origin[1]) / self.scale,
        ])
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn zoom_independent_mapping_and_small_window_suppression() {
        let bounds = Rect {
            x: -100.,
            y: 200.,
            width: 1000.,
            height: 500.,
        };
        for zoom in [0.02, 1., 16.] {
            let v = Viewport {
                origin: [20., 30.],
                zoom,
                size: [1100., 800.],
            };
            let map = Minimap::new(bounds, v).unwrap();
            let r = map.project(bounds);
            let point = map
                .navigate([r.x + r.width / 2., r.y + r.height / 2.])
                .unwrap();
            assert!((point[0] - 400.).abs() < 0.01);
            assert!((point[1] - 450.).abs() < 0.01);
            assert!(map.navigate([0., 0.]).is_none());
        }
        assert!(
            Minimap::new(
                bounds,
                Viewport {
                    origin: [0., 0.],
                    zoom: 1.,
                    size: [200., 100.]
                }
            )
            .is_none()
        );
    }
}

/// A 180×120 minimap cannot distinguish thousands of overlapping markers.
/// Cache a bounded density overview once per document revision; full graph
/// geometry and selected markers remain exact.
pub(crate) fn dense_overview(
    bounds: Rect,
    nodes: impl Iterator<Item = (Rect, [f32; 4])>,
) -> Vec<(Rect, [f32; 4])> {
    use std::collections::BTreeMap;
    let mut bins: BTreeMap<(u8, u8), BTreeMap<[u32; 4], usize>> = BTreeMap::new();
    for (rect, color) in nodes {
        let x = (((rect.x + rect.width / 2. - bounds.x) / bounds.width * 40.).floor() as i32)
            .clamp(0, 39) as u8;
        let y = (((rect.y + rect.height / 2. - bounds.y) / bounds.height * 25.).floor() as i32)
            .clamp(0, 24) as u8;
        *bins
            .entry((x, y))
            .or_default()
            .entry(color.map(f32::to_bits))
            .or_default() += 1;
    }
    bins.into_iter()
        .map(|((x, y), colors)| {
            let (color, _) = colors.into_iter().max_by_key(|(_, count)| *count).unwrap();
            (
                Rect {
                    x: bounds.x + (x as f32 + 0.5) * bounds.width / 40.,
                    y: bounds.y + (y as f32 + 0.5) * bounds.height / 25.,
                    width: bounds.width / 80.,
                    height: bounds.height / 50.,
                },
                color.map(f32::from_bits),
            )
        })
        .collect()
}
#[cfg(test)]
mod overview_tests {
    use super::*;
    #[test]
    fn dense_map_is_bounded_and_retains_dominant_semantic_color() {
        let bounds = Rect {
            x: 0.,
            y: 0.,
            width: 1000.,
            height: 1000.,
        };
        let colors = [[0.2, 0.4, 0.6, 1.], [0.8, 0.6, 0.4, 1.]];
        let points = dense_overview(
            bounds,
            (0..10000).map(|index| {
                (
                    Rect {
                        x: (index % 100) as f32 * 10.,
                        y: (index / 100) as f32 * 10.,
                        width: 1.,
                        height: 1.,
                    },
                    colors[usize::from(index % 5 == 0)],
                )
            }),
        );
        assert!(points.len() <= 1000);
        assert!(points.iter().all(|(rect, _)| rect.valid()));
        let same = dense_overview(
            bounds,
            (0..100).map(|index| {
                (
                    Rect {
                        x: 1.,
                        y: 1.,
                        width: 1.,
                        height: 1.,
                    },
                    colors[usize::from(index < 20)],
                )
            }),
        );
        assert_eq!(same.len(), 1);
        assert_eq!(same[0].1, colors[0]);
    }
}
