use serde_json::json;
use std::{collections::BTreeMap, sync::Arc};
use unge_core::*;
use unge_executor::*;

fn field(value_type: PropertyType, default: Option<serde_json::Value>) -> PropertyDefinition {
    let text = LocalizedText {
        en: "Value".into(),
        ja: "値".into(),
        zh_cn: "值".into(),
    };
    PropertyDefinition {
        name: text.clone(),
        description: text,
        value_type,
        required: true,
        default,
    }
}
#[test]
fn constraints_defaults_and_unknown_properties_are_explicit() {
    let schema = PropertySchema {
        fields: BTreeMap::from([
            (
                "enabled".into(),
                field(PropertyType::Bool, Some(json!(true))),
            ),
            (
                "count".into(),
                field(
                    PropertyType::Int {
                        minimum: Some(-2),
                        maximum: Some(4),
                    },
                    Some(json!(0)),
                ),
            ),
            (
                "gain".into(),
                field(
                    PropertyType::Float {
                        minimum: Some(0.0),
                        maximum: Some(1.0),
                    },
                    Some(json!(0.5)),
                ),
            ),
            (
                "label".into(),
                field(
                    PropertyType::String {
                        min_length: 2,
                        max_length: Some(2),
                        choices: Some(vec!["東京".into(), "北京".into()]),
                    },
                    Some(json!("東京")),
                ),
            ),
            (
                "data".into(),
                field(PropertyType::Json, Some(json!({"list":[1,2]}))),
            ),
        ]),
        additional_properties: false,
    };
    schema.validate_schema().unwrap();
    let defaults = schema.defaults();
    schema.validate(&defaults).unwrap();
    for (key, bad) in [
        ("enabled", json!(1)),
        ("count", json!(4.5)),
        ("count", json!(5)),
        ("count", json!(-3)),
        ("count", json!(u64::MAX)),
        ("gain", json!(-0.1)),
        ("gain", json!(1.1)),
        ("label", json!("大阪")),
        ("label", json!("京")),
        ("extra", json!(null)),
    ] {
        let mut values = defaults.clone();
        values.insert(key.into(), bad);
        assert!(schema.validate(&values).is_err(), "{key}");
    }
    let mut missing = defaults;
    missing.remove("count");
    assert!(schema.validate(&missing).is_err());
    assert!(
        PropertySchema::default()
            .validate(&Properties::from([("extra".into(), json!(1))]))
            .is_ok()
    );
    let wire = serde_json::to_value(&schema).unwrap();
    let decoded: PropertySchema = serde_json::from_value(wire).unwrap();
    decoded.validate(&decoded.defaults()).unwrap();
}
#[test]
fn malformed_schema_and_defaults_are_rejected_at_registration() {
    struct Never;
    impl NodeExecutor for Never {
        fn execute(
            &self,
            _: ExecutionContext,
            _: Inputs,
        ) -> futures::future::BoxFuture<'_, std::result::Result<Outputs, String>> {
            panic!("must not execute")
        }
    }
    for value_type in [
        PropertyType::Int {
            minimum: Some(3),
            maximum: Some(2),
        },
        PropertyType::Float {
            minimum: Some(f64::NAN),
            maximum: None,
        },
        PropertyType::String {
            min_length: 3,
            max_length: Some(2),
            choices: None,
        },
        PropertyType::String {
            min_length: 0,
            max_length: None,
            choices: Some(vec![]),
        },
        PropertyType::String {
            min_length: 0,
            max_length: None,
            choices: Some(vec!["x".into(), "x".into()]),
        },
    ] {
        let mut definition = math_registry().definition("math.number").unwrap().clone();
        definition
            .property_schema
            .fields
            .insert("bad".into(), field(value_type, None));
        assert!(
            Registry::default()
                .register(definition, Arc::new(Never))
                .is_err()
        );
    }
    let mut definition = math_registry().definition("math.number").unwrap().clone();
    definition
        .property_schema
        .fields
        .get_mut("value")
        .unwrap()
        .default = Some(json!("bad"));
    assert!(
        Registry::default()
            .register(definition, Arc::new(Never))
            .is_err()
    );
}
#[test]
fn editing_validates_final_batch_atomically_and_execution_checks_missing_inputs() {
    let registry = Arc::new(math_registry());
    let mut editor = Editor::new(Document::default(), 10)
        .unwrap()
        .with_validator(registry.clone())
        .unwrap();
    let number = registry.definition("math.number").unwrap().instantiate();
    let id = number.id;
    assert_eq!(number.properties["value"], json!(0));
    editor
        .execute(Command::AddNode {
            node: number,
            rect: Rect::default(),
        })
        .unwrap();
    let before = editor.document().clone();
    let stats = editor.history_stats();
    let invalid = Command::Batch {
        commands: vec![
            Command::MoveNode {
                id,
                rect: Rect {
                    x: 20.,
                    ..Rect::default()
                },
            },
            Command::SetProperty {
                id,
                key: "value".into(),
                value: Some(json!("bad")),
            },
        ],
    };
    assert!(matches!(editor.execute(invalid), Err(Error::Properties(_))));
    assert_eq!(editor.document(), &before);
    assert_eq!(editor.revision(), 1);
    assert_eq!(editor.history_stats(), stats);
    assert!(
        editor
            .execute(Command::SetProperty {
                id,
                key: "value".into(),
                value: None
            })
            .is_err()
    );
    // Transiently missing required value is fine inside one atomic batch.
    editor
        .execute(Command::Batch {
            commands: vec![
                Command::SetProperty {
                    id,
                    key: "value".into(),
                    value: None,
                },
                Command::SetProperty {
                    id,
                    key: "value".into(),
                    value: Some(json!(42)),
                },
            ],
        })
        .unwrap();
    editor.undo().unwrap();
    assert_eq!(editor.document(), &before);
    editor.redo().unwrap();
    assert_eq!(
        editor.document().graph().nodes()[&id].properties["value"],
        42
    );
    editor
        .execute(Command::AddNode {
            node: registry.definition("math.add").unwrap().instantiate(),
            rect: Rect::default(),
        })
        .unwrap();
    registry.validate_edit(editor.document().graph()).unwrap();
    assert!(
        registry
            .validate(editor.document().graph())
            .unwrap_err()
            .contains("missing required input")
    );
}
#[test]
fn legacy_definitions_remain_open_and_invalid_loaded_documents_fail_before_execution() {
    let registry = math_registry();
    let mut wire = serde_json::to_value(registry.definition("math.number").unwrap()).unwrap();
    wire.as_object_mut().unwrap().remove("property_schema");
    let legacy: Definition = serde_json::from_value(wire).unwrap();
    assert!(legacy.property_schema.additional_properties);
    let mut e = Editor::new(Document::default(), 1).unwrap();
    let mut n = registry.definition("math.number").unwrap().instantiate();
    n.properties.clear();
    e.execute(Command::AddNode {
        node: n,
        rect: Rect::default(),
    })
    .unwrap();
    assert!(registry.validate(e.document().graph()).is_err());
    assert!(e.with_validator(Arc::new(registry)).is_err());
    let mut n = math_registry()
        .definition("math.number")
        .unwrap()
        .instantiate();
    n.properties.insert("value".into(), json!("bad"));
    let mut e = Editor::new(Document::default(), 0).unwrap();
    e.execute(Command::AddNode {
        node: n,
        rect: Rect::default(),
    })
    .unwrap();
    let loaded = Editor::new(e.document().clone(), 10).unwrap();
    assert!(matches!(
        loaded.with_validator(Arc::new(math_registry())),
        Err(Error::Properties(_))
    ));
}
