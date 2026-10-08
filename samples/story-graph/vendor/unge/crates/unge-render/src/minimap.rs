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
