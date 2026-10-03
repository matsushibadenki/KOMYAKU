//! Rust-owned instanced renderer. The host supplies a texture or native surface.
mod gpu;
mod labels;
mod text;
pub use cosmic_text;
pub use labels::*;
pub use text::TextStats;
mod scene;
mod surface;
pub use gpu::*;
pub use scene::*;
pub use surface::*;
pub use wgpu;
