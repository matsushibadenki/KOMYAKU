use crate::{GpuRenderer, Scene};
use unge_core::Viewport;

/// Native surface owned by the Rust application, independent of any WebView.
pub struct SurfaceRenderer {
    surface: wgpu::Surface<'static>,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    config: wgpu::SurfaceConfiguration,
    renderer: GpuRenderer,
    suspended: bool,
    left_ui_width: f32,
}
impl SurfaceRenderer {
    pub async fn new(
        target: impl Into<wgpu::SurfaceTarget<'static>>,
        size: [u32; 2],
    ) -> Result<Self, String> {
        let instance = wgpu::Instance::default();
        let surface = instance.create_surface(target).map_err(|e| e.to_string())?;
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                compatible_surface: Some(&surface),
                power_preference: wgpu::PowerPreference::HighPerformance,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| e.to_string())?;
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default())
            .await
            .map_err(|e| e.to_string())?;
        if size
            .iter()
            .any(|v| *v > device.limits().max_texture_dimension_2d)
        {
            return Err("surface size exceeds GPU limits".into());
        }
        let config = surface
            .get_default_config(&adapter, size[0].max(1), size[1].max(1))
            .ok_or("surface has no supported configuration")?;
        surface.configure(&device, &config);
        let renderer = GpuRenderer::new(&device, config.format);
        Ok(Self {
            surface,
            device,
            queue,
            config,
            renderer,
            suspended: size.contains(&0),
            left_ui_width: 0.,
        })
    }
    /// Reserve a logical-width strip for a host-owned icon menu.
    pub fn set_left_ui_width(&mut self, width: f32) {
        self.left_ui_width = if width.is_finite() { width.max(0.) } else { 0. };
    }
    pub fn text_stats(&self) -> crate::TextStats {
        self.renderer.text_stats()
    }
    /// Replaces font selection and invalidates layout/atlas caches.
    pub fn set_font_system(&mut self, fonts: cosmic_text::FontSystem) {
        self.renderer.set_font_system(fonts);
    }
    pub fn resize(&mut self, size: [u32; 2]) -> Result<(), String> {
        self.suspended = size.contains(&0);
        if self.suspended {
            return Ok(());
        }
        if size
            .iter()
            .any(|v| *v > self.device.limits().max_texture_dimension_2d)
        {
            return Err("surface size exceeds GPU limits".into());
        }
        if self.config.width != size[0] || self.config.height != size[1] {
            self.config.width = size[0];
            self.config.height = size[1];
            self.surface.configure(&self.device, &self.config);
        }
        Ok(())
    }
    /// Physical pixels are supplied by the host. Skip minimized and timeout frames.
    pub fn draw(&mut self, scene: &Scene, viewport: Viewport) -> Result<bool, String> {
        if self.suspended {
            return Ok(false);
        }
        let frame = match self.surface.get_current_texture() {
            Ok(frame) => frame,
            Err(wgpu::SurfaceError::Lost | wgpu::SurfaceError::Outdated) => {
                self.surface.configure(&self.device, &self.config);
                return Ok(false);
            }
            Err(wgpu::SurfaceError::Timeout) => return Ok(false),
            Err(error) => return Err(error.to_string()),
        };
        self.renderer
            .prepare_sized(
                &self.device,
                &self.queue,
                scene,
                viewport,
                [self.config.width, self.config.height],
            )
            .map_err(|e| e.to_string())?;
        let view = frame.texture.create_view(&Default::default());
        let mut encoder = self.device.create_command_encoder(&Default::default());
        let left =
            (self.left_ui_width * self.config.width as f32 / viewport.size[0]).round() as u32;
        let left = left.min(self.config.width.saturating_sub(1));
        self.renderer.render_clipped(
            &mut encoder,
            &view,
            Some([left, 0, self.config.width - left, self.config.height]),
        );
        self.queue.submit([encoder.finish()]);
        frame.present();
        Ok(true)
    }
}
