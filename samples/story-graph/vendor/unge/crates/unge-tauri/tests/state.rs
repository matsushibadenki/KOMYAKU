use unge_core::*;
use unge_tauri::*;
fn engine() -> Engine {
    let engine = Engine::new(Document::default()).unwrap();
    for label in ["main", "second"] {
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
    engine
}
fn command() -> Command {
    Command::AddNode {
        node: Node {
            id: Id::new_v4(),
            type_id: "test".into(),
            inputs: vec![],
            outputs: vec![],
            properties: Properties::new(),
        },
        rect: Rect::default(),
    }
}
#[test]
fn all_windows_share_document_and_reject_stale_edits() {
    let engine = engine();
    engine
        .dispatch(
            "main",
            Request::Apply {
                expected_revision: 0,
                command: command(),
            },
        )
        .unwrap();
    let summary = engine.dispatch("second", Request::Summary).unwrap();
    assert_eq!(summary.nodes, 1);
    let error = engine
        .dispatch(
            "second",
            Request::Apply {
                expected_revision: 0,
                command: command(),
            },
        )
        .unwrap_err();
    assert_eq!(error.code, "revision_conflict");
    assert_eq!(engine.dispatch("main", Request::Summary).unwrap().nodes, 1);
    engine
        .dispatch(
            "second",
            Request::Undo {
                expected_revision: 1,
            },
        )
        .unwrap();
    assert_eq!(engine.dispatch("main", Request::Summary).unwrap().nodes, 0);
}
#[test]
fn unknown_windows_and_deep_commands_are_rejected() {
    let engine = engine();
    assert_eq!(
        engine
            .dispatch("unknown", Request::Summary)
            .unwrap_err()
            .code,
        "unknown_view"
    );
    let mut cmd = command();
    for _ in 0..20 {
        cmd = Command::Batch {
            commands: vec![cmd],
        };
    }
    assert_eq!(
        engine
            .dispatch(
                "main",
                Request::Apply {
                    expected_revision: 0,
                    command: cmd
                }
            )
            .unwrap_err()
            .code,
        "limit_exceeded"
    );
    assert_eq!(
        engine.dispatch("main", Request::Summary).unwrap().revision,
        0
    );
}
#[test]
fn views_do_not_change_document_revision() {
    let engine = engine();
    engine
        .dispatch(
            "main",
            Request::SetViewport {
                viewport: Viewport {
                    origin: [10., 20.],
                    zoom: 2.,
                    size: [800., 600.],
                },
            },
        )
        .unwrap();
    assert_eq!(
        engine
            .dispatch("second", Request::Summary)
            .unwrap()
            .revision,
        0
    );
    engine.remove_view("main").unwrap();
    assert!(engine.dispatch("main", Request::Summary).is_err());
    assert!(engine.dispatch("second", Request::Summary).is_ok());
}

#[cfg(feature = "acx")]
#[test]
fn ai_and_windows_share_revision_history_and_document() {
    use serde_json::json;
    use std::sync::Arc;
    use unge_acx::{GraphHost, Policy, Provider};
    let engine = engine();
    let before = GraphHost::snapshot(&engine).unwrap();
    let mut provider = Provider::new(
        Arc::new(engine.clone()),
        Arc::new(unge_executor::math_registry()),
        Policy::math_demo(),
    );
    let input = json!({"kind":"edit","document_id":before.document.graph().id,"expected_revision":0,"operations":[{"kind":"create_node","id":Id::new_v4(),"type_id":"math.number","properties":{"value":42},"rect":{"x":0,"y":0,"width":180,"height":90}}]});
    let pf = provider
        .dispatch("preflight", json!({"input":input}))
        .unwrap();
    let bound = json!({"preflightId":pf["preflightId"],"preflightDigest":pf["preflightDigest"]});
    let auth = provider.dispatch("authorize", bound).unwrap();
    let commit=provider.dispatch("commit",json!({"preflightId":pf["preflightId"],"preflightDigest":pf["preflightDigest"],"authorization":auth["authorization"],"input":pf["input"]})).unwrap();
    provider
        .dispatch("execute", json!({"commitId":commit["commitId"]}))
        .unwrap();
    let ui = engine.dispatch("main", Request::Summary).unwrap();
    assert_eq!(ui.nodes, 1);
    assert_eq!(ui.revision, 1);
    engine
        .dispatch(
            "second",
            Request::Undo {
                expected_revision: 1,
            },
        )
        .unwrap();
    assert_eq!(
        provider
            .dispatch("observe", json!({"query":"summary"}))
            .unwrap()["nodes"],
        0
    );
    assert_eq!(provider.dispatch("recover",json!({"commitId":commit["commitId"],"authorization":auth["authorization"],"expectedRevision":1})).unwrap_err().code,"revision_conflict");
}

#[test]
fn configured_validator_is_shared_by_ui_and_ai_without_losing_history_on_failure() {
    let registry = std::sync::Arc::new(unge_executor::math_registry());
    let editor = Editor::new(Document::default(), 16)
        .unwrap()
        .with_validator(registry.clone())
        .unwrap();
    let engine = Engine::from_editor(editor);
    engine
        .register_view(
            "main",
            Viewport {
                origin: [0., 0.],
                zoom: 1.,
                size: [800., 600.],
            },
        )
        .unwrap();
    let node = registry.definition("math.number").unwrap().instantiate();
    let id = node.id;
    engine
        .dispatch(
            "main",
            Request::Apply {
                expected_revision: 0,
                command: Command::AddNode {
                    node,
                    rect: Rect::default(),
                },
            },
        )
        .unwrap();
    let before = engine.snapshot().unwrap();
    let invalid = Command::SetProperty {
        id,
        key: "value".into(),
        value: Some("bad".into()),
    };
    assert_eq!(
        engine
            .dispatch(
                "main",
                Request::Apply {
                    expected_revision: 1,
                    command: invalid.clone()
                }
            )
            .unwrap_err()
            .code,
        "invalid_properties"
    );
    #[cfg(feature = "acx")]
    assert_eq!(
        unge_acx::GraphHost::apply(&engine, before.graph().id, 1, invalid)
            .unwrap_err()
            .code,
        "invalid_properties"
    );
    assert_eq!(engine.snapshot().unwrap(), before);
    assert_eq!(
        engine.dispatch("main", Request::Summary).unwrap().revision,
        1
    );
    engine
        .dispatch(
            "main",
            Request::Undo {
                expected_revision: 1,
            },
        )
        .unwrap();
    assert!(engine.snapshot().unwrap().graph().nodes().is_empty());
    engine
        .dispatch(
            "main",
            Request::Redo {
                expected_revision: 2,
            },
        )
        .unwrap();
    assert_eq!(engine.snapshot().unwrap(), before);
}

#[test]
fn gestures_use_shared_revision_and_commit_once_after_preview() {
    use unge_interaction::{PointerButton, PointerEvent};
    let engine = engine();
    let cmd = command();
    let id = match &cmd {
        Command::AddNode { node, .. } => node.id,
        _ => unreachable!(),
    };
    engine
        .dispatch(
            "main",
            Request::Apply {
                expected_revision: 0,
                command: cmd,
            },
        )
        .unwrap();
    let pointer = |event, revision| {
        engine.dispatch(
            "main",
            Request::Pointer {
                expected_revision: revision,
                event,
            },
        )
    };
    pointer(
        PointerEvent::Down {
            pointer: 0,
            position: [30., 30.],
            button: PointerButton::Primary,
            additive: false,
        },
        1,
    )
    .unwrap();
    pointer(
        PointerEvent::Move {
            pointer: 0,
            position: [100., 100.],
        },
        1,
    )
    .unwrap();
    assert_eq!(engine.snapshot().unwrap().placement()[&id].x, 0.);
    assert!(engine.view_state("main").unwrap().interacting);
    assert!(!engine.view_state("second").unwrap().interacting);
    assert_eq!(
        pointer(
            PointerEvent::Up {
                pointer: 0,
                position: [110., 90.]
            },
            1
        )
        .unwrap()
        .revision,
        2
    );
    assert_eq!(engine.snapshot().unwrap().placement()[&id].x, 80.);
    engine
        .dispatch(
            "second",
            Request::Undo {
                expected_revision: 2,
            },
        )
        .unwrap();
    assert_eq!(engine.snapshot().unwrap().placement()[&id].x, 0.);
    pointer(
        PointerEvent::Down {
            pointer: 0,
            position: [30., 30.],
            button: PointerButton::Primary,
            additive: false,
        },
        3,
    )
    .unwrap();
    engine
        .dispatch(
            "second",
            Request::Apply {
                expected_revision: 3,
                command: Command::MoveNode {
                    id,
                    rect: Rect {
                        x: 400.,
                        ..Rect::default()
                    },
                },
            },
        )
        .unwrap();
    assert_eq!(
        pointer(
            PointerEvent::Up {
                pointer: 0,
                position: [110., 90.]
            },
            3
        )
        .unwrap_err()
        .code,
        "revision_conflict"
    );
    assert_eq!(engine.snapshot().unwrap().placement()[&id].x, 400.);
    assert!(!engine.view_state("main").unwrap().interacting);
}
#[test]
fn viewport_changes_cancel_pending_drag_and_unknown_views_cannot_send_input() {
    use unge_interaction::{PointerButton, PointerEvent};
    let engine = engine();
    engine
        .dispatch(
            "main",
            Request::Apply {
                expected_revision: 0,
                command: command(),
            },
        )
        .unwrap();
    let down = PointerEvent::Down {
        pointer: 0,
        position: [30., 30.],
        button: PointerButton::Primary,
        additive: false,
    };
    assert_eq!(
        engine
            .dispatch(
                "missing",
                Request::Pointer {
                    expected_revision: 1,
                    event: down
                }
            )
            .unwrap_err()
            .code,
        "unknown_view"
    );
    engine
        .dispatch(
            "main",
            Request::Pointer {
                expected_revision: 1,
                event: down,
            },
        )
        .unwrap();
    engine
        .dispatch(
            "main",
            Request::SetViewport {
                viewport: Viewport {
                    origin: [0., 0.],
                    zoom: 2.,
                    size: [800., 600.],
                },
            },
        )
        .unwrap();
    assert!(!engine.view_state("main").unwrap().interacting);
    engine
        .dispatch(
            "main",
            Request::Pointer {
                expected_revision: 1,
                event: PointerEvent::Up {
                    pointer: 0,
                    position: [300., 300.],
                },
            },
        )
        .unwrap();
    assert_eq!(
        engine.dispatch("main", Request::Summary).unwrap().revision,
        1
    );
    assert_eq!(engine.view_state("main").unwrap().viewport.zoom, 2.);
}

#[test]
fn locale_is_per_view_and_does_not_change_document_or_revision() {
    let engine = Engine::new(Document::default()).unwrap();
    engine
        .register_view(
            "en",
            Viewport {
                origin: [0., 0.],
                zoom: 1.,
                size: [800., 600.],
            },
        )
        .unwrap();
    engine
        .register_view(
            "ja",
            Viewport {
                origin: [0., 0.],
                zoom: 1.,
                size: [800., 600.],
            },
        )
        .unwrap();
    let before = engine.snapshot().unwrap().to_json().unwrap();
    let request: Request =
        serde_json::from_str(r#"{"kind":"set_locale","locale":"zh-cn"}"#).unwrap();
    assert_eq!(engine.dispatch("ja", request).unwrap().revision, 0);
    assert!(matches!(
        engine.view_state("ja").unwrap().locale,
        Locale::ZhCn
    ));
    assert!(matches!(
        engine.view_state("en").unwrap().locale,
        Locale::En
    ));
    assert_eq!(engine.snapshot().unwrap().to_json().unwrap(), before);
    assert_eq!(
        engine
            .dispatch("unknown", Request::SetLocale { locale: Locale::Ja })
            .unwrap_err()
            .code,
        "unknown_view"
    );
}
