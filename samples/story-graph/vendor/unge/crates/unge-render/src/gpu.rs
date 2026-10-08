use crate::{Quad, Scene};
use unge_core::Viewport;
use wgpu::util::DeviceExt;

pub struct GpuRenderer {
    text: crate::text::TextRenderer,
    pipeline: wgpu::RenderPipeline,
    camera: wgpu::Buffer,
    bind_group: wgpu::BindGroup,
    instances: wgpu::Buffer,
    capacity: usize,
    count: u32,
    prepared: bool,
    portraits: wgpu::Texture,
    portrait_keys: [Option<u64>; crate::PORTRAIT_SLOTS],
    srgb_target: bool,
}
impl GpuRenderer {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        Self::with_font_system(device, format, cosmic_text::FontSystem::new())
    }
    /// Inject a host font database for portable, licensed bundled fonts.
    pub fn with_font_system(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        fonts: cosmic_text::FontSystem,
    ) -> Self {
        let text = crate::text::TextRenderer::new(device, format, fonts);
        let camera = device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some("UNGE camera"),
            contents: bytemuck::cast_slice(&[0.0f32; 8]),
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: None,
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: true },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        // 16 × 16 normalized portraits: bounded 16 MiB GPU atlas, uploaded only on change.
        let portraits = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("Story portrait atlas"),
            size: wgpu::Extent3d {
                width: 2048,
                height: 2048,
                depth_or_array_layers: 1,
            },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let portrait_view = portraits.create_view(&Default::default());
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            ..Default::default()
        });
        let bind_group = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: None,
            layout: &layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: camera.as_entire_binding(),
                },
                wgpu::BindGroupEntry {
                    binding: 1,
                    resource: wgpu::BindingResource::TextureView(&portrait_view),
                },
                wgpu::BindGroupEntry {
                    binding: 2,
                    resource: wgpu::BindingResource::Sampler(&sampler),
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: None,
            bind_group_layouts: &[&layout],
            push_constant_ranges: &[],
        });
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("UNGE graph"),
            source: wgpu::ShaderSource::Wgsl(include_str!("graph.wgsl").into()),
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("UNGE instanced graph"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout {
                    array_stride: std::mem::size_of::<Quad>() as u64,
                    step_mode: wgpu::VertexStepMode::Instance,
                    attributes: &wgpu::vertex_attr_array![0=>Float32x4,1=>Float32x4,2=>Float32x4],
                }],
            },
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format,
                    blend: Some(wgpu::BlendState::ALPHA_BLENDING),
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            primitive: Default::default(),
            depth_stencil: None,
            multisample: Default::default(),
            multiview: None,
            cache: None,
        });
        let capacity = 256;
        let instances = Self::buffer(device, capacity);
        Self {
            text,
            pipeline,
            camera,
            bind_group,
            instances,
            capacity,
            count: 0,
            prepared: false,
            portraits,
            portrait_keys: [None; crate::PORTRAIT_SLOTS],
            srgb_target: format.is_srgb(),
        }
    }
    pub fn text_stats(&self) -> crate::TextStats {
        self.text.stats
    }
    pub fn set_font_system(&mut self, fonts: cosmic_text::FontSystem) {
        self.prepared = false;
        self.text.set_fonts(fonts);
    }
    fn buffer(device: &wgpu::Device, capacity: usize) -> wgpu::Buffer {
        device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("UNGE instance buffer"),
            size: (capacity * std::mem::size_of::<Quad>()) as u64,
            usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }
    pub fn prepare(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        scene: &Scene,
        viewport: Viewport,
    ) -> unge_core::Result<()> {
        self.prepare_sized(
            device,
            queue,
            scene,
            viewport,
            viewport.size.map(|v| v.round().max(1.0) as u32),
        )
    }
    /// Physical target size enables crisp text on HiDPI surfaces.
    pub fn prepare_sized(
        &mut self,
        device: &wgpu::Device,
        queue: &wgpu::Queue,
        scene: &Scene,
        viewport: Viewport,
        size: [u32; 2],
    ) -> unge_core::Result<()> {
        self.prepared = false;
        self.count = 0;
        viewport.validate()?;
        if size.contains(&0)
            || size
                .iter()
                .any(|v| *v > device.limits().max_texture_dimension_2d)
        {
            return Err(unge_core::Error::Invalid("invalid text target size".into()));
        }
        self.text.prepare(queue, scene, viewport, size)?;
        if scene.portraits.len() > crate::PORTRAIT_SLOTS {
            return Err(unge_core::Error::Invalid(
                "portrait atlas limit exceeded".into(),
            ));
        }
        for (slot, portrait) in scene.portraits.iter().enumerate() {
            if portrait.rgba.len() != (crate::PORTRAIT_SIZE * crate::PORTRAIT_SIZE * 4) as usize {
                return Err(unge_core::Error::Invalid("invalid portrait pixels".into()));
            }
            if self.portrait_keys[slot] == Some(portrait.key) {
                continue;
            }
            queue.write_texture(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.portraits,
                    mip_level: 0,
                    origin: wgpu::Origin3d {
                        x: (slot as u32 % 16) * 128,
                        y: (slot as u32 / 16) * 128,
                        z: 0,
                    },
                    aspect: wgpu::TextureAspect::All,
                },
                &portrait.rgba,
                wgpu::TexelCopyBufferLayout {
                    offset: 0,
                    bytes_per_row: Some(128 * 4),
                    rows_per_image: Some(128),
                },
                wgpu::Extent3d {
                    width: 128,
                    height: 128,
                    depth_or_array_layers: 1,
                },
            );
            self.portrait_keys[slot] = Some(portrait.key);
        }
        let bytes = scene
            .quads
            .len()
            .checked_mul(std::mem::size_of::<Quad>())
            .ok_or_else(|| unge_core::Error::Invalid("scene too large".into()))?;
        if bytes as u64 > device.limits().max_buffer_size || scene.quads.len() > u32::MAX as usize {
            return Err(unge_core::Error::Invalid(
                "scene exceeds GPU buffer limit".into(),
            ));
        }
        if scene.quads.len() > self.capacity {
            self.capacity = scene
                .quads
                .len()
                .next_power_of_two()
                .min((device.limits().max_buffer_size as usize) / std::mem::size_of::<Quad>());
            self.instances = Self::buffer(device, self.capacity);
        }
        self.count = scene.quads.len() as u32;
        if self.count > 0 {
            queue.write_buffer(&self.instances, 0, bytemuck::cast_slice(&scene.quads));
        }
        queue.write_buffer(
            &self.camera,
            0,
            bytemuck::cast_slice(&[
                viewport.origin[0],
                viewport.origin[1],
                viewport.zoom,
                f32::from(self.srgb_target),
                viewport.size[0],
                viewport.size[1],
                0.0,
                0.0,
            ]),
        );
        self.prepared = true;
        Ok(())
    }
    /// Geometry and glyph batches share a pass and preserve node paint order.
    pub fn render(&self, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView) {
        self.render_clipped(encoder, target, None);
    }
    /// Restrict graph geometry and labels to the host's content area.
    pub fn render_clipped(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        clip: Option<[u32; 4]>,
    ) {
        self.render_pass(encoder, target, clip, None);
    }
    /// Measure the existing draw pass without copying frames through the UI.
    /// The caller must enable TIMESTAMP_QUERY and supply a two-slot query set.
    pub fn render_timed(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        queries: &wgpu::QuerySet,
    ) {
        self.render_pass(
            encoder,
            target,
            None,
            Some(wgpu::RenderPassTimestampWrites {
                query_set: queries,
                beginning_of_pass_write_index: Some(0),
                end_of_pass_write_index: Some(1),
            }),
        );
    }
    fn render_pass(
        &self,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        clip: Option<[u32; 4]>,
        timestamps: Option<wgpu::RenderPassTimestampWrites<'_>>,
    ) {
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("UNGE graph pass"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color {
                        r: 0.04,
                        g: 0.052,
                        b: 0.075,
                        a: 1.0,
                    }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: timestamps,
            occlusion_query_set: None,
        });
        if let Some([x, y, width, height]) = clip {
            pass.set_scissor_rect(x, y, width, height);
        }
        if !self.prepared {
            return;
        }
        let mut first = 0;
        for (after, range) in &self.text.batches {
            self.geometry(&mut pass, first..*after);
            self.text.render(&mut pass, range.clone());
            first = *after;
        }
        self.geometry(&mut pass, first..self.count);
    }
    fn geometry(&self, pass: &mut wgpu::RenderPass<'_>, range: std::ops::Range<u32>) {
        if range.is_empty() {
            return;
        }
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, &self.bind_group, &[]);
        pass.set_vertex_buffer(0, self.instances.slice(..));
        pass.draw(0..6, range);
    }
}
