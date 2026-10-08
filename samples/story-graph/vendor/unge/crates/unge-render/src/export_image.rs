//! One-shot offscreen GPU export. Pixel readback remains in Rust for file encoding.
use crate::{GpuRenderer, Scene};
use unge_core::Viewport;
pub async fn render_png(
    scene: &Scene,
    viewport: Viewport,
    size: [u32; 2],
) -> Result<Vec<u8>, String> {
    if size.iter().any(|v| *v == 0 || *v > 4096) {
        return Err("graph_export_invalid".into());
    }
    let instance = wgpu::Instance::default();
    let adapter = instance
        .request_adapter(&Default::default())
        .await
        .map_err(|_| "graph_gpu_unavailable")?;
    let (device, queue) = adapter
        .request_device(&Default::default())
        .await
        .map_err(|_| "graph_gpu_unavailable")?;
    let extent = wgpu::Extent3d {
        width: size[0],
        height: size[1],
        depth_or_array_layers: 1,
    };
    let texture = device.create_texture(&wgpu::TextureDescriptor {
        label: Some("Graph export"),
        size: extent,
        mip_level_count: 1,
        sample_count: 1,
        dimension: wgpu::TextureDimension::D2,
        format: wgpu::TextureFormat::Rgba8UnormSrgb,
        usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
        view_formats: &[],
    });
    let mut renderer = GpuRenderer::new(&device, wgpu::TextureFormat::Rgba8UnormSrgb);
    renderer
        .prepare_sized(&device, &queue, scene, viewport, size)
        .map_err(|_| "graph_export_failed")?;
    let mut encoder = device.create_command_encoder(&Default::default());
    renderer.render(&mut encoder, &texture.create_view(&Default::default()));
    let row = (size[0] * 4).div_ceil(256) * 256;
    let buffer = device.create_buffer(&wgpu::BufferDescriptor {
        label: Some("Graph export readback"),
        size: u64::from(row) * u64::from(size[1]),
        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
        mapped_at_creation: false,
    });
    encoder.copy_texture_to_buffer(
        texture.as_image_copy(),
        wgpu::TexelCopyBufferInfo {
            buffer: &buffer,
            layout: wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(row),
                rows_per_image: Some(size[1]),
            },
        },
        extent,
    );
    queue.submit([encoder.finish()]);
    let (tx, rx) = std::sync::mpsc::channel();
    buffer
        .slice(..)
        .map_async(wgpu::MapMode::Read, move |result| {
            let _ = tx.send(result);
        });
    device
        .poll(wgpu::PollType::wait_indefinitely())
        .map_err(|_| "graph_export_failed")?;
    rx.recv_timeout(std::time::Duration::from_secs(30))
        .map_err(|_| "graph_export_failed")?
        .map_err(|_| "graph_export_failed")?;
    let mut pixels = Vec::with_capacity((size[0] * size[1] * 4) as usize);
    {
        let mapped = buffer.slice(..).get_mapped_range();
        for line in mapped.chunks(row as usize) {
            pixels.extend_from_slice(&line[..size[0] as usize * 4]);
        }
    }
    buffer.unmap();
    let mut png = std::io::Cursor::new(Vec::new());
    image::write_buffer_with_format(
        &mut png,
        &pixels,
        size[0],
        size[1],
        image::ExtendedColorType::Rgba8,
        image::ImageFormat::Png,
    )
    .map_err(|_| "graph_export_failed")?;
    Ok(png.into_inner())
}
