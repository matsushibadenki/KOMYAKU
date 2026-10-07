//! Tao input bridge for a native Tauri window. Keep this unstable Wry API at
//! the host boundary; unge-interaction itself has no window/runtime dependency.
use tauri::{Emitter, EventLoopMessage, Manager};
use tauri_runtime_wry::tao::{
    event::{ElementState, Event, MouseButton, MouseScrollDelta, WindowEvent},
    event_loop::{ControlFlow, EventLoopProxy, EventLoopWindowTarget},
    keyboard::{Key, ModifiersState},
};
use tauri_runtime_wry::{
    Context, EventLoopIterationContext, Message, Plugin, PluginBuilder, WebContextStore,
};
use unge_interaction::{PointerButton, PointerEvent};
use unge_tauri::{Engine, Request};

pub struct InputBridge {
    pub app: tauri::AppHandle,
    pub engine: Engine,
}
pub struct Input {
    app: tauri::AppHandle,
    engine: Engine,
    position: Option<[f32; 2]>,
    modifiers: ModifiersState,
    button: Option<MouseButton>,
    revision: u64,
    pending_move: bool,
    dirty: bool,
}
impl PluginBuilder<EventLoopMessage> for InputBridge {
    type Plugin = Input;
    fn build(self, _: Context<EventLoopMessage>) -> Input {
        Input {
            app: self.app,
            engine: self.engine,
            position: None,
            modifiers: ModifiersState::default(),
            button: None,
            revision: 0,
            pending_move: false,
            dirty: false,
        }
    }
}
impl Input {
    fn send(&mut self, event: PointerEvent) {
        let notify = matches!(&event, PointerEvent::Down { .. } | PointerEvent::Up { .. });
        match self.engine.dispatch(
            "controls",
            Request::Pointer {
                expected_revision: self.revision,
                event,
            },
        ) {
            Ok(summary) => {
                if notify {
                    let _ = self.app.emit("story://view-changed", ());
                }
                if summary.revision != self.revision {
                    let _ = self.app.emit("unge://changed", &summary);
                }
            }
            Err(error) => {
                eprintln!("pointer: {}: {}", error.code, error.message);
                let _ = self.app.emit("unge://interaction-error", &error);
                self.button = None;
            }
        }
        self.dirty = true;
    }
    fn cancel(&mut self) {
        if let Ok(summary) = self.engine.dispatch("controls", Request::Summary) {
            self.revision = summary.revision;
        }
        if self.button.is_some() {
            self.send(PointerEvent::Cancel);
        }
        self.button = None;
        self.pending_move = false;
    }
    fn flush_move(&mut self) {
        if self.pending_move {
            self.pending_move = false;
            if self.button.is_some()
                && let Some(position) = self.position
            {
                self.send(PointerEvent::Move {
                    pointer: 0,
                    position,
                });
            }
        }
    }
}
impl Plugin<EventLoopMessage> for Input {
    fn on_event(
        &mut self,
        event: &Event<Message<EventLoopMessage>>,
        _: &EventLoopWindowTarget<Message<EventLoopMessage>>,
        _: &EventLoopProxy<Message<EventLoopMessage>>,
        _: &mut ControlFlow,
        context: EventLoopIterationContext<'_, EventLoopMessage>,
        _: &WebContextStore,
    ) -> bool {
        if matches!(event, Event::MainEventsCleared) {
            self.flush_move();
            if std::mem::take(&mut self.dirty) {
                super::redraw(&self.app);
            }
            return false;
        }
        let Event::WindowEvent {
            window_id, event, ..
        } = event
        else {
            return false;
        };
        let canvas = context.window_id_map.get(window_id).is_some_and(|id| {
            context
                .windows
                .0
                .borrow()
                .get(&id)
                .is_some_and(|w| w.label() == "canvas")
        });
        if !canvas {
            return false;
        }
        let Some(window) = self.app.get_window("canvas") else {
            return false;
        };
        let scale = window.scale_factor().unwrap_or(1.0);
        match event {
            WindowEvent::CursorMoved { position, .. } => {
                self.position = Some([(position.x / scale) as f32, (position.y / scale) as f32]);
                self.pending_move = self.button.is_some();
            }
            WindowEvent::ModifiersChanged(modifiers) => self.modifiers = *modifiers,
            WindowEvent::MouseInput { state, button, .. } => {
                if !matches!(
                    button,
                    MouseButton::Left | MouseButton::Middle | MouseButton::Right
                ) {
                    return false;
                }
                self.flush_move();
                let Some(position) = self.position else {
                    return false;
                };
                if (position[0] < super::ICON_RAIL_WIDTH as f32
                    || super::graph_tools::blocks_pointer(&self.app, position))
                    && self.button.is_none()
                {
                    return false;
                }
                if *state == ElementState::Pressed && self.button.is_none() {
                    if let Ok(summary) = self.engine.dispatch("controls", Request::Summary) {
                        self.revision = summary.revision;
                    }
                    if *button == MouseButton::Left && super::graph_tools::connecting(&self.app) {
                        super::graph_tools::click(&self.app, &self.engine, position);
                        return false;
                    }
                    self.button = Some(*button);
                    self.send(PointerEvent::Down {
                        pointer: 0,
                        position,
                        button: if *button == MouseButton::Left
                            && !super::graph_tools::pan(&self.app)
                        {
                            PointerButton::Primary
                        } else {
                            PointerButton::Pan
                        },
                        additive: self.modifiers.shift_key(),
                    });
                } else if *state == ElementState::Released && self.button == Some(*button) {
                    self.send(PointerEvent::Up {
                        pointer: 0,
                        position,
                    });
                    self.button = None;
                    super::graph_tools::click(&self.app, &self.engine, position);
                }
            }
            WindowEvent::MouseWheel { delta, .. } if self.button.is_none() => {
                if let (Some(position), Ok(state)) =
                    (self.position, self.engine.view_state("controls"))
                {
                    if position[0] < super::ICON_RAIL_WIDTH as f32
                        || super::graph_tools::blocks_pointer(&self.app, position)
                    {
                        return false;
                    }
                    let dy = match delta {
                        MouseScrollDelta::LineDelta(_, y) => f64::from(*y) * 40.,
                        MouseScrollDelta::PixelDelta(p) => p.y / scale,
                        _ => return false,
                    };
                    let mut viewport = state.viewport;
                    viewport.zoom_at(position, (dy.clamp(-400., 400.) as f32 * 0.002).exp());
                    if let Err(error) = self
                        .engine
                        .dispatch("controls", Request::SetViewport { viewport })
                    {
                        let _ = self.app.emit("unge://interaction-error", error);
                    }
                    self.dirty = true;
                }
            }
            WindowEvent::KeyboardInput { event, .. }
                if event.state == ElementState::Pressed && event.logical_key == Key::Escape =>
            {
                self.cancel()
            }
            WindowEvent::Focused(false)
            | WindowEvent::Resized(_)
            | WindowEvent::ScaleFactorChanged { .. } => {
                self.cancel();
                self.position = None;
                self.modifiers = ModifiersState::default();
            }
            WindowEvent::CursorLeft { .. } => {
                // Cancel explicitly if the host cannot guarantee pointer capture.
                self.cancel();
                self.position = None;
            }
            _ => {}
        }
        false // Tauri still handles its normal window lifecycle.
    }
}
