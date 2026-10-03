mod ai;
mod chatgpt;
mod domain;
mod input;
mod preferences;
const ICON_RAIL_WIDTH: f64 = 48.0;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{Emitter, Listener, Manager};
use unge_core::*;
use unge_render::{LabelCatalog, LabelText, NodeLabels, SurfaceRenderer};
use unge_tauri::{Engine, Request};
#[derive(Clone)]
struct Host {
    engine: Engine,
    registry: Arc<unge_executor::Registry>,
    path: PathBuf,
    gate: Arc<Mutex<()>>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct SavedWorkspace {
    format: String,
    version: u32,
    document: Document,
}
fn save(path: &std::path::Path, document: &Document) -> std::result::Result<(), String> {
    use std::io::Write;
    document.validate().map_err(|e| e.to_string())?;
    #[derive(Serialize)]
    struct Snapshot<'a> {
        format: &'static str,
        version: u32,
        document: &'a Document,
    }
    let bytes = serde_json::to_vec_pretty(&Snapshot {
        format: "komyaku-story-workspace",
        version: 1,
        document,
    })
    .map_err(|e| e.to_string())?;
    let temporary = path.with_extension("pending");
    let mut file = std::fs::File::create(&temporary).map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    std::fs::rename(&temporary, path).map_err(|e| e.to_string())?;
    if let Some(parent) = path.parent() {
        std::fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}
fn load(path: &std::path::Path) -> std::result::Result<Document, String> {
    if std::fs::metadata(path).map_err(|e| e.to_string())?.len() > 128 * 1024 * 1024 {
        return Err("limit_exceeded".into());
    }
    let saved: SavedWorkspace =
        serde_json::from_slice(&std::fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    if saved.format != "komyaku-story-workspace" || saved.version != 1 {
        return Err("unsupported_workspace".into());
    }
    saved.document.validate().map_err(|e| e.to_string())?;
    Ok(saved.document)
}
fn labels(registry: &unge_executor::Registry) -> LabelCatalog {
    registry
        .definitions()
        .map(|d| {
            (
                d.type_id.clone(),
                NodeLabels {
                    title: LabelText {
                        en: d.name.en.clone(),
                        ja: d.name.ja.clone(),
                        zh_cn: d.name.zh_cn.clone(),
                    },
                    inputs: d
                        .inputs
                        .iter()
                        .map(|p| {
                            (
                                p.name.clone(),
                                LabelText {
                                    en: p.name.clone(),
                                    ja: match p.name.as_str() {
                                        "from" => "人物 A",
                                        "to" => "人物 B",
                                        _ => "前",
                                    }
                                    .into(),
                                    zh_cn: match p.name.as_str() {
                                        "from" => "人物 A",
                                        "to" => "人物 B",
                                        _ => "前",
                                    }
                                    .into(),
                                },
                            )
                        })
                        .collect(),
                    outputs: d
                        .outputs
                        .iter()
                        .map(|p| {
                            (
                                p.name.clone(),
                                LabelText {
                                    en: p.name.clone(),
                                    ja: match p.name.as_str() {
                                        "person" => "人物",
                                        "next" => "次",
                                        _ => "本文",
                                    }
                                    .into(),
                                    zh_cn: match p.name.as_str() {
                                        "person" => "人物",
                                        "next" => "后",
                                        _ => "正文",
                                    }
                                    .into(),
                                },
                            )
                        })
                        .collect(),
                },
            )
        })
        .collect()
}
fn redraw(app: &tauri::AppHandle) {
    let Some(engine) = app.try_state::<Engine>() else {
        return;
    };
    if let Some(canvas) = app.get_window("canvas")
        && let Ok(size) = canvas.inner_size()
        && let Err(error) = engine.draw_scaled(
            "controls",
            [size.width, size.height],
            canvas.scale_factor().unwrap_or(1.),
        )
    {
        eprintln!("{}: {}", error.code, error.message);
    }
}
fn allowed(window: &tauri::WebviewWindow) -> std::result::Result<(), String> {
    if ["controls", "editor"].contains(&window.label()) {
        Ok(())
    } else {
        Err("unknown_view".into())
    }
}
fn projection(engine: &Engine) -> std::result::Result<Value, String> {
    let (document, summary) = engine.snapshot_with_summary().map_err(|e| e.code)?;
    let nodes:Vec<_>=document.graph().nodes().values().map(|node|json!({"id":node.id,"type":node.type_id,"title":node.properties["title"],"order":node.properties.get("order"),"path":node.properties.get("path"),"kind":node.properties.get("kind"),"mutual":node.properties.get("mutual"),"parent":node.properties.get("parent"),"outlineOrder":node.properties.get("outlineOrder")})).collect();
    let edges: Vec<_> = document
        .graph()
        .edges()
        .values()
        .map(|e| json!({"id":e.id,"from":e.from.node,"to":e.to.node,"port":e.to.port}))
        .collect();
    let selected = engine
        .view_state("controls")
        .map_err(|e| e.code)?
        .selection
        .iter()
        .next()
        .copied();
    Ok(
        json!({"projectTitle":engine.snapshot().map_err(|e|e.code)?.title,"revision":summary.revision,"selected":selected,"nodes":nodes,"edges":edges,"untitled":std::env::var_os("STORY_GRAPH_NEW_WORKSPACE").is_some()}),
    )
}
#[tauri::command]
fn workspace(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
) -> std::result::Result<Value, String> {
    allowed(&window)?;
    let _lock = host.gate.lock().map_err(|_| "state_unavailable")?;
    projection(&host.engine)
}
#[tauri::command]
fn selected(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    id: Id,
) -> std::result::Result<Node, String> {
    allowed(&window)?;
    host.engine.inspect(window.label(), id).map_err(|e| e.code)
}
#[tauri::command]
fn choose(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    id: Id,
) -> std::result::Result<Value, String> {
    allowed(&window)?;
    host.engine
        .dispatch("controls", Request::Select { ids: [id].into() })
        .map_err(|e| e.code)?;
    let result = projection(&host.engine)?;
    window
        .app_handle()
        .emit("story://changed", &result)
        .map_err(|_| "event_error")?;
    redraw(window.app_handle());
    Ok(result)
}
#[tauri::command]
fn locale(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    language: String,
) -> std::result::Result<(), String> {
    allowed(&window)?;
    let locale = match language.as_str() {
        "ja" => Locale::Ja,
        "en" => Locale::En,
        "zh-CN" => Locale::ZhCn,
        _ => return Err("invalid_locale".into()),
    };
    host.engine
        .dispatch("controls", Request::SetLocale { locale })
        .map_err(|e| e.code)?;
    redraw(window.app_handle());
    Ok(())
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
enum Action {
    ProjectTitle {
        title: String,
    },
    AddScene {
        title: String,
        path: String,
        #[serde(default)]
        parent: Option<Id>,
    },
    AddContainer {
        title: String,
        level: String,
        #[serde(default)]
        parent: Option<Id>,
    },
    MoveOutline {
        id: Id,
        target: Option<Id>,
        position: String,
    },
    AddCharacter {
        title: String,
    },
    AddRelationship {
        from: Id,
        to: Id,
        title: String,
        relation: String,
        mutual: bool,
    },
    Property {
        id: Id,
        key: String,
        value: Value,
    },
    Paragraphs {
        id: Id,
        changes: Vec<ParagraphChange>,
    },
    Canonical {
        id: Id,
        document: Value,
    },
    Text {
        id: Id,
        text: String,
    },
    Remove {
        id: Id,
    },
    Undo,
    Redo,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ParagraphChange {
    paragraph: Id,
    text: String,
    #[serde(default)]
    start: Option<usize>,
    #[serde(default)]
    end: Option<usize>,
}
fn replace_paragraph_text(
    paragraph: &mut Value,
    change: &ParagraphChange,
) -> std::result::Result<(), String> {
    let current = paragraph["content"]
        .as_array()
        .ok_or("invalid_document")?
        .iter()
        .map(|n| n["text"].as_str().ok_or("invalid_document"))
        .collect::<std::result::Result<Vec<_>, _>>()?
        .concat();
    let text = match (change.start, change.end) {
        (None, None) => change.text.clone(),
        (Some(start), Some(end)) if start <= end => {
            let mut units = 0;
            let mut from = None;
            let mut to = None;
            for (byte, ch) in current.char_indices() {
                if units == start {
                    from = Some(byte);
                }
                if units == end {
                    to = Some(byte);
                }
                units += ch.len_utf16();
            }
            if units == start {
                from = Some(current.len());
            }
            if units == end {
                to = Some(current.len());
            }
            let from = from.ok_or("invalid_document")?;
            let to = to.ok_or("invalid_document")?;
            let mut text = String::with_capacity(current.len() + change.text.len());
            text.push_str(&current[..from]);
            text.push_str(&change.text);
            text.push_str(&current[to..]);
            text
        }
        _ => return Err("invalid_document".into()),
    };
    if text.len() > domain::MAX_SCENE_TEXT_BYTES {
        return Err("limit_exceeded".into());
    }
    paragraph["content"] = if text.is_empty() {
        json!([])
    } else {
        json!([{"type":"text","text":text,"marks":[],"metadata":{},"extensions":{}}])
    };
    Ok(())
}
fn hierarchy_move(
    doc: &Document,
    id: Id,
    target: Option<Id>,
    position: &str,
) -> std::result::Result<Command, String> {
    let nodes = doc.graph().nodes();
    let node = nodes.get(&id).ok_or("missing_node")?;
    if ![domain::BLOCK, domain::SEQUENCE, domain::SCENE].contains(&node.type_id.as_str())
        || target == Some(id)
    {
        return Err("invalid_parent".into());
    }
    let target_node = target
        .map(|id| nodes.get(&id).ok_or("missing_node"))
        .transpose()?;
    let parent = match (position, target_node) {
        ("root", None) if node.type_id == domain::BLOCK => None,
        ("inside", Some(to))
            if (node.type_id == domain::SEQUENCE && to.type_id == domain::BLOCK)
                || (node.type_id == domain::SCENE && to.type_id == domain::SEQUENCE) =>
        {
            Some(to.id.to_string())
        }
        ("before" | "after", Some(to)) if node.type_id == to.type_id => to
            .properties
            .get("parent")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        _ => return Err("invalid_parent".into()),
    };
    if node.type_id != domain::BLOCK && parent.is_none() {
        return Err("invalid_parent".into());
    }
    let mut siblings: Vec<_> = nodes
        .values()
        .filter(|n| {
            n.id != id
                && n.type_id == node.type_id
                && n.properties
                    .get("parent")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    == parent.as_deref()
        })
        .collect();
    siblings.sort_by_key(|n| {
        (
            n.properties
                .get("outlineOrder")
                .and_then(Value::as_u64)
                .unwrap_or(n.properties["order"].as_u64().unwrap_or(0)),
            n.id,
        )
    });
    let index = if ["before", "after"].contains(&position) {
        siblings
            .iter()
            .position(|n| Some(n.id) == target)
            .ok_or("invalid_parent")?
            + usize::from(position == "after")
    } else {
        siblings.len()
    };
    siblings.insert(index, node);
    let mut commands = Vec::new();
    if let Some(parent) = parent {
        commands.push(Command::SetProperty {
            id,
            key: "parent".into(),
            value: Some(json!(parent)),
        });
    }
    for (order, sibling) in siblings.iter().enumerate() {
        commands.push(Command::SetProperty {
            id: sibling.id,
            key: "outlineOrder".into(),
            value: Some(json!(order)),
        });
    }
    Ok(Command::Batch { commands })
}
fn build_command(
    host: &Host,
    action: Action,
    revision: u64,
) -> std::result::Result<Request, String> {
    let command = match action {
        Action::ProjectTitle { title } => {
            if title.chars().count() > 200 || title.contains(['\n', '\r']) {
                return Err("invalid_properties".into());
            }
            Command::SetDocumentTitle { title }
        }
        Action::MoveOutline {
            id,
            target,
            position,
        } => {
            let doc = host.engine.snapshot().map_err(|e| e.code)?;
            hierarchy_move(&doc, id, target, &position)?
        }
        Action::AddCharacter { title } => {
            let mut node = host
                .registry
                .definition(domain::CHARACTER)
                .unwrap()
                .instantiate();
            node.properties.insert("title".into(), json!(title));
            let count = host
                .engine
                .snapshot()
                .map_err(|e| e.code)?
                .graph()
                .nodes()
                .values()
                .filter(|n| n.type_id == domain::CHARACTER)
                .count();
            Command::AddNode {
                node,
                rect: Rect {
                    x: 40.,
                    y: 400. + count as f32 * 150.,
                    width: 220.,
                    height: 110.,
                },
            }
        }
        Action::AddContainer {
            title,
            level,
            parent,
        } => {
            let type_id = match level.as_str() {
                "block" => domain::BLOCK,
                "sequence" => domain::SEQUENCE,
                _ => return Err("invalid_parent".into()),
            };
            let document = host.engine.snapshot().map_err(|e| e.code)?;
            if type_id == domain::SEQUENCE
                && parent.is_none_or(|id| {
                    document
                        .graph()
                        .nodes()
                        .get(&id)
                        .is_none_or(|node| node.type_id != domain::BLOCK)
                })
            {
                return Err("invalid_parent".into());
            }
            if type_id == domain::BLOCK && parent.is_some() {
                return Err("invalid_parent".into());
            }
            let mut node = host.registry.definition(type_id).unwrap().instantiate();
            node.properties.insert("title".into(), json!(title));
            if let Some(parent) = parent {
                node.properties
                    .insert("parent".into(), json!(parent.to_string()));
            }
            let count = document
                .graph()
                .nodes()
                .values()
                .filter(|n| n.type_id == type_id)
                .count();
            node.properties.insert("outlineOrder".into(), json!(count));
            node.properties.insert("order".into(), json!(count));
            Command::AddNode {
                node,
                rect: Rect {
                    x: 40. + count as f32 * 260.,
                    y: if type_id == domain::BLOCK {
                        -260.
                    } else {
                        -110.
                    },
                    width: 220.,
                    height: 110.,
                },
            }
        }
        Action::AddScene {
            title,
            path,
            parent,
        } => {
            if !["main", "alternative"].contains(&path.as_str()) {
                return Err("invalid_path".into());
            }
            let parent = parent.ok_or("invalid_parent")?;
            let document = host.engine.snapshot().map_err(|e| e.code)?;
            let compiled = domain::compile(&document, &path)?;
            let mut node = host
                .registry
                .definition(domain::SCENE)
                .unwrap()
                .instantiate();
            node.properties.insert(
                "canonical".into(),
                domain::canonical("", Id::new_v4(), Id::new_v4()),
            );
            node.properties.insert("title".into(), json!(title));
            node.properties.insert("path".into(), json!(path));
            {
                if document
                    .graph()
                    .nodes()
                    .get(&parent)
                    .is_none_or(|n| n.type_id != domain::SEQUENCE)
                {
                    return Err("invalid_parent".into());
                }
                node.properties
                    .insert("parent".into(), json!(parent.to_string()));
            }
            node.properties
                .insert("order".into(), json!(compiled.len()));
            let outline_order = document
                .graph()
                .nodes()
                .values()
                .filter(|n| {
                    n.type_id == domain::SCENE
                        && n.properties.get("parent").and_then(Value::as_str)
                            == Some(parent.to_string().as_str())
                })
                .map(|n| {
                    n.properties
                        .get("outlineOrder")
                        .and_then(Value::as_u64)
                        .unwrap_or(n.properties["order"].as_u64().unwrap_or(0))
                })
                .max()
                .map_or(0, |n| n + 1);
            node.properties
                .insert("outlineOrder".into(), json!(outline_order));
            let id = node.id;
            let mut commands = vec![Command::AddNode {
                node,
                rect: Rect {
                    x: 40. + compiled.len() as f32 * 260.,
                    y: if path == "main" { 40. } else { 200. },
                    width: 220.,
                    height: 110.,
                },
            }];
            if let Some(last) = compiled.last() {
                commands.push(Command::Connect {
                    edge: Edge {
                        id: Id::new_v4(),
                        from: Endpoint {
                            node: last.0,
                            port: "next".into(),
                        },
                        to: Endpoint {
                            node: id,
                            port: "previous".into(),
                        },
                    },
                });
            }
            Command::Batch { commands }
        }
        Action::AddRelationship {
            from,
            to,
            title,
            relation,
            mutual,
        } => {
            if from == to {
                return Err("invalid_relationship".into());
            }
            let document = host.engine.snapshot().map_err(|e| e.code)?;
            for id in [from, to] {
                if document
                    .graph()
                    .nodes()
                    .get(&id)
                    .is_none_or(|n| n.type_id != domain::CHARACTER)
                {
                    return Err("invalid_relationship".into());
                }
            }
            let count = document
                .graph()
                .nodes()
                .values()
                .filter(|n| n.type_id == domain::RELATION)
                .count();
            domain::relation(
                &host.registry,
                from,
                to,
                &title,
                &relation,
                mutual,
                Rect {
                    x: 400.,
                    y: 400. + count as f32 * 150.,
                    width: 250.,
                    height: 110.,
                },
            )
        }
        Action::Property { id, key, value } => {
            if !["title", "notes", "role", "kind", "mutual", "parent"].contains(&key.as_str()) {
                return Err("invalid_property".into());
            }
            let doc = host.engine.snapshot().map_err(|e| e.code)?;
            let node = doc.graph().nodes().get(&id).ok_or("missing_node")?;
            if [domain::BLOCK, domain::SEQUENCE].contains(&node.type_id.as_str()) && key != "title"
            {
                return Err("invalid_command".into());
            }
            Command::SetProperty {
                id,
                key,
                value: Some(value),
            }
        }
        Action::Paragraphs { id, changes } => {
            if changes.is_empty() || changes.len() > 20000 {
                return Err("invalid_document".into());
            }
            let node = host.engine.inspect("controls", id).map_err(|e| e.code)?;
            if node.type_id != domain::SCENE {
                return Err("invalid_document".into());
            }
            let mut document = node.properties["canonical"].clone();
            let mut commands = Vec::new();
            for change in changes {
                if change.text.len() > domain::MAX_SCENE_TEXT_BYTES {
                    return Err("limit_exceeded".into());
                }
                let mut found = false;
                for (i, block) in document["content"]
                    .as_array_mut()
                    .ok_or("invalid_document")?
                    .iter_mut()
                    .enumerate()
                {
                    if block["type"] == "paragraph" && block["id"] == change.paragraph.to_string() {
                        replace_paragraph_text(block, &change)?;
                        commands.push(Command::SetNestedProperty {
                            id,
                            key: "canonical".into(),
                            pointer: format!("/content/{i}/content"),
                            value: block["content"].clone(),
                        });
                        found = true;
                        break;
                    }
                    if block["type"] == "table" {
                        for (j, cell) in block["content"][0]["content"]
                            .as_array_mut()
                            .ok_or("invalid_document")?
                            .iter_mut()
                            .enumerate()
                        {
                            if cell["content"][0]["id"] == change.paragraph.to_string() {
                                replace_paragraph_text(&mut cell["content"][0], &change)?;
                                commands.push(Command::SetNestedProperty {
                                    id,
                                    key: "canonical".into(),
                                    pointer: format!(
                                        "/content/{i}/content/0/content/{j}/content/0/content"
                                    ),
                                    value: cell["content"][0]["content"].clone(),
                                });
                                found = true;
                                break;
                            }
                        }
                    }
                    if found {
                        break;
                    }
                }
                if !found {
                    return Err("missing_node".into());
                }
            }
            domain::text(&document)?;
            Command::Batch { commands }
        }
        Action::Canonical { id, document } => {
            let node = host.engine.inspect("controls", id).map_err(|e| e.code)?;
            if node.type_id != domain::SCENE || document["id"] != node.properties["canonical"]["id"]
            {
                return Err("invalid_document".into());
            }
            domain::text(&document)?;
            Command::SetProperty {
                id,
                key: "canonical".into(),
                value: Some(document),
            }
        }
        Action::Text { id, text } => {
            if text.len() > domain::MAX_SCENE_TEXT_BYTES {
                return Err("limit_exceeded".into());
            }
            let node = host.engine.inspect("controls", id).map_err(|e| e.code)?;
            if node.type_id != domain::SCENE {
                return Err("invalid_document".into());
            }
            let doc = &node.properties["canonical"];
            domain::text(doc)?;
            if doc["content"]
                .as_array()
                .is_none_or(|blocks| blocks.len() != 1 || blocks[0]["type"] != "paragraph")
            {
                return Err("unsupported_document".into());
            }
            let document_id = Id::parse_str(doc["id"].as_str().ok_or("invalid_document")?)
                .map_err(|_| "invalid_document")?;
            let paragraph_id =
                Id::parse_str(doc["content"][0]["id"].as_str().ok_or("invalid_document")?)
                    .map_err(|_| "invalid_document")?;
            Command::SetProperty {
                id,
                key: "canonical".into(),
                value: Some(domain::canonical(&text, document_id, paragraph_id)),
            }
        }
        Action::Remove { id } => {
            let document = host.engine.snapshot().map_err(|e| e.code)?;
            if document.graph().nodes().values().any(|node| {
                node.properties.get("parent").and_then(Value::as_str)
                    == Some(id.to_string().as_str())
            }) {
                return Err("container_not_empty".into());
            }
            let mut commands = Vec::new();
            if document
                .graph()
                .nodes()
                .get(&id)
                .is_some_and(|n| n.type_id == domain::SCENE)
            {
                let mut orders = std::collections::BTreeMap::new();
                let mut links = std::collections::BTreeSet::new();
                for path in ["main", "alternative"] {
                    let route = domain::compile(&document, path)?
                        .into_iter()
                        .filter(|n| n.0 != id)
                        .collect::<Vec<_>>();
                    for (order, node) in route.iter().enumerate() {
                        if orders
                            .insert(node.0, order)
                            .is_some_and(|other| other != order)
                        {
                            return Err("incompatible_paths".into());
                        }
                        if order > 0 {
                            links.insert((route[order - 1].0, node.0));
                        }
                    }
                }
                for (node, order) in orders {
                    commands.push(Command::SetProperty {
                        id: node,
                        key: "order".into(),
                        value: Some(json!(order)),
                    });
                }
                for (from, to) in links {
                    if !document
                        .graph()
                        .edges()
                        .values()
                        .any(|e| e.from.node == from && e.to.node == to && e.from.port == "next")
                    {
                        commands.push(Command::Connect {
                            edge: Edge {
                                id: Id::new_v4(),
                                from: Endpoint {
                                    node: from,
                                    port: "next".into(),
                                },
                                to: Endpoint {
                                    node: to,
                                    port: "previous".into(),
                                },
                            },
                        });
                    }
                }
            }
            // A relationship has two required endpoints; remove incident relation nodes together.
            if document
                .graph()
                .nodes()
                .get(&id)
                .is_some_and(|n| n.type_id == domain::CHARACTER)
            {
                let ids: std::collections::BTreeSet<_> = document
                    .graph()
                    .edges()
                    .values()
                    .filter(|e| e.from.node == id)
                    .map(|e| e.to.node)
                    .collect();
                for relation in ids {
                    commands.push(Command::RemoveNode { id: relation });
                }
            }
            commands.push(Command::RemoveNode { id });
            Command::Batch { commands }
        }
        Action::Undo => {
            return Ok(Request::Undo {
                expected_revision: revision,
            });
        }
        Action::Redo => {
            return Ok(Request::Redo {
                expected_revision: revision,
            });
        }
    };
    Ok(Request::Apply {
        expected_revision: revision,
        command,
    })
}
#[tauri::command]
async fn edit(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    expected_revision: u64,
    action: Action,
) -> std::result::Result<Value, String> {
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        edit_blocking(window, host, expected_revision, action)
    })
    .await
    .map_err(|_| "state_unavailable".to_string())?
}
fn edit_blocking(
    window: tauri::WebviewWindow,
    host: Host,
    expected_revision: u64,
    action: Action,
) -> std::result::Result<Value, String> {
    allowed(&window)?;
    let _lock = host.gate.lock().map_err(|_| "state_unavailable")?;
    let revision = host
        .engine
        .dispatch("controls", Request::Summary)
        .map_err(|e| e.code)?
        .revision;
    if revision != expected_revision {
        return Err("revision_conflict".into());
    }
    let request = build_command(&host, action, expected_revision)?;
    host.engine
        .dispatch(window.label(), request)
        .map_err(|e| e.code)?;
    let mut result = projection(&host.engine)?;
    let saved = save(&host.path, &host.engine.snapshot().map_err(|e| e.code)?);
    result["saved"] = json!(saved.is_ok());
    drop(_lock);
    window
        .app_handle()
        .emit("story://changed", &result)
        .map_err(|_| "event_error")?;
    window
        .app_handle()
        .emit("unge://changed", json!({}))
        .map_err(|_| "event_error")?;
    if saved.is_err() {
        return Err("save_failed".into());
    }
    Ok(result)
}
#[tauri::command]
fn reading(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    path: String,
) -> std::result::Result<Value, String> {
    allowed(&window)?;
    let doc = host.engine.snapshot().map_err(|e| e.code)?;
    Ok(json!(domain::compile(&doc, &path)?))
}
#[tauri::command]
fn backup(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
) -> std::result::Result<String, String> {
    allowed(&window)?;
    let _lock = host.gate.lock().map_err(|_| "state_unavailable")?;
    let path = host
        .path
        .parent()
        .unwrap()
        .join(format!("backup-{}.story.json", Id::new_v4()));
    save(&path, &host.engine.snapshot().map_err(|e| e.code)?)?;
    Ok(path.to_string_lossy().into())
}
#[tauri::command]
fn panel(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    floating: bool,
) -> std::result::Result<(), String> {
    allowed(&window)?;
    let app = window.app_handle();
    if floating {
        if let Some(editor) = app.get_webview_window("editor") {
            editor.set_focus().map_err(|_| "panel_failed")?;
        } else {
            host.engine
                .register_view(
                    "editor",
                    Viewport {
                        origin: [0., 0.],
                        zoom: 1.,
                        size: [560., 760.],
                    },
                )
                .map_err(|e| e.code)?;
            tauri::WebviewWindowBuilder::new(
                app,
                "editor",
                tauri::WebviewUrl::App("index.html?panel=editor".into()),
            )
            .title("Story Graph · Editor")
            .inner_size(560., 760.)
            .min_inner_size(320., 480.)
            .build()
            .map_err(|_| "panel_failed")?;
        }
    } else if let Some(editor) = app.get_webview_window("editor") {
        // The close listener saves pending edits before destroying the window.
        // Publish the docked state only from WindowEvent::Destroyed.
        editor.close().map_err(|_| "panel_failed")?;
        return Ok(());
    }
    app.emit("story://panel", floating)
        .map_err(|_| "event_error")?;
    Ok(())
}
#[tauri::command]
fn canvas(window: tauri::WebviewWindow) -> std::result::Result<(), String> {
    allowed(&window)?;
    if let Some(canvas) = window.app_handle().get_window("canvas") {
        canvas
            .show()
            .and_then(|_| canvas.set_focus())
            .map_err(|_| "panel_failed")?;
    }
    Ok(())
}
#[tauri::command]
fn new_workspace(
    window: tauri::WebviewWindow,
    host: tauri::State<Host>,
    store: tauri::State<preferences::Store>,
) -> std::result::Result<(), String> {
    allowed(&window)?;
    let mut settings = store.value.lock().map_err(|_| "state_unavailable")?.clone();
    settings.left_panel_open = true;
    settings.right_panel_open = false;
    let directory = window
        .app_handle()
        .path()
        .app_data_dir()
        .map_err(|_| "new_workspace_failed")?
        .join("workspaces")
        .join(Id::new_v4().to_string());
    std::fs::create_dir_all(&directory).map_err(|_| "new_workspace_failed")?;
    let doc = domain::blank_document(&host.registry, &settings.language)
        .map_err(|_| "new_workspace_failed")?;
    save(&directory.join("workspace.story.json"), &doc)?;
    preferences::Store::load(directory.join("preferences.json"))?.save(settings)?;
    // Each document host owns its Rust Engine, renderer and save path. UI windows
    // remain projections; no document or undo history is shared between projects.
    let executable = std::env::current_exe().map_err(|_| "new_workspace_failed")?;
    // LaunchServices registers each macOS application instance and brings its
    // new document window forward, including when the parent was Finder-launched.
    #[cfg(target_os = "macos")]
    if let Some(bundle) = executable
        .parent()
        .and_then(|p| p.parent())
        .and_then(|p| p.parent())
        .filter(|bundle| bundle.extension().is_some_and(|ext| ext == "app"))
    {
        let status = std::process::Command::new("/usr/bin/open")
            .args(["-n", "-a"])
            .arg(bundle)
            .arg("--env")
            .arg(format!("STORY_GRAPH_DATA_DIR={}", directory.display()))
            .args(["--env", "STORY_GRAPH_NEW_WORKSPACE=1"])
            .status()
            .map_err(|_| "new_workspace_failed")?;
        return if status.success() {
            Ok(())
        } else {
            Err("new_workspace_failed".into())
        };
    }
    let mut child = std::process::Command::new(executable)
        .env("STORY_GRAPH_DATA_DIR", directory)
        .env("STORY_GRAPH_NEW_WORKSPACE", "1")
        .spawn()
        .map_err(|_| "new_workspace_failed")?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}
fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            workspace,
            new_workspace,
            selected,
            choose,
            locale,
            edit,
            reading,
            backup,
            panel,
            canvas,
            preferences::get_preferences,
            preferences::set_preferences,
            chatgpt::chatgpt_status,
            chatgpt::chatgpt_sign_in,
            chatgpt::chatgpt_cancel,
            chatgpt::chatgpt_sign_out,
            ai::ai_models,
            ai::ai_prepare,
            ai::ai_status,
            ai::ai_generate,
            ai::ai_cancel,
            ai::ai_append
        ])
        .setup(|app| {
            app.manage(ai::Store::default());
            let registry = domain::registry();
            let auth_directory = std::env::var_os("STORY_GRAPH_AUTH_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?.join("chatgpt"));
            app.manage(
                chatgpt::Store::load(auth_directory.clone())
                    .unwrap_or_else(|_| chatgpt::Store::unavailable(auth_directory)),
            );
            let directory = std::env::var_os("STORY_GRAPH_DATA_DIR")
                .map(PathBuf::from)
                .unwrap_or(app.path().app_data_dir()?);
            std::fs::create_dir_all(&directory)?;
            app.manage(
                preferences::Store::load(directory.join("preferences.json"))
                    .map_err(std::io::Error::other)?,
            );
            let path = directory.join("workspace.story.json");
            // A corrupt save is reported; never silently replace an author's work with sample content.
            let document = if path.exists() {
                load(&path).map_err(std::io::Error::other)?
            } else {
                domain::initial_document(&registry)
            };
            let document =
                domain::migrate_hierarchy(document, &registry).map_err(std::io::Error::other)?;
            let editor = Editor::new(document, 256)?
                .with_validator(Arc::new(domain::Validator(registry.clone())))?;
            save(&path, editor.document()).map_err(std::io::Error::other)?;
            let engine = Engine::from_editor(editor);
            engine
                .set_labels(labels(&registry))
                .map_err(|e| e.message)?;
            engine
                .register_view(
                    "controls",
                    Viewport {
                        origin: [-(ICON_RAIL_WIDTH as f32) / 0.8, 0.],
                        zoom: 0.8,
                        size: [1100., 800.],
                    },
                )
                .map_err(|e| e.message)?;
            engine
                .dispatch("controls", Request::SetLocale { locale: Locale::Ja })
                .map_err(|e| e.message)?;
            let first = engine
                .snapshot()
                .map_err(|e| e.message)?
                .graph()
                .nodes()
                .values()
                .filter(|n| n.type_id == domain::SCENE)
                .min_by_key(|n| n.properties["order"].as_u64().unwrap_or(0))
                .map(|n| n.id);
            if let Some(id) = first {
                engine
                    .dispatch("controls", Request::Select { ids: [id].into() })
                    .map_err(|e| e.message)?;
            }
            let canvas = tauri::WindowBuilder::new(app, "canvas")
                .title("Story Graph · UNGE / wgpu")
                .visible(false)
                .inner_size(1100., 800.)
                .build()?;
            let size = canvas.inner_size()?;
            canvas.add_child(
                tauri::webview::WebviewBuilder::new(
                    "graph-rail",
                    tauri::WebviewUrl::App("graph-rail.html".into()),
                ),
                tauri::LogicalPosition::new(0., 0.),
                tauri::LogicalSize::new(
                    ICON_RAIL_WIDTH,
                    size.height as f64 / canvas.scale_factor()?,
                ),
            )?;
            let mut renderer = pollster::block_on(SurfaceRenderer::new(
                Arc::new(canvas.clone()),
                [size.width, size.height],
            ))?;
            renderer.set_left_ui_width(ICON_RAIL_WIDTH as f32);
            engine
                .attach_renderer("controls", renderer)
                .map_err(|e| e.message)?;
            app.wry_plugin(input::InputBridge {
                app: app.handle().clone(),
                engine: engine.clone(),
            });
            app.manage(engine.clone());
            app.manage(Host {
                engine,
                registry,
                path,
                gate: Arc::new(Mutex::new(())),
            });
            let handle = app.handle().clone();
            app.listen("unge://changed", move |_| {
                let main = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    redraw(&main);
                    let host = main.state::<Host>();
                    if let Ok(_guard) = host.gate.lock()
                        && let Ok(doc) = host.engine.snapshot()
                    {
                        let error = save(&host.path, &doc).err();
                        if error.is_some() {
                            let _ = main.emit("story://save-error", "save_failed");
                        }
                        if let Ok(mut result) = projection(&host.engine) {
                            result["saved"] = json!(error.is_none());
                            let _ = main.emit("story://changed", result);
                        }
                    }
                });
            });
            let handle = app.handle().clone();
            app.listen("story://view-changed", move |_| {
                let main = handle.clone();
                let _ = handle.run_on_main_thread(move || {
                    let host = main.state::<Host>();
                    if let Ok(result) = projection(&host.engine) {
                        let _ = main.emit("story://changed", result);
                    }
                });
            });
            redraw(app.handle());
            if let Some(controls) = app.get_webview_window("controls") {
                controls.show()?;
                controls.set_focus()?;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "canvas"
                && matches!(
                    event,
                    tauri::WindowEvent::Resized(_)
                        | tauri::WindowEvent::ScaleFactorChanged { .. }
                        | tauri::WindowEvent::Focused(true)
                )
            {
                if let (Some(rail), Ok(size), Ok(scale)) = (
                    window.app_handle().get_webview("graph-rail"),
                    window.inner_size(),
                    window.scale_factor(),
                ) {
                    let _ = rail.set_size(tauri::LogicalSize::new(
                        ICON_RAIL_WIDTH,
                        size.height as f64 / scale,
                    ));
                }
                redraw(window.app_handle());
            }
            if window.label() == "canvas"
                && let tauri::WindowEvent::CloseRequested { api, .. } = event
            {
                api.prevent_close();
                let _ = window.hide();
            }
            if window.label() == "editor" && matches!(event, tauri::WindowEvent::Destroyed) {
                let _ = window.state::<Engine>().remove_view("editor");
                let _ = window.app_handle().emit("story://panel", false);
            }
            if window.label() == "controls" && matches!(event, tauri::WindowEvent::Destroyed) {
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("Story Graph startup failed; saved workspace was not overwritten");
}
#[cfg(test)]
mod persistence_tests {
    use super::*;
    #[test]
    fn million_character_patch_preserves_ids_history_and_save() {
        for blocks in [100, 1000] {
            let host = test_host();
            let snapshot = host.engine.snapshot().unwrap();
            let node = snapshot
                .graph()
                .nodes()
                .values()
                .find(|n| n.type_id == domain::SCENE)
                .unwrap();
            let id = node.id;
            let mut document = node.properties["canonical"].clone();
            let template = document["content"][0].clone();
            document["content"]=json!((0..blocks).map(|_|{
            let mut p=template.clone();p["id"]=json!(Id::new_v4());p["content"]=json!([{"type":"text","text":"雨".repeat(1000),"marks":[],"metadata":{},"extensions":{}}]);p
        }).collect::<Vec<_>>());
            let paragraph = Id::parse_str(document["content"][50]["id"].as_str().unwrap()).unwrap();
            let init = build_command(
                &host,
                Action::Canonical {
                    id,
                    document: document.clone(),
                },
                0,
            )
            .unwrap();
            host.engine.dispatch("controls", init).unwrap();
            let start = std::time::Instant::now();
            let action = build_command(
                &host,
                Action::Paragraphs {
                    id,
                    changes: vec![ParagraphChange {
                        paragraph,
                        text: "🌕".into(),
                        start: Some(0),
                        end: Some(1),
                    }],
                },
                1,
            )
            .unwrap();
            host.engine.dispatch("controls", action).unwrap();
            let patch_ms = start.elapsed().as_secs_f64() * 1000.;
            let patched = host.engine.snapshot().unwrap();
            let canonical = &patched.graph().nodes()[&id].properties["canonical"];
            assert_eq!(canonical["id"], document["id"]);
            assert_eq!(
                canonical["content"][50]["id"],
                document["content"][50]["id"]
            );
            assert!(
                canonical["content"][50]["content"][0]["text"]
                    .as_str()
                    .unwrap()
                    .starts_with("🌕")
            );
            let save_start = std::time::Instant::now();
            save(&host.path, &patched).unwrap();
            let save_ms = save_start.elapsed().as_secs_f64() * 1000.;
            assert_eq!(
                load(&host.path).unwrap().graph().nodes()[&id].properties["canonical"],
                *canonical
            );
            println!(
                "{}-character Rust: patch={patch_ms:.2}ms save={save_ms:.2}ms bytes={}",
                blocks * 1000,
                std::fs::metadata(&host.path).unwrap().len()
            );
            if let Some(path) =
                std::env::var_os("STORY_GRAPH_BENCH_FIXTURE").filter(|_| blocks == 1000)
            {
                let path = PathBuf::from(path);
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                save(&path, &patched).unwrap();
            }
            host.engine
                .dispatch(
                    "controls",
                    Request::Undo {
                        expected_revision: 2,
                    },
                )
                .unwrap();
            assert_eq!(
                host.engine.inspect("controls", id).unwrap().properties["canonical"],
                document
            );
            let mut paragraph_node =
                domain::canonical("a😀z", Id::new_v4(), Id::new_v4())["content"][0].clone();
            assert!(
                replace_paragraph_text(
                    &mut paragraph_node,
                    &ParagraphChange {
                        paragraph,
                        text: "x".into(),
                        start: Some(2),
                        end: Some(3)
                    }
                )
                .is_err()
            );
            replace_paragraph_text(
                &mut paragraph_node,
                &ParagraphChange {
                    paragraph,
                    text: "😃".into(),
                    start: Some(1),
                    end: Some(3),
                },
            )
            .unwrap();
            assert_eq!(paragraph_node["content"][0]["text"], "a😃z");
            std::fs::remove_file(&host.path).unwrap();
        }
    }
    #[test]
    fn dialogue_sheet_persists_with_text_and_undo() {
        let host = test_host();
        let original = host.engine.snapshot().unwrap();
        let node = original
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap();
        let id = node.id;
        let before = node.properties["canonical"].clone();
        let mut document = before.clone();
        let cells= ["灯","こんにちは。"].map(|text| json!({"id":Id::new_v4(),"schemaVersion":1,"type":"table_cell","attrs":{"colspan":1,"rowspan":1,"header":false},"content":[domain::canonical(text,Id::new_v4(),Id::new_v4())["content"][0].clone()]}));
        document["content"].as_array_mut().unwrap().push(json!({"id":Id::new_v4(),"schemaVersion":1,"type":"table","content":[{"id":Id::new_v4(),"schemaVersion":1,"type":"table_row","content":cells}]}));
        let request = build_command(
            &host,
            Action::Canonical {
                id,
                document: document.clone(),
            },
            0,
        )
        .unwrap();
        host.engine.dispatch("controls", request).unwrap();
        save(&host.path, &host.engine.snapshot().unwrap()).unwrap();
        assert_eq!(
            load(&host.path).unwrap().graph().nodes()[&id].properties["canonical"],
            document
        );
        assert!(
            domain::text(&document)
                .unwrap()
                .contains("灯\tこんにちは。")
        );
        assert!(
            build_command(
                &host,
                Action::Text {
                    id,
                    text: "replacement".into()
                },
                1
            )
            .is_err()
        );
        host.engine
            .dispatch(
                "controls",
                Request::Undo {
                    expected_revision: 1,
                },
            )
            .unwrap();
        assert_eq!(
            host.engine.inspect("controls", id).unwrap().properties["canonical"],
            before
        );
        document["content"][1]["content"][0]["content"]
            .as_array_mut()
            .unwrap()
            .pop();
        assert!(domain::text(&document).is_err());
        std::fs::remove_file(&host.path).unwrap();
    }
    #[test]
    fn project_title_persists_and_undoes() {
        let host = test_host();
        let action = build_command(
            &host,
            Action::ProjectTitle {
                title: "星の旅 / Journey / 旅程".into(),
            },
            0,
        )
        .unwrap();
        host.engine.dispatch("controls", action).unwrap();
        save(&host.path, &host.engine.snapshot().unwrap()).unwrap();
        assert_eq!(load(&host.path).unwrap().title, "星の旅 / Journey / 旅程");
        host.engine
            .dispatch(
                "controls",
                Request::Undo {
                    expected_revision: 1,
                },
            )
            .unwrap();
        assert!(host.engine.snapshot().unwrap().title.is_empty());
        assert!(
            build_command(
                &host,
                Action::ProjectTitle {
                    title: "x".repeat(201)
                },
                2
            )
            .is_err()
        );
        std::fs::remove_file(&host.path).unwrap();
    }
    fn test_host() -> Host {
        let registry = domain::registry();
        let editor = Editor::new(domain::initial_document(&registry), 256)
            .unwrap()
            .with_validator(Arc::new(domain::Validator(registry.clone())))
            .unwrap();
        let engine = Engine::from_editor(editor);
        for label in ["controls", "editor"] {
            engine
                .register_view(
                    label,
                    Viewport {
                        origin: [0., 0.],
                        zoom: 1.,
                        size: [800., 600.],
                    },
                )
                .unwrap();
        }
        Host {
            engine,
            registry,
            path: std::env::temp_dir().join(format!("story-host-{}.json", Id::new_v4())),
            gate: Arc::new(Mutex::new(())),
        }
    }
    #[test]
    fn text_edit_identity_restart_and_stale_window_rejection() {
        let host = test_host();
        let document = host.engine.snapshot().unwrap();
        let id = document
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap()
            .id;
        let before = host.engine.inspect("controls", id).unwrap().properties["canonical"].clone();
        let action = build_command(
            &host,
            Action::Text {
                id,
                text: "か\u{3099} / が\n復旧".into(),
            },
            0,
        )
        .unwrap();
        host.engine.dispatch("editor", action).unwrap();
        assert!(
            host.engine
                .dispatch(
                    "controls",
                    Request::Undo {
                        expected_revision: 0
                    }
                )
                .is_err()
        );
        save(&host.path, &host.engine.snapshot().unwrap()).unwrap();
        let restored = load(&host.path).unwrap();
        let after = &restored.graph().nodes()[&id].properties["canonical"];
        assert_eq!(after["id"], before["id"]);
        assert_eq!(after["content"][0]["id"], before["content"][0]["id"]);
        assert_eq!(domain::text(after).unwrap(), "か\u{3099} / が\n復旧");
        host.engine
            .dispatch(
                "controls",
                Request::Undo {
                    expected_revision: 1,
                },
            )
            .unwrap();
        assert_eq!(
            host.engine.inspect("controls", id).unwrap().properties["canonical"],
            before
        );
        std::fs::remove_file(&host.path).unwrap();
    }
    #[test]
    fn character_deletion_removes_relations_and_undo_restores_them() {
        let host = test_host();
        let document = host.engine.snapshot().unwrap();
        let id = document
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::CHARACTER)
            .unwrap()
            .id;
        host.engine
            .dispatch(
                "controls",
                build_command(&host, Action::Remove { id }, 0).unwrap(),
            )
            .unwrap();
        let deleted = host.engine.snapshot().unwrap();
        assert!(!deleted.graph().edges().values().any(|e| e.from.node == id));
        host.engine
            .dispatch(
                "editor",
                Request::Undo {
                    expected_revision: 1,
                },
            )
            .unwrap();
        assert_eq!(
            host.engine.snapshot().unwrap().to_json().unwrap(),
            document.to_json().unwrap()
        );
    }
    #[test]
    fn new_work_has_only_three_nested_unconfigured_nodes_and_is_independent() {
        let registry = domain::registry();
        let first = domain::blank_document(&registry, "ja").unwrap();
        let second = domain::blank_document(&registry, "ja").unwrap();
        domain::Validator(registry).validate(&first).unwrap();
        assert_eq!(first.graph().nodes().len(), 3);
        assert!(first.graph().edges().is_empty());
        let block = first
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::BLOCK)
            .unwrap();
        let sequence = first
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SEQUENCE)
            .unwrap();
        let scene = first
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap();
        assert_eq!(sequence.properties["parent"], json!(block.id.to_string()));
        assert_eq!(scene.properties["parent"], json!(sequence.id.to_string()));
        assert_eq!(domain::text(&scene.properties["canonical"]).unwrap(), "");
        assert!(
            first
                .graph()
                .nodes()
                .values()
                .all(|n| n.properties["notes"] == "")
        );
        assert!(
            first
                .graph()
                .nodes()
                .keys()
                .all(|id| !second.graph().nodes().contains_key(id))
        );
        let other = second
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap();
        assert_ne!(
            scene.properties["canonical"]["id"],
            other.properties["canonical"]["id"]
        );
    }
    #[test]
    fn legacy_scenes_migrate_without_changing_canonical_identity() {
        let registry = domain::registry();
        let mut editor = Editor::new(domain::initial_document(&registry), 256).unwrap();
        let scene = editor
            .document()
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap();
        let id = scene.id;
        let canonical = scene.properties["canonical"].clone();
        editor
            .execute(Command::SetProperty {
                id,
                key: "parent".into(),
                value: None,
            })
            .unwrap();
        assert!(
            domain::Validator(registry.clone())
                .validate(editor.document())
                .is_err()
        );
        let migrated = domain::migrate_hierarchy(editor.document().clone(), &registry).unwrap();
        domain::Validator(registry).validate(&migrated).unwrap();
        assert_eq!(
            migrated.graph().nodes()[&id].properties["canonical"],
            canonical
        );
        let parent = Id::parse_str(
            migrated.graph().nodes()[&id].properties["parent"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
        assert_eq!(migrated.graph().nodes()[&parent].type_id, domain::SEQUENCE);
    }
    #[test]
    fn outline_moves_reject_invalid_levels_and_preserve_route_text() {
        let host = test_host();
        let doc = host.engine.snapshot().unwrap();
        let block = doc
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::BLOCK)
            .unwrap()
            .id;
        let sequence = doc
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SEQUENCE)
            .unwrap()
            .id;
        let scenes: Vec<_> = doc
            .graph()
            .nodes()
            .values()
            .filter(|n| n.type_id == domain::SCENE)
            .map(|n| n.id)
            .collect();
        for (from, to) in [
            (block, sequence),
            (block, scenes[0]),
            (sequence, scenes[0]),
            (scenes[0], block),
        ] {
            assert!(hierarchy_move(&doc, from, Some(to), "inside").is_err());
        }
        assert!(hierarchy_move(&doc, scenes[0], None, "root").is_err());
        assert!(
            build_command(
                &host,
                Action::Property {
                    id: block,
                    key: "notes".into(),
                    value: json!("no body in folders")
                },
                0
            )
            .is_err()
        );
        let command = hierarchy_move(&doc, scenes[0], Some(scenes[1]), "before").unwrap();
        host.engine
            .dispatch(
                "controls",
                Request::Apply {
                    expected_revision: 0,
                    command,
                },
            )
            .unwrap();
        let moved = host.engine.snapshot().unwrap();
        assert!(
            moved.graph().nodes()[&scenes[0]].properties["outlineOrder"]
                .as_u64()
                .unwrap()
                < moved.graph().nodes()[&scenes[1]].properties["outlineOrder"]
                    .as_u64()
                    .unwrap()
        );
        assert_eq!(
            domain::compile(&moved, "main").unwrap(),
            domain::compile(&doc, "main").unwrap()
        );
        host.engine
            .dispatch(
                "controls",
                Request::Undo {
                    expected_revision: 1,
                },
            )
            .unwrap();
        assert_eq!(
            host.engine.snapshot().unwrap().to_json().unwrap(),
            doc.to_json().unwrap()
        );
    }
    #[test]
    fn hierarchy_validates_levels_preserves_text_and_undoes_reparenting() {
        let host = test_host();
        let initial = host.engine.snapshot().unwrap();
        let scene = initial
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::SCENE)
            .unwrap();
        let scene_id = scene.id;
        let canonical = scene.properties["canonical"].clone();
        let old_parent = scene.properties["parent"].clone();
        let block = initial
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == domain::BLOCK)
            .unwrap()
            .id;
        assert!(build_command(&host, Action::Remove { id: block }, 0).is_err());
        let bad = build_command(
            &host,
            Action::Property {
                id: scene_id,
                key: "parent".into(),
                value: json!(block.to_string()),
            },
            0,
        )
        .unwrap();
        assert!(host.engine.dispatch("controls", bad).is_err());
        assert_eq!(
            host.engine.snapshot().unwrap().to_json().unwrap(),
            initial.to_json().unwrap()
        );
        host.engine
            .dispatch(
                "controls",
                build_command(
                    &host,
                    Action::AddContainer {
                        title: "第二の枠".into(),
                        level: "sequence".into(),
                        parent: Some(block),
                    },
                    0,
                )
                .unwrap(),
            )
            .unwrap();
        let new_parent = host
            .engine
            .snapshot()
            .unwrap()
            .graph()
            .nodes()
            .values()
            .find(|n| n.properties["title"] == "第二の枠")
            .unwrap()
            .id;
        host.engine
            .dispatch(
                "controls",
                build_command(
                    &host,
                    Action::MoveOutline {
                        id: scene_id,
                        target: Some(new_parent),
                        position: "inside".into(),
                    },
                    1,
                )
                .unwrap(),
            )
            .unwrap();
        let moved = host.engine.snapshot().unwrap();
        assert_eq!(
            moved.graph().nodes()[&scene_id].properties["canonical"],
            canonical
        );
        save(&host.path, &moved).unwrap();
        let restored = load(&host.path).unwrap();
        domain::Validator(host.registry.clone())
            .validate(&restored)
            .unwrap();
        assert_eq!(
            restored.graph().nodes()[&scene_id].properties["parent"],
            json!(new_parent.to_string())
        );
        assert!(build_command(&host, Action::Remove { id: new_parent }, 2).is_err());
        host.engine
            .dispatch(
                "controls",
                Request::Undo {
                    expected_revision: 2,
                },
            )
            .unwrap();
        assert_eq!(
            host.engine.snapshot().unwrap().graph().nodes()[&scene_id].properties["parent"],
            old_parent
        );
        std::fs::remove_file(&host.path).unwrap();
    }
    #[test]
    fn scene_append_and_shared_scene_delete_keep_routes_connected() {
        let host = test_host();
        host.engine
            .dispatch(
                "controls",
                build_command(
                    &host,
                    Action::AddScene {
                        title: "追加".into(),
                        path: "main".into(),
                        parent: Some(
                            host.engine
                                .snapshot()
                                .unwrap()
                                .graph()
                                .nodes()
                                .values()
                                .find(|n| n.type_id == domain::SEQUENCE)
                                .unwrap()
                                .id,
                        ),
                    },
                    0,
                )
                .unwrap(),
            )
            .unwrap();
        assert_eq!(
            domain::compile(&host.engine.snapshot().unwrap(), "main")
                .unwrap()
                .len(),
            5
        );
        let doc = host.engine.snapshot().unwrap();
        let first = domain::compile(&doc, "main").unwrap()[0].0;
        host.engine
            .dispatch(
                "controls",
                build_command(&host, Action::Remove { id: first }, 1).unwrap(),
            )
            .unwrap();
        let doc = host.engine.snapshot().unwrap();
        assert_eq!(domain::compile(&doc, "main").unwrap().len(), 4);
        assert_eq!(domain::compile(&doc, "alternative").unwrap().len(), 3);
    }
    #[test]
    fn complete_snapshot_roundtrip_and_future_version_rejection() {
        let path = std::env::temp_dir().join(format!("story-{}.json", Id::new_v4()));
        let doc = domain::initial_document(&domain::registry());
        save(&path, &doc).unwrap();
        assert_eq!(
            load(&path).unwrap().to_json().unwrap(),
            doc.to_json().unwrap()
        );
        std::fs::write(
            &path,
            br#"{"format":"komyaku-story-workspace","version":2,"document":{}}"#,
        )
        .unwrap();
        assert!(load(&path).is_err());
        std::fs::remove_file(path).unwrap();
    }
}
