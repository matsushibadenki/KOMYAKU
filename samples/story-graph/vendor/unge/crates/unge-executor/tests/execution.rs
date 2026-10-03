use unge_core::*;
use unge_executor::*;
fn graph() -> (Registry, Editor, Id, Id) {
    let registry = math_registry();
    let mut editor = Editor::new(Document::default(), 10).unwrap();
    let mut a = registry.definition("math.number").unwrap().instantiate();
    a.properties.insert("value".into(), 20.into());
    let mut b = registry.definition("math.number").unwrap().instantiate();
    b.properties.insert("value".into(), 22.into());
    let sum = registry.definition("math.add").unwrap().instantiate();
    let (aid, bid, sid) = (a.id, b.id, sum.id);
    let mut commands: Vec<_> = [a, b, sum]
        .into_iter()
        .map(|node| Command::AddNode {
            node,
            rect: Rect::default(),
        })
        .collect();
    for (id, port) in [(aid, "a"), (bid, "b")] {
        commands.push(Command::Connect {
            edge: Edge {
                id: Id::new_v4(),
                from: Endpoint {
                    node: id,
                    port: "value".into(),
                },
                to: Endpoint {
                    node: sid,
                    port: port.into(),
                },
            },
        });
    }
    editor.execute(Command::Batch { commands }).unwrap();
    (registry, editor, aid, sid)
}
#[test]
fn execution_cache_and_changed_input() {
    futures::executor::block_on(async {
        let (registry, mut editor, aid, sid) = graph();
        let mut scheduler = Scheduler::new(2, 100);
        let first = scheduler
            .run(
                editor.document().graph(),
                &registry,
                Cancellation::default(),
            )
            .await
            .unwrap();
        assert_eq!(first.nodes[&sid].outputs["value"], Value::Float(42.));
        let cached = scheduler
            .run(
                editor.document().graph(),
                &registry,
                Cancellation::default(),
            )
            .await
            .unwrap();
        assert!(cached.nodes.values().all(|n| n.status == Status::Cached));
        editor
            .execute(Command::SetProperty {
                id: aid,
                key: "value".into(),
                value: Some(100.into()),
            })
            .unwrap();
        let changed = scheduler
            .run(
                editor.document().graph(),
                &registry,
                Cancellation::default(),
            )
            .await
            .unwrap();
        assert_eq!(changed.nodes[&sid].outputs["value"], Value::Float(122.));
        assert_eq!(
            changed
                .nodes
                .values()
                .filter(|n| n.status == Status::Cached)
                .count(),
            1
        );
    });
}
#[test]
fn failure_blocks_dependents_but_independent_nodes_complete() {
    futures::executor::block_on(async {
        let (registry, editor, aid, sid) = graph();
        // A runtime failure with schema-valid input must block only its dependents.
        struct SometimesFails;
        impl NodeExecutor for SometimesFails {
            fn execute(
                &self,
                ctx: ExecutionContext,
                _: Inputs,
            ) -> futures::future::BoxFuture<'_, std::result::Result<Outputs, String>> {
                Box::pin(async move {
                    let value = ctx.properties["value"].as_f64().unwrap();
                    if value == 20.0 {
                        Err("host resource unavailable".into())
                    } else {
                        Ok(Outputs::from([("value".into(), Value::Float(value))]))
                    }
                })
            }
        }
        let mut failing = Registry::default();
        failing
            .register(
                registry.definition("math.number").unwrap().clone(),
                std::sync::Arc::new(SometimesFails),
            )
            .unwrap();
        // The dependent must never be polled after its input fails.
        struct Add;
        impl NodeExecutor for Add {
            fn execute(
                &self,
                _: ExecutionContext,
                _: Inputs,
            ) -> futures::future::BoxFuture<'_, std::result::Result<Outputs, String>> {
                panic!("dependent of failed input must not execute")
            }
        }
        failing
            .register(
                registry.definition("math.add").unwrap().clone(),
                std::sync::Arc::new(Add),
            )
            .unwrap();
        let result = Scheduler::new(2, 10)
            .run(editor.document().graph(), &failing, Cancellation::default())
            .await
            .unwrap();
        assert_eq!(result.nodes[&aid].status, Status::Failed);
        assert_eq!(result.nodes[&sid].status, Status::Blocked);
        assert_eq!(
            result
                .nodes
                .values()
                .filter(|n| n.status == Status::Completed)
                .count(),
            1
        );
    });
}
#[test]
fn cancelled_execution_does_not_use_cache() {
    futures::executor::block_on(async {
        let (registry, editor, _, _) = graph();
        let cancel = Cancellation::default();
        cancel.cancel();
        let result = Scheduler::new(2, 10)
            .run(editor.document().graph(), &registry, cancel)
            .await
            .unwrap();
        assert!(result.nodes.values().all(|n| n.status == Status::Cancelled));
    });
}
#[test]
fn missing_input_and_forged_schema_fail_before_execution() {
    let (registry, mut editor, aid, _) = graph();
    editor.execute(Command::RemoveNode { id: aid }).unwrap();
    assert!(registry.validate(editor.document().graph()).is_err());
    let mut node = registry.definition("math.number").unwrap().instantiate();
    node.outputs[0].data_type = DataType::String;
    let mut editor = Editor::new(Document::default(), 1).unwrap();
    editor
        .execute(Command::AddNode {
            node,
            rect: Rect::default(),
        })
        .unwrap();
    assert!(registry.validate(editor.document().graph()).is_err());
}
#[test]
fn concurrency_is_bounded_and_actually_overlaps() {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };
    struct Probe {
        active: Arc<AtomicUsize>,
        peak: Arc<AtomicUsize>,
    }
    impl NodeExecutor for Probe {
        fn execute(
            &self,
            _: ExecutionContext,
            _: Inputs,
        ) -> futures::future::BoxFuture<'_, std::result::Result<Outputs, String>> {
            Box::pin(async move {
                let active = self.active.fetch_add(1, Ordering::SeqCst) + 1;
                self.peak.fetch_max(active, Ordering::SeqCst);
                let mut yielded = false;
                futures::future::poll_fn(|cx| {
                    if yielded {
                        std::task::Poll::Ready(())
                    } else {
                        yielded = true;
                        cx.waker().wake_by_ref();
                        std::task::Poll::Pending
                    }
                })
                .await;
                self.active.fetch_sub(1, Ordering::SeqCst);
                Ok(Outputs::new())
            })
        }
    }
    let text = LocalizedText {
        en: "Probe".into(),
        ja: "検証".into(),
        zh_cn: "验证".into(),
    };
    let definition = Definition {
        type_id: "probe".into(),
        version: "1".into(),
        name: text.clone(),
        description: text,
        inputs: vec![],
        outputs: vec![],
        pure: false,
        property_schema: PropertySchema::default(),
    };
    let mut editor = Editor::new(Document::default(), 1).unwrap();
    editor
        .execute(Command::Batch {
            commands: (0..8)
                .map(|_| Command::AddNode {
                    node: definition.instantiate(),
                    rect: Rect::default(),
                })
                .collect(),
        })
        .unwrap();
    let peak = Arc::new(AtomicUsize::new(0));
    let mut registry = Registry::default();
    registry
        .register(
            definition,
            Arc::new(Probe {
                active: Arc::new(AtomicUsize::new(0)),
                peak: peak.clone(),
            }),
        )
        .unwrap();
    futures::executor::block_on(Scheduler::new(2, 0).run(
        editor.document().graph(),
        &registry,
        Cancellation::default(),
    ))
    .unwrap();
    assert_eq!(peak.load(Ordering::SeqCst), 2);
}
