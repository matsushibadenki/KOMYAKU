//! Graph tools own transient selection/tool state in Rust; child WebViews only edit projections.
use super::*;

#[derive(Default)]
pub struct Tools {
    pub state: Mutex<ToolState>,
}
#[derive(Default)]
pub struct ToolState {
    pub pan: bool,
    pub connect: bool,
    pub from: Option<Id>,
    pub edge: Option<Id>,
    pub open: bool,
    pub form: Option<String>,
}
fn authorize(webview: &tauri::Webview) -> std::result::Result<(), String> {
    if ["graph-rail", "graph-inspector"].contains(&webview.label()) {
        Ok(())
    } else {
        Err("unknown_view".into())
    }
}
pub fn layout(app: &tauri::AppHandle) {
    if let (Some(canvas), Some(panel)) =
        (app.get_window("canvas"), app.get_webview("graph-inspector"))
        && let (Ok(size), Ok(scale)) = (canvas.inner_size(), canvas.scale_factor())
    {
        let width = (size.width as f64 / scale - ICON_RAIL_WIDTH).clamp(1., 300.);
        let _ = panel.set_position(tauri::LogicalPosition::new(
            size.width as f64 / scale - width,
            0.,
        ));
        let _ = panel.set_size(tauri::LogicalSize::new(width, size.height as f64 / scale));
    }
}
fn show(app: &tauri::AppHandle, open: bool) {
    if let Some(tools) = app.try_state::<Tools>()
        && let Ok(mut state) = tools.state.lock()
    {
        state.open = open;
    }
    layout(app);
    if let Some(panel) = app.get_webview("graph-inspector") {
        let _ = if open { panel.show() } else { panel.hide() };
    }
    let _ = app.emit("graph://changed", ());
}
pub fn blocks_pointer(app: &tauri::AppHandle, position: [f32; 2]) -> bool {
    let open = app
        .try_state::<Tools>()
        .and_then(|tools| tools.state.lock().ok().map(|s| s.open))
        .unwrap_or(false);
    let width = app
        .get_window("canvas")
        .and_then(|w| Some(w.inner_size().ok()?.width as f64 / w.scale_factor().ok()?))
        .unwrap_or(1100.);
    open && f64::from(position[0]) >= (width - 300.).max(ICON_RAIL_WIDTH)
}
fn node_hit(doc: &Document, point: [f32; 2]) -> Option<Id> {
    doc.placement()
        .iter()
        .rev()
        .find(|(_, r)| {
            point[0] >= r.x
                && point[0] <= r.x + r.width
                && point[1] >= r.y
                && point[1] <= r.y + r.height
        })
        .map(|(id, _)| *id)
}
fn curve_point(a: [f32; 2], b: [f32; 2], t: f32) -> [f32; 2] {
    let dx = ((b[0] - a[0]).abs() * 0.5).max(50.);
    let u = 1. - t;
    [0, 1].map(|i| {
        u * u * u * a[i]
            + 3. * u * u * t * (a[i] + if i == 0 { dx } else { 0. })
            + 3. * u * t * t * (b[i] - if i == 0 { dx } else { 0. })
            + t * t * t * b[i]
    })
}
fn distance(p: [f32; 2], a: [f32; 2], b: [f32; 2]) -> f32 {
    let d = [b[0] - a[0], b[1] - a[1]];
    let t = (((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1])
        / (d[0] * d[0] + d[1] * d[1]).max(0.001))
    .clamp(0., 1.);
    (p[0] - a[0] - t * d[0]).hypot(p[1] - a[1] - t * d[1])
}
fn edge_hit(doc: &Document, point: [f32; 2], zoom: f32) -> Option<Id> {
    let mut best = (8. / zoom, None);
    for edge in doc.graph().edges().values() {
        let from = doc.graph().nodes().get(&edge.from.node)?;
        let to = doc.graph().nodes().get(&edge.to.node)?;
        let a = port_anchor(
            *doc.placement().get(&from.id)?,
            from.outputs.iter().position(|p| p.name == edge.from.port)?,
            from.outputs.len(),
            true,
        );
        let b = port_anchor(
            *doc.placement().get(&to.id)?,
            to.inputs.iter().position(|p| p.name == edge.to.port)?,
            to.inputs.len(),
            false,
        );
        let mut previous = a;
        for i in 1..=96 {
            let next = curve_point(a, b, i as f32 / 96.);
            let dist = distance(point, previous, next);
            if dist < best.0 {
                best = (dist, Some(edge.id));
            }
            previous = next;
        }
    }
    best.1
}
pub fn pan(app: &tauri::AppHandle) -> bool {
    app.try_state::<Tools>()
        .and_then(|t| t.state.lock().ok().map(|s| s.pan))
        .unwrap_or(false)
}
pub fn connecting(app: &tauri::AppHandle) -> bool {
    app.try_state::<Tools>()
        .and_then(|t| t.state.lock().ok().map(|s| s.connect))
        .unwrap_or(false)
}
pub fn click(app: &tauri::AppHandle, engine: &Engine, position: [f32; 2]) {
    let Ok(view) = engine.view_state("controls") else {
        return;
    };
    let Ok(doc) = engine.snapshot() else { return };
    let point = [
        view.viewport.origin[0] + position[0] / view.viewport.zoom,
        view.viewport.origin[1] + position[1] / view.viewport.zoom,
    ];
    let Some(tools) = app.try_state::<Tools>() else {
        return;
    };
    let Ok(mut state) = tools.state.lock() else {
        return;
    };
    if state.connect {
        if let Some(id) =
            node_hit(&doc, point).filter(|id| doc.graph().nodes()[id].type_id == domain::CHARACTER)
        {
            if let Some(from) = state.from.take() {
                if from != id {
                    drop(state);
                    let revision = engine
                        .dispatch("controls", Request::Summary)
                        .map(|s| s.revision)
                        .unwrap_or(0);
                    if let Some(window) = app.get_webview_window("controls") {
                        let host = app.state::<Host>().inner().clone();
                        if let Err(error) = edit_blocking(
                            window,
                            host,
                            revision,
                            Action::AddRelationship {
                                from,
                                to: id,
                                title: match view.locale {
                                    Locale::Ja => "新しい関係",
                                    Locale::ZhCn => "新关系",
                                    _ => "New relationship",
                                }
                                .into(),
                                relation: "friend".into(),
                                mutual: true,
                            },
                        ) {
                            let _ = app.emit("unge://interaction-error", error);
                        } else if let Ok(updated) = engine.snapshot() {
                            if let Some(id) = updated
                                .graph()
                                .nodes()
                                .keys()
                                .find(|id| !doc.graph().nodes().contains_key(id))
                            {
                                let _ = engine
                                    .dispatch("controls", Request::Select { ids: [*id].into() });
                            }
                            if let Ok(mut state) = tools.state.lock() {
                                state.connect = false;
                                state.form = None;
                                state.edge = None;
                            }
                            show(app, true);
                        }
                    }
                    let _ = app.emit("graph://changed", ());
                    redraw(app);
                    return;
                }
            } else {
                state.from = Some(id);
                let _ = engine.dispatch("controls", Request::Select { ids: [id].into() });
                redraw(app);
            }
        }
        drop(state);
        let _ = app.emit("graph://changed", ());
        return;
    }
    if state.pan {
        return;
    }
    state.form = None;
    state.edge = if node_hit(&doc, point).is_none() {
        edge_hit(&doc, point, view.viewport.zoom)
    } else {
        None
    };
    let _ = engine.highlight_edge("controls", state.edge);
    let open = state.edge.is_some() || !view.selection.is_empty();
    drop(state);
    show(app, open);
}
#[tauri::command]
pub fn graph_state(
    webview: tauri::Webview,
    host: tauri::State<Host>,
    tools: tauri::State<Tools>,
) -> std::result::Result<Value, String> {
    authorize(&webview)?;
    if webview
        .app_handle()
        .get_window("canvas")
        .is_none_or(|window| !window.is_visible().unwrap_or(false))
    {
        return Ok(json!({"hidden":true}));
    }
    let mut value = projection(&host.engine)?;
    let doc = host.engine.snapshot().map_err(|e| e.code)?;
    value["ports"]=json!(doc.graph().nodes().values().map(|n|(n.id.to_string(),json!({"inputs":n.inputs.iter().map(|p|&p.name).collect::<Vec<_>>(),"outputs":n.outputs.iter().map(|p|&p.name).collect::<Vec<_>>()}))).collect::<std::collections::BTreeMap<_,_>>());
    value["edges"]=json!(doc.graph().edges().values().map(|e|json!({"id":e.id,"from":e.from.node,"to":e.to.node,"port":e.to.port,"fromPort":e.from.port})).collect::<Vec<_>>());
    let mut state = tools.state.lock().map_err(|_| "state_unavailable")?;
    state.edge = state.edge.filter(|id| doc.graph().edges().contains_key(id));
    state.from = state.from.filter(|id| doc.graph().nodes().contains_key(id));
    let view = host.engine.view_state("controls").map_err(|e| e.code)?;
    value["language"] = json!(match view.locale {
        Locale::Ja => "ja",
        Locale::ZhCn => "zh-CN",
        _ => "en",
    });
    value["tool"] = json!(if state.pan {
        "pan"
    } else if state.connect {
        "connect"
    } else {
        "select"
    });
    value["form"] = json!(state.form);
    value["pendingFrom"] = json!(state.from);
    value["selectedEdge"] = json!(state.edge);
    value["open"] = json!(state.open);
    if let Some(id) = value["selected"]
        .as_str()
        .and_then(|s| s.parse::<Id>().ok())
    {
        let node = doc.graph().nodes().get(&id).ok_or("missing_node")?;
        value["details"] = json!({"id":node.id,"title":node.properties.get("title"),"role":node.properties.get("role"),"notes":node.properties.get("notes"),"kind":node.properties.get("kind"),"mutual":node.properties.get("mutual")});
    }
    Ok(value)
}
#[tauri::command]
pub async fn graph_action(
    webview: tauri::Webview,
    host: tauri::State<'_, Host>,
    tools: tauri::State<'_, Tools>,
    action: Value,
    expected_revision: u64,
) -> std::result::Result<(), String> {
    authorize(&webview)?;
    let app = webview.app_handle().clone();
    let host = host.inner().clone();
    let kind = action["kind"].as_str().ok_or("invalid_command")?;
    match kind {
        "tool" => {
            let mut state = tools.state.lock().map_err(|_| "state_unavailable")?;
            let tool = action["tool"].as_str().ok_or("invalid_command")?;
            if !["select", "pan", "connect"].contains(&tool) {
                return Err("invalid_command".into());
            }
            state.pan = tool == "pan";
            state.connect = tool == "connect";
            state.from = None;
        }
        "form" => {
            let form = action["form"]
                .as_str()
                .filter(|s| ["character", "scene", "relationship"].contains(s))
                .ok_or("invalid_command")?;
            tools.state.lock().map_err(|_| "state_unavailable")?.form = Some(form.into());
            show(&app, true);
        }
        "close" => show(&app, false),
        "inspector" => show(&app, true),
        "zoom" | "fit" => {
            let view = host.engine.view_state("controls").map_err(|e| e.code)?;
            let mut viewport = view.viewport;
            if kind == "zoom" {
                let factor = action["factor"]
                    .as_f64()
                    .filter(|f| f.is_finite() && *f >= 0.5 && *f <= 2.)
                    .ok_or("invalid_command")?;
                viewport.zoom_at(
                    [viewport.size[0] * 0.5, viewport.size[1] * 0.5],
                    factor as f32,
                );
            } else {
                let doc = host.engine.snapshot().map_err(|e| e.code)?;
                let rects: Vec<_> = doc.placement().values().collect();
                if !rects.is_empty() {
                    let left = rects.iter().map(|r| r.x).fold(f32::INFINITY, f32::min);
                    let top = rects.iter().map(|r| r.y).fold(f32::INFINITY, f32::min);
                    let right = rects
                        .iter()
                        .map(|r| r.x + r.width)
                        .fold(f32::NEG_INFINITY, f32::max);
                    let bottom = rects
                        .iter()
                        .map(|r| r.y + r.height)
                        .fold(f32::NEG_INFINITY, f32::max);
                    viewport.zoom = ((viewport.size[0] - 400.).max(100.) / (right - left + 80.))
                        .min((viewport.size[1] - 80.).max(100.) / (bottom - top + 80.))
                        .clamp(0.1, 2.);
                    viewport.origin = [left - 80. / viewport.zoom, top - 40. / viewport.zoom];
                }
            }
            host.engine
                .dispatch("controls", Request::SetViewport { viewport })
                .map_err(|e| e.code)?;
        }
        "properties" => {
            let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
            let id: Id = action["id"]
                .as_str()
                .ok_or("invalid_command")?
                .parse()
                .map_err(|_| "invalid_command")?;
            let changes = action["changes"]
                .as_object()
                .filter(|m| !m.is_empty() && m.len() <= 5)
                .ok_or("invalid_command")?;
            let mut commands = Vec::new();
            for (key, value) in changes {
                if !["title", "role", "notes", "kind", "mutual"].contains(&key.as_str()) {
                    return Err("invalid_property".into());
                }
                if let Request::Apply { command, .. } = build_command(
                    &host,
                    Action::Property {
                        id,
                        key: key.clone(),
                        value: value.clone(),
                    },
                    expected_revision,
                )? {
                    commands.push(command);
                }
            }
            host.engine
                .dispatch(
                    "controls",
                    Request::Apply {
                        expected_revision,
                        command: Command::Batch { commands },
                    },
                )
                .map_err(|e| e.code)?;
            let snapshot = host.engine.snapshot().map_err(|e| e.code)?;
            let saved = host
                .saves
                .lock()
                .map_err(|_| "state_unavailable")?
                .save_patched(&host.path, &snapshot, &[]);
            drop(_gate);
            let _ = app.emit("unge://changed", json!({"storySaved":saved.is_ok()}));
            let _ = app.emit("story://changed", projection(&host.engine)?);
            if saved.is_err() {
                let _ = app.emit("graph://changed", ());
                redraw(&app);
                return Err("save_failed".into());
            }
        }
        "rewire" | "disconnect" => {
            let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
            let doc = host.engine.snapshot().map_err(|e| e.code)?;
            let id: Id = action["id"]
                .as_str()
                .ok_or("invalid_command")?
                .parse()
                .map_err(|_| "invalid_command")?;
            let edge = doc.graph().edges().get(&id).ok_or("missing_edge")?;
            let mut commands = vec![Command::Disconnect { id }];
            if kind == "rewire" {
                let mut edge = edge.clone();
                edge.from.node = action["from"]
                    .as_str()
                    .ok_or("invalid_command")?
                    .parse()
                    .map_err(|_| "invalid_command")?;
                edge.to.node = action["to"]
                    .as_str()
                    .ok_or("invalid_command")?
                    .parse()
                    .map_err(|_| "invalid_command")?;
                edge.from.port = action["fromPort"].as_str().ok_or("invalid_command")?.into();
                edge.to.port = action["toPort"].as_str().ok_or("invalid_command")?.into();
                if doc
                    .graph()
                    .nodes()
                    .get(&edge.to.node)
                    .is_some_and(|n| n.type_id == domain::RELATION)
                    && doc.graph().edges().values().any(|other| {
                        other.id != id
                            && other.to.node == edge.to.node
                            && other.from.node == edge.from.node
                    })
                {
                    return Err("invalid_relationship".into());
                }
                commands.push(Command::Connect { edge });
            }
            host.engine
                .dispatch(
                    "controls",
                    Request::Apply {
                        expected_revision,
                        command: Command::Batch { commands },
                    },
                )
                .map_err(|e| e.code)?;
            let selected = if kind == "rewire" { Some(id) } else { None };
            tools.state.lock().map_err(|_| "state_unavailable")?.edge = selected;
            host.engine
                .highlight_edge("controls", selected)
                .map_err(|e| e.code)?;
            let snapshot = host.engine.snapshot().map_err(|e| e.code)?;
            let saved = host
                .saves
                .lock()
                .map_err(|_| "state_unavailable")?
                .save_patched(&host.path, &snapshot, &[]);
            drop(_gate);
            let _ = app.emit("unge://changed", json!({"storySaved":saved.is_ok()}));
            let _ = app.emit("story://changed", projection(&host.engine)?);
            if saved.is_err() {
                let _ = app.emit("graph://changed", ());
                redraw(&app);
                return Err("save_failed".into());
            }
        }
        _ => {
            let action: Action = serde_json::from_value(action).map_err(|_| "invalid_command")?;
            if !matches!(
                action,
                Action::Property { .. }
                    | Action::Remove { .. }
                    | Action::AddCharacter { .. }
                    | Action::AddScene { .. }
                    | Action::AddRelationship { .. }
                    | Action::Undo
                    | Action::Redo
            ) {
                return Err("invalid_command".into());
            }
            let controls = app.get_webview_window("controls").ok_or("unknown_view")?;
            let creating = matches!(
                &action,
                Action::AddCharacter { .. }
                    | Action::AddScene { .. }
                    | Action::AddRelationship { .. }
            );
            let previous = if creating {
                Some(
                    host.engine
                        .snapshot()
                        .map_err(|e| e.code)?
                        .graph()
                        .nodes()
                        .keys()
                        .copied()
                        .collect::<std::collections::BTreeSet<_>>(),
                )
            } else {
                None
            };
            let engine = host.engine.clone();
            tauri::async_runtime::spawn_blocking(move || {
                edit_blocking(controls, host, expected_revision, action)
            })
            .await
            .map_err(|_| "state_unavailable")??;
            if let Some(previous) = previous {
                let doc = engine.snapshot().map_err(|e| e.code)?;
                if let Some(id) = doc.graph().nodes().keys().find(|id| !previous.contains(id)) {
                    engine
                        .dispatch("controls", Request::Select { ids: [*id].into() })
                        .map_err(|e| e.code)?;
                }
            }
            tools.state.lock().map_err(|_| "state_unavailable")?.form = None;
        }
    }
    let _ = app.emit("graph://changed", ());
    redraw(&app);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cable_picking_tracks_curves_and_uses_screen_space_tolerance() {
        let registry = domain::registry();
        let document = domain::initial_document(&registry);
        let edge = document.graph().edges().values().next().unwrap();
        let from = &document.graph().nodes()[&edge.from.node];
        let to = &document.graph().nodes()[&edge.to.node];
        let a = port_anchor(
            document.placement()[&from.id],
            from.outputs
                .iter()
                .position(|p| p.name == edge.from.port)
                .unwrap(),
            from.outputs.len(),
            true,
        );
        let b = port_anchor(
            document.placement()[&to.id],
            to.inputs
                .iter()
                .position(|p| p.name == edge.to.port)
                .unwrap(),
            to.inputs.len(),
            false,
        );
        let point = curve_point(a, b, 0.5);
        assert!(edge_hit(&document, point, 1.).is_some());
        assert!(edge_hit(&document, [10000., 10000.], 1.).is_none());
        for zoom in [0.5, 1., 3.] {
            assert!(edge_hit(&document, point, zoom).is_some());
        }
    }
    #[test]
    fn reconnect_is_atomic_and_undo_restores_original_cable() {
        let registry = domain::registry();
        let document = domain::initial_document(&registry);
        let edge = document
            .graph()
            .edges()
            .values()
            .find(|e| e.from.port == "person")
            .unwrap()
            .clone();
        let mut editor = Editor::new(document, 10)
            .unwrap()
            .with_validator(Arc::new(domain::Validator(registry)))
            .unwrap();
        let original = editor.document().to_json().unwrap();
        let mut invalid = edge.clone();
        invalid.to.port = "missing".into();
        assert!(
            editor
                .execute(Command::Batch {
                    commands: vec![
                        Command::Disconnect { id: edge.id },
                        Command::Connect { edge: invalid }
                    ]
                })
                .is_err()
        );
        assert_eq!(editor.document().to_json().unwrap(), original);
        editor.execute(Command::Disconnect { id: edge.id }).unwrap();
        editor.undo().unwrap();
        assert_eq!(editor.document().to_json().unwrap(), original);
    }
}
