//! Native GPU surface clipped to the WebView's graph panel; no pixel IPC.
use super::*;
#[derive(Clone, Copy, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bounds {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl Bounds {
    fn validate(self) -> std::result::Result<Self, String> {
        if [self.x, self.y, self.width, self.height]
            .iter()
            .any(|v| !v.is_finite())
            || self.x < 0.
            || self.y < 0.
            || self.width < 1.
            || self.height < 1.
            || self.width > 16384.
            || self.height > 16384.
        {
            return Err("layout_invalid".into());
        }
        Ok(self)
    }
}
#[cfg(target_os = "macos")]
mod mac {
    use super::*;
    use objc2::rc::Retained;
    use objc2::{MainThreadOnly, define_class, msg_send};
    use objc2_app_kit::NSView;
    use objc2_foundation::{MainThreadMarker, NSPoint, NSRect, NSSize};
    use raw_window_handle::{
        AppKitDisplayHandle, AppKitWindowHandle, DisplayHandle, HandleError, HasDisplayHandle,
        HasWindowHandle, RawDisplayHandle, RawWindowHandle, WindowHandle,
    };
    use std::{cell::RefCell, ptr::NonNull};
    define_class!(
        // SAFETY: NSView requires AppKit access on the main thread, enforced here.
        #[unsafe(super=NSView)]
        #[thread_kind=MainThreadOnly]
        struct GraphView;
        impl GraphView {
            // SAFETY: Correct NSView method signature. Input goes to WebView beneath.
            #[unsafe(method(hitTest:))]
            fn hit_test(&self,_point:NSPoint)->Option<&NSView> {None}
        }
    );
    struct Target {
        pointer: usize,
        app: tauri::AppHandle,
    }
    // SAFETY: The pointer is retained until surface destruction. Only AppKit calls
    // access NSView on the main thread; these traits expose an opaque handle to wgpu.
    unsafe impl Send for Target {}
    unsafe impl Sync for Target {}
    impl HasWindowHandle for Target {
        fn window_handle(&self) -> std::result::Result<WindowHandle<'_>, HandleError> {
            let pointer = NonNull::new(self.pointer as *mut std::ffi::c_void)
                .ok_or(HandleError::Unavailable)?;
            // SAFETY: Target holds a strong reference for the borrow's lifetime.
            Ok(unsafe {
                WindowHandle::borrow_raw(RawWindowHandle::AppKit(AppKitWindowHandle::new(pointer)))
            })
        }
    }
    impl HasDisplayHandle for Target {
        fn display_handle(&self) -> std::result::Result<DisplayHandle<'_>, HandleError> {
            // SAFETY: AppKit has no borrowed display pointer.
            Ok(unsafe {
                DisplayHandle::borrow_raw(RawDisplayHandle::AppKit(AppKitDisplayHandle::new()))
            })
        }
    }
    impl Drop for Target {
        fn drop(&mut self) {
            let pointer = self.pointer;
            let _ = self.app.run_on_main_thread(move || {
                // SAFETY: This consumes the one strong reference transferred into Target.
                unsafe {
                    drop(Retained::<GraphView>::from_raw(pointer as *mut GraphView));
                }
            });
        }
    }
    struct Panel {
        view: Retained<GraphView>,
        size: [u32; 2],
        scale: f64,
        visible: bool,
    }
    static VISIBLE:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
    thread_local! {static PANEL:RefCell<Option<Panel>>=const{RefCell::new(None)};}
    pub fn resize(
        window: &tauri::WebviewWindow,
        engine: &Engine,
        bounds: Option<Bounds>,
    ) -> std::result::Result<(), String> {
        let mtm = MainThreadMarker::new().ok_or("gpu_thread")?;
        PANEL.with(|slot| {
            let mut slot = slot.borrow_mut();
            let Some(bounds) = bounds else {
                if let Some(panel) = slot.as_mut() {
                    panel.view.setHidden(true);
                    panel.visible = false;
                    VISIBLE.store(false,std::sync::atomic::Ordering::Release);
                }
                return Ok(());
            };
            let bounds = bounds.validate()?;
            let scale = window.scale_factor().map_err(|_| "gpu_error")?;
            let parent = window.ns_view().map_err(|_| "gpu_error")?;
            // SAFETY: Tauri owns this content NSView and the command runs on main thread.
            let parent = unsafe { &*(parent as *const NSView) };
            let origin = if parent.isFlipped() {
                bounds.y
            } else {
                parent.bounds().size.height - bounds.y - bounds.height
            };
            let frame = NSRect::new(
                NSPoint::new(bounds.x, origin),
                NSSize::new(bounds.width, bounds.height),
            );
            let size = [
                (bounds.width * scale).round() as u32,
                (bounds.height * scale).round() as u32,
            ];
            if slot.is_none() {
                // SAFETY: NSView initWithFrame has the declared signature.
                let view: Retained<GraphView> =
                    unsafe { msg_send![GraphView::alloc(mtm),initWithFrame:frame] };
                parent.addSubview(&view);
                let target = Arc::new(Target {
                    pointer: Retained::into_raw(view.clone()) as usize,
                    app: window.app_handle().clone(),
                });
                engine
                    .register_view(
                        "docked-graph",
                        engine.view_state("controls").map_err(|e| e.code)?.viewport,
                    )
                    .map_err(|e| e.code)?;
                let renderer = pollster::block_on(SurfaceRenderer::new(target, size))?;
                engine
                    .attach_renderer("docked-graph", renderer)
                    .map_err(|e| e.code)?;
                *slot = Some(Panel {
                    view,
                    size,
                    scale,
                    visible: true,
                });
            }
            let panel = slot.as_mut().unwrap();
            panel.view.setFrame(frame);
            panel.view.setHidden(false);
            panel.size = size;
            panel.scale = scale;
            panel.visible = true;
            VISIBLE.store(true,std::sync::atomic::Ordering::Release);
            engine
                .draw_surface("controls", "docked-graph", size, scale)
                .map_err(|e| e.code)?;
            Ok(())
        })
    }
    pub fn visible() -> bool {
        VISIBLE.load(std::sync::atomic::Ordering::Acquire)
    }
    pub fn draw(engine: &Engine) {
        PANEL.with(|slot| {
            if let Some(panel) = slot.borrow().as_ref().filter(|p| p.visible)
                && let Err(e) =
                    engine.draw_surface("controls", "docked-graph", panel.size, panel.scale)
            {
                eprintln!("docked GPU: {}", e.code);
            }
        });
    }
}
#[tauri::command]
pub async fn docked_graph_bounds(
    window: tauri::WebviewWindow,
    bounds: Option<Bounds>,
) -> std::result::Result<(), String> {
    if window.label() != "controls" {
        return Err("unknown_view".into());
    }
    if let Some(bounds) = bounds {
        bounds.validate()?;
    }
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = tokio::sync::oneshot::channel();
        let main = window.clone();
        window
            .run_on_main_thread(move || {
                let engine = main.state::<Engine>();
                let _ = sender.send(mac::resize(&main, &engine, bounds));
            })
            .map_err(|_| "gpu_thread")?;
        receiver.await.map_err(|_| "gpu_thread")?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bounds;
        Err("gpu_unavailable".into())
    }
}
pub fn redraw(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    if let Some(engine) = app.try_state::<Engine>() {
        mac::draw(&engine);
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounds_reject_nonfinite_and_unbounded_surfaces() {
        assert!(
            Bounds {
                x: 0.,
                y: 0.,
                width: 200.,
                height: 120.
            }
            .validate()
            .is_ok()
        );
        for width in [0., -1., f64::NAN, f64::INFINITY, 20000.] {
            assert!(
                Bounds {
                    x: 0.,
                    y: 0.,
                    width,
                    height: 120.
                }
                .validate()
                .is_err()
            );
        }
    }
}
#[tauri::command]
pub async fn docked_graph_pointer(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    event: unge_interaction::PointerEvent,
    expected_revision: u64,
) -> std::result::Result<u64, String> {
    if window.label() != "controls" {
        return Err("unknown_view".into());
    }
    let host = host.inner().clone();
    let app = window.app_handle().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = host.gate.lock().map_err(|_| "state_unavailable")?;
        let before = host
            .engine
            .dispatch("controls", unge_tauri::Request::Summary)
            .map_err(|e| e.code)?
            .revision;
        if let unge_interaction::PointerEvent::Down {
            position,
            button: unge_interaction::PointerButton::Primary,
            ..
        } = &event
            && super::graph_tools::minimap_click(&app, &host.engine, *position)
        {
            return Ok(before);
        }
        if let unge_interaction::PointerEvent::Down {
            position,
            button: unge_interaction::PointerButton::Primary,
            ..
        } = &event
        {
            if super::graph_tools::connecting(&app) {
                let position = *position;
                drop(_guard);
                super::graph_tools::click(&app, &host.engine, position);
                return host
                    .engine
                    .dispatch("controls", unge_tauri::Request::Summary)
                    .map(|s| s.revision)
                    .map_err(|e| e.code);
            }
        }
        let event = match event {
            unge_interaction::PointerEvent::Down {
                pointer,
                position,
                button: unge_interaction::PointerButton::Primary,
                additive,
            } if super::graph_tools::pan(&app) => unge_interaction::PointerEvent::Down {
                pointer,
                position,
                button: unge_interaction::PointerButton::Pan,
                additive,
            },
            other => other,
        };
        let released = match &event {
            unge_interaction::PointerEvent::Up { position, .. } => Some(*position),
            _ => None,
        };
        let finish = matches!(
            event,
            unge_interaction::PointerEvent::Up { .. } | unge_interaction::PointerEvent::Cancel
        );
        if cfg!(debug_assertions)&&std::env::var_os("STORY_GRAPH_PERFORMANCE_QA").is_some(){eprintln!("QA_GRAPH event={event:?}");}
        let summary = host
            .engine
            .dispatch(
                "controls",
                unge_tauri::Request::Pointer {
                    expected_revision,
                    event,
                },
            )
            .map_err(|e| e.code)?;
        if summary.revision != before {
            let _ = app.emit("unge://changed", &summary);
        }
        drop(_guard);
        if let Some(position) = released {
            super::graph_tools::click(&app, &host.engine, position);
        }
        if finish {
            let _ = app.emit("story://view-changed", ());
        }
        let main = app.clone();
        let _ = app.run_on_main_thread(move || super::redraw(&main));
        Ok(summary.revision)
    })
    .await
    .map_err(|_| "state_unavailable")?
}

pub fn visible() -> bool {
    #[cfg(target_os = "macos")]
    {
        mac::visible()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

#[tauri::command]
pub fn docked_graph_scroll(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    delta: [f32; 2],
    position: [f32; 2],
    zoom: bool,
) -> std::result::Result<(), String> {
    if window.label() != "controls" {
        return Err("unknown_view".into());
    }
    if delta
        .iter()
        .chain(position.iter())
        .any(|v| !v.is_finite() || v.abs() > 32768.)
    {
        return Err("invalid_pointer".into());
    }
    let mut viewport = host
        .engine
        .view_state("controls")
        .map_err(|e| e.code)?
        .viewport;
    if zoom {
        viewport.zoom_at(position, (-delta[1] * 0.002).exp().clamp(0.5, 2.));
    } else {
        viewport.pan([-delta[0], -delta[1]]);
    }
    host.engine
        .dispatch("controls", unge_tauri::Request::SetViewport { viewport })
        .map_err(|e| e.code)?;
    super::redraw(window.app_handle());
    Ok(())
}
