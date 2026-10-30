//! Capability-scoped pure math adapter. Never writes the Canonical document or SQLite.
use std::sync::atomic::{AtomicBool, Ordering};
use symbio_core::exchange::{self, MathInput, MathOrigin};
static BUSY: AtomicBool = AtomicBool::new(false);
struct Lease;
impl Drop for Lease { fn drop(&mut self) { BUSY.store(false, Ordering::Release); } }
fn lease() -> Result<Lease, String> {
    BUSY.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .map(|_| Lease).map_err(|_| "math_busy".into())
}
fn authorize(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" { Ok(()) } else { Err("math_forbidden".into()) }
}
#[tauri::command]
pub async fn compute_symbio_math(window: tauri::WebviewWindow, input: MathInput) -> Result<symbio_core::CellView, String> {
    authorize(&window)?;
    let guard = lease()?;
    tauri::async_runtime::spawn_blocking(move || { let _guard = guard; exchange::compute(&input).map_err(|e| e.code().to_string()) })
        .await.map_err(|_| "math_worker_failed".to_string())?
}
#[tauri::command]
pub async fn export_symbio_math(window: tauri::WebviewWindow, input: MathInput, origin: Option<MathOrigin>) -> Result<String, String> {
    authorize(&window)?;
    let guard = lease()?;
    tauri::async_runtime::spawn_blocking(move || { let _guard = guard; exchange::export(&input, origin).map_err(|e| e.code().to_string()) })
        .await.map_err(|_| "math_worker_failed".to_string())?
}
#[tauri::command]
pub async fn import_symbio_math(window: tauri::WebviewWindow, json: String) -> Result<exchange::ImportedMath, String> {
    authorize(&window)?;
    let guard = lease()?;
    tauri::async_runtime::spawn_blocking(move || { let _guard = guard; exchange::import(&json).map_err(|e| e.code().to_string()) })
        .await.map_err(|_| "math_worker_failed".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn concurrent_jobs_are_bounded_and_release_on_failure() {
        let guard = lease().unwrap();
        assert!(lease().is_err());
        drop(guard);
        assert!(lease().is_ok());
    }
}
