//! Host-only narrative definitions. UNGE remains a generic DAG engine.
pub const MAX_SCENE_TEXT_BYTES: usize = 6 * 1024 * 1024;
use futures::future::BoxFuture;
use serde_json::{Value as Json, json};
use std::{collections::BTreeMap, sync::Arc};
use unge_core::*;
use unge_executor::*;
pub const BLOCK: &str = "story.block";
pub const SEQUENCE: &str = "story.sequence";
pub const SCENE: &str = "story.scene";
pub const CHARACTER: &str = "story.character";
pub const RELATION: &str = "story.relationship";
fn words(en: &str, ja: &str, zh: &str) -> LocalizedText {
    LocalizedText {
        en: en.into(),
        ja: ja.into(),
        zh_cn: zh.into(),
    }
}
fn field(label: &str, kind: PropertyType, default: Json) -> PropertyDefinition {
    PropertyDefinition {
        name: words(label, label, label),
        description: words(label, label, label),
        value_type: kind,
        required: true,
        default: Some(default),
    }
}
fn string(max: usize) -> PropertyType {
    PropertyType::String {
        min_length: 0,
        max_length: Some(max),
        choices: None,
    }
}
fn port(name: &str, data: &str, required: bool) -> Port {
    Port {
        name: name.into(),
        data_type: DataType::Custom(data.into()),
        cardinality: Cardinality::Single,
        required,
    }
}
struct NarrativeExecutor;
impl NodeExecutor for NarrativeExecutor {
    fn execute(
        &self,
        context: ExecutionContext,
        inputs: Inputs,
    ) -> BoxFuture<'_, std::result::Result<Outputs, String>> {
        Box::pin(async move {
            if context.cancellation.is_cancelled() {
                return Err("cancelled".into());
            }
            if let Some(canonical) = context.properties.get("canonical") {
                Ok(BTreeMap::from([
                    (
                        "next".into(),
                        unge_executor::Value::Resource {
                            id: context.node,
                            data_type: DataType::Custom("story.flow".into()),
                        },
                    ),
                    (
                        "document".into(),
                        unge_executor::Value::Json(canonical.clone()),
                    ),
                ]))
            } else if context.properties.contains_key("parent")
                || context.properties.contains_key("structure")
            {
                Ok(BTreeMap::new())
            } else if context.properties.contains_key("role") {
                Ok(BTreeMap::from([(
                    "person".into(),
                    unge_executor::Value::Resource {
                        id: context.node,
                        data_type: DataType::Custom("story.person".into()),
                    },
                )]))
            } else {
                if inputs.get("from").is_none_or(Vec::is_empty)
                    || inputs.get("to").is_none_or(Vec::is_empty)
                {
                    return Err("missing_relationship_endpoint".into());
                }
                Ok(BTreeMap::new())
            }
        })
    }
}
pub fn registry() -> Arc<Registry> {
    let mut registry = Registry::default();
    for (type_id, name, inputs, outputs, extra) in [
        (
            BLOCK,
            words("Block", "ブロック", "区块"),
            vec![],
            vec![],
            BTreeMap::from([(
                "structure".into(),
                field("Structure", string(20), json!("block")),
            )]),
        ),
        (
            SEQUENCE,
            words("Sequence", "シーケンス", "序列"),
            vec![],
            vec![],
            BTreeMap::from([(
                "structure".into(),
                field("Structure", string(20), json!("sequence")),
            )]),
        ),
        (
            SCENE,
            words("Scene", "シーン", "场景"),
            vec![Port {
                cardinality: Cardinality::Multiple,
                ..port("previous", "story.flow", false)
            }],
            vec![
                port("next", "story.flow", false),
                Port {
                    name: "document".into(),
                    data_type: DataType::Json,
                    cardinality: Cardinality::Single,
                    required: false,
                },
            ],
            BTreeMap::from([
                (
                    "canonical".into(),
                    field(
                        "Document",
                        PropertyType::Json,
                        canonical("", Id::new_v4(), Id::new_v4()),
                    ),
                ),
                (
                    "order".into(),
                    field(
                        "Order",
                        PropertyType::Int {
                            minimum: Some(0),
                            maximum: Some(10000),
                        },
                        json!(0),
                    ),
                ),
                (
                    "path".into(),
                    field(
                        "Path",
                        PropertyType::String {
                            min_length: 1,
                            max_length: Some(20),
                            choices: Some(vec!["both".into(), "main".into(), "alternative".into()]),
                        },
                        json!("both"),
                    ),
                ),
            ]),
        ),
        (
            CHARACTER,
            words("Character", "登場人物", "人物"),
            vec![],
            vec![port("person", "story.person", false)],
            BTreeMap::from([
                ("role".into(), field("Role", string(500), json!(""))),
                (
                    "portrait".into(),
                    PropertyDefinition {
                        required: false,
                        ..field("Portrait", string(100_000), json!(""))
                    },
                ),
            ]),
        ),
        (
            RELATION,
            words("Relationship", "人物関係", "人物关系"),
            vec![
                port("from", "story.person", true),
                port("to", "story.person", true),
            ],
            vec![],
            BTreeMap::from([
                (
                    "kind".into(),
                    field(
                        "Kind",
                        PropertyType::String {
                            min_length: 1,
                            max_length: Some(20),
                            choices: Some(vec![
                                "family".into(),
                                "friend".into(),
                                "rival".into(),
                                "trust".into(),
                                "love".into(),
                            ]),
                        },
                        json!("friend"),
                    ),
                ),
                (
                    "mutual".into(),
                    field("Mutual", PropertyType::Bool, json!(true)),
                ),
            ]),
        ),
    ] {
        let mut fields = extra;
        fields.insert(
            "title".into(),
            field(
                "Title",
                PropertyType::String {
                    min_length: 1,
                    max_length: Some(200),
                    choices: None,
                },
                json!(name.ja),
            ),
        );
        fields.insert("notes".into(), field("Notes", string(16000), json!("")));
        if [BLOCK, SEQUENCE, SCENE].contains(&type_id) {
            fields.insert(
                "outlineOrder".into(),
                PropertyDefinition {
                    required: false,
                    ..field(
                        "Outline order",
                        PropertyType::Int {
                            minimum: Some(0),
                            maximum: Some(10000),
                        },
                        json!(0),
                    )
                },
            );
        }
        if [SCENE, SEQUENCE].contains(&type_id) {
            fields.insert(
                "parent".into(),
                PropertyDefinition {
                    required: false,
                    ..field("Parent", string(36), json!(""))
                },
            );
        }
        if [BLOCK, SEQUENCE].contains(&type_id) {
            fields.insert(
                "order".into(),
                field(
                    "Order",
                    PropertyType::Int {
                        minimum: Some(0),
                        maximum: Some(10000),
                    },
                    json!(0),
                ),
            );
        }
        registry
            .register(
                Definition {
                    type_id: type_id.into(),
                    version: "1".into(),
                    name,
                    description: words("Narrative node", "物語ノード", "叙事节点"),
                    inputs,
                    outputs,
                    pure: true,
                    property_schema: PropertySchema {
                        fields,
                        additional_properties: false,
                    },
                },
                Arc::new(NarrativeExecutor),
            )
            .unwrap();
    }
    Arc::new(registry)
}
pub fn canonical(text: &str, id: Id, paragraph: Id) -> Json {
    json!({"schemaId":"https://komyaku.example/schemas/document/v1","schemaVersion":1,"id":id,"type":"document","attrs":{"language":"und","direction":"auto","writingMode":"horizontal-tb"},"metadata":{},"extensions":{},"content":[{"id":paragraph,"schemaVersion":1,"type":"paragraph","attrs":{"lang":null,"dir":"auto"},"metadata":{},"extensions":{},"renderArtifacts":[],"content":if text.is_empty(){json!([])}else{json!([{"type":"text","text":text,"marks":[],"metadata":{},"extensions":{}}])}}]})
}
fn text_parts(document: &Json) -> std::result::Result<Vec<&str>, String> {
    let parts = super::rich_document::parts(document)?;
    if parts.iter().map(|text| text.len()).sum::<usize>() > MAX_SCENE_TEXT_BYTES {
        return Err("limit_exceeded".into());
    }
    // Enforce the same serialized limit without allocating a second full body.
    struct BoundedSize(usize);
    impl std::io::Write for BoundedSize {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self.0.saturating_add(bytes.len());
            if self.0 > 16 * 1024 * 1024 {
                return Err(std::io::Error::other("limit_exceeded"));
            }
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    serde_json::to_writer(&mut BoundedSize(0), document).map_err(|_| "limit_exceeded")?;
    Ok(parts)
}
pub fn validate_text(document: &Json) -> std::result::Result<(), String> {
    text_parts(document).map(|_| ())
}
pub fn text(document: &Json) -> std::result::Result<String, String> {
    Ok(text_parts(document)?.concat())
}
/// Wrap legacy root scenes without changing their canonical documents or route links.
pub fn migrate_hierarchy(
    document: Document,
    registry: &Registry,
) -> std::result::Result<Document, String> {
    let root: Vec<_> = document
        .graph()
        .nodes()
        .values()
        .filter(|n| {
            n.type_id == SCENE
                && n.properties
                    .get("parent")
                    .and_then(Json::as_str)
                    .is_none_or(str::is_empty)
        })
        .map(|n| n.id)
        .collect();
    if root.is_empty() {
        return Ok(document);
    }
    let mut editor = Editor::new(document, 256).map_err(|e| e.to_string())?;
    let mut block = registry.definition(BLOCK).unwrap().instantiate();
    block
        .properties
        .insert("title".into(), json!("Imported / 既存の文章 / 已有正文"));
    let mut sequence = registry.definition(SEQUENCE).unwrap().instantiate();
    sequence
        .properties
        .insert("parent".into(), json!(block.id.to_string()));
    let parent = sequence.id;
    let mut commands = vec![
        Command::AddNode {
            node: block,
            rect: Rect {
                x: 40.,
                y: -260.,
                width: 220.,
                height: 110.,
            },
        },
        Command::AddNode {
            node: sequence,
            rect: Rect {
                x: 40.,
                y: -110.,
                width: 220.,
                height: 110.,
            },
        },
    ];
    for id in root {
        commands.push(Command::SetProperty {
            id,
            key: "parent".into(),
            value: Some(json!(parent.to_string())),
        });
    }
    editor
        .execute(Command::Batch { commands })
        .map_err(|e| e.to_string())?;
    Ok(editor.document().clone())
}
pub struct Validator(pub Arc<Registry>);
impl DocumentValidator for Validator {
    fn validate(&self, document: &Document) -> unge_core::Result<()> {
        self.0.validate_edit(document.graph())?;
        super::central_document::validate(document).map_err(Error::Invalid)?;
        if document.extensions.keys().any(|key| {
            key != super::paths::EXTENSION
                && key != super::scene_operations::EXTENSION
                && key != super::narrative::EXTENSION
                && key != super::central_document::STORE
        }) {
            return Err(Error::Invalid("unsupported_extension".into()));
        }
        if document.graph().groups().len() > 32
            || document.graph().groups().values().any(|g| {
                g.label.trim().is_empty()
                    || g.label.chars().count() > 80
                    || g.label.chars().any(char::is_control)
                    || g.nodes.iter().any(|id| {
                        document
                            .graph()
                            .nodes()
                            .get(id)
                            .is_none_or(|n| n.type_id != CHARACTER)
                    })
            })
        {
            return Err(Error::Invalid("invalid_character_group".into()));
        }
        super::scene_operations::validate(document).map_err(Error::Invalid)?;
        super::narrative::validate(
            document,
            &super::narrative::declarations(document).map_err(Error::Invalid)?,
        )
        .map_err(Error::Invalid)?;
        if document.extensions.contains_key(super::paths::EXTENSION) {
            let paths = super::paths::definitions(document).map_err(Error::Invalid)?;
            super::paths::validate(document, &paths, true).map_err(Error::Invalid)?;
        }
        if document.graph().nodes().len() > 256 || document.graph().edges().len() > 1024 {
            return Err(Error::Invalid("limit_exceeded".into()));
        }
        for node in document.graph().nodes().values() {
            if let Some(parent) = node
                .properties
                .get("parent")
                .and_then(Json::as_str)
                .filter(|s| !s.is_empty())
            {
                let parent =
                    Id::parse_str(parent).map_err(|_| Error::Invalid("invalid_parent".into()))?;
                let parent = document
                    .graph()
                    .nodes()
                    .get(&parent)
                    .ok_or_else(|| Error::Invalid("invalid_parent".into()))?;
                let expected = if node.type_id == SCENE {
                    SEQUENCE
                } else {
                    BLOCK
                };
                if parent.type_id != expected {
                    return Err(Error::Invalid("invalid_parent".into()));
                }
            } else if [SEQUENCE, SCENE].contains(&node.type_id.as_str()) {
                return Err(Error::Invalid("invalid_parent".into()));
            }
            if node.type_id == SCENE
                && !document
                    .extensions
                    .contains_key(super::central_document::STORE)
            {
                validate_text(
                    super::central_document::canonical(document, node).map_err(Error::Invalid)?,
                )
                .map_err(Error::Invalid)?;
            }
        }
        Ok(())
    }
}
pub fn relation(
    registry: &Registry,
    from: Id,
    to: Id,
    title: &str,
    kind: &str,
    mutual: bool,
    rect: Rect,
) -> Command {
    let mut node = registry.definition(RELATION).unwrap().instantiate();
    node.properties.insert("title".into(), json!(title));
    node.properties.insert("kind".into(), json!(kind));
    node.properties.insert("mutual".into(), json!(mutual));
    let id = node.id;
    Command::Batch {
        commands: vec![
            Command::AddNode { node, rect },
            Command::Connect {
                edge: Edge {
                    id: Id::new_v4(),
                    from: Endpoint {
                        node: from,
                        port: "person".into(),
                    },
                    to: Endpoint {
                        node: id,
                        port: "from".into(),
                    },
                },
            },
            Command::Connect {
                edge: Edge {
                    id: Id::new_v4(),
                    from: Endpoint {
                        node: to,
                        port: "person".into(),
                    },
                    to: Endpoint {
                        node: id,
                        port: "to".into(),
                    },
                },
            },
        ],
    }
}
pub fn blank_document(registry: &Registry, language: &str) -> unge_core::Result<Document> {
    let names = match language {
        "en" => ["Untitled block", "Untitled sequence", "Untitled scene"],
        "zh-CN" => ["未设置的区块", "未设置的序列", "未设置的场景"],
        _ => ["未設定のブロック", "未設定のシーケンス", "未設定のシーン"],
    };
    let mut editor = Editor::new(Document::default(), 256)?;
    let mut parent = None;
    for (index, type_id) in [BLOCK, SEQUENCE, SCENE].into_iter().enumerate() {
        let mut node = registry.definition(type_id).unwrap().instantiate();
        node.properties.insert("title".into(), json!(names[index]));
        if type_id == SCENE {
            node.properties.insert(
                "canonical".into(),
                canonical("", Id::new_v4(), Id::new_v4()),
            );
        }
        if let Some(id) = parent {
            node.properties.insert("parent".into(), json!(id));
        }
        parent = Some(node.id.to_string());
        editor.execute(Command::AddNode {
            node,
            rect: Rect {
                x: 40. + index as f32 * 260.,
                y: 40.,
                width: 220.,
                height: 110.,
            },
        })?;
    }
    registry.validate_edit(editor.document().graph())?;
    Ok(editor.document().clone())
}
pub fn initial_document(registry: &Registry) -> Document {
    let mut editor = Editor::new(Document::default(), 256).unwrap();
    let mut block = registry.definition(BLOCK).unwrap().instantiate();
    block.properties.insert("title".into(), json!("雨の駅から"));
    let block_id = block.id;
    editor
        .execute(Command::AddNode {
            node: block,
            rect: Rect {
                x: 40.,
                y: -260.,
                width: 220.,
                height: 110.,
            },
        })
        .unwrap();
    let mut sequence = registry.definition(SEQUENCE).unwrap().instantiate();
    sequence
        .properties
        .insert("title".into(), json!("手紙の物語"));
    sequence
        .properties
        .insert("parent".into(), json!(block_id.to_string()));
    let sequence_id = sequence.id;
    editor
        .execute(Command::AddNode {
            node: sequence,
            rect: Rect {
                x: 40.,
                y: -110.,
                width: 220.,
                height: 110.,
            },
        })
        .unwrap();
    let mut ids = Vec::new();
    for (i,(title,body,path,order)) in [
        ("起 · 雨の駅","終電が去った駅で、灯は差出人のない手紙を拾った。\n封筒には、十年前に消えた兄の筆跡があった。","both",0),
        ("承 · 手紙を開く","灯は蓮に手紙を見せた。彼は宛名を見た瞬間、言葉を失った。","main",1),
        ("承 · 手紙を隠す","灯は手紙を鞄の底にしまった。今はまだ、誰も信じられなかった。","alternative",1),
        ("転 · 記憶の場所","二人が辿り着いたのは、閉鎖された図書館だった。窓の向こうに、見覚えのある影が動いた。","both",2),
        ("結 · 新しい朝","扉を開けると、朝の光が差し込んだ。灯は手紙の最後の一行を、声に出して読んだ。","both",3)
    ].into_iter().enumerate() {
        let mut node=registry.definition(SCENE).unwrap().instantiate();
        node.properties.insert("outlineOrder".into(),json!(i));node.properties.insert("parent".into(),json!(sequence_id.to_string()));node.properties.insert("title".into(),json!(title));node.properties.insert("canonical".into(),canonical(body,Id::new_v4(),Id::new_v4()));node.properties.insert("path".into(),json!(path));node.properties.insert("order".into(),json!(order));ids.push(node.id);
        editor.execute(Command::AddNode { node,rect:Rect { x:40.+order as f32*260.,y:40.+if i==2 {160.}else{0.},width:220.,height:110. } }).unwrap();
    }
    for (from, to) in [(0, 1), (0, 2), (1, 3), (2, 3), (3, 4)] {
        editor
            .execute(Command::Connect {
                edge: Edge {
                    id: Id::new_v4(),
                    from: Endpoint {
                        node: ids[from],
                        port: "next".into(),
                    },
                    to: Endpoint {
                        node: ids[to],
                        port: "previous".into(),
                    },
                },
            })
            .unwrap();
    }
    let mut people = Vec::new();
    for (i, (title, role)) in [
        ("灯 / Akari", "主人公。失踪した兄を探している。"),
        ("蓮 / Ren", "幼なじみ。手紙の秘密を知っている。"),
        ("澪 / Mio", "灯の兄。十年前に消息を絶った。"),
    ]
    .into_iter()
    .enumerate()
    {
        let mut node = registry.definition(CHARACTER).unwrap().instantiate();
        node.properties.insert("title".into(), json!(title));
        node.properties.insert("role".into(), json!(role));
        people.push(node.id);
        editor
            .execute(Command::AddNode {
                node,
                rect: Rect {
                    x: 40.,
                    y: 400. + i as f32 * 150.,
                    width: 220.,
                    height: 110.,
                },
            })
            .unwrap();
    }
    for (i, (from, to, title, kind)) in [
        (0, 1, "幼なじみ / Childhood friends", "friend"),
        (0, 2, "兄妹 / Siblings", "family"),
        (1, 2, "秘密 / A shared secret", "trust"),
    ]
    .into_iter()
    .enumerate()
    {
        editor
            .execute(relation(
                registry,
                people[from],
                people[to],
                title,
                kind,
                true,
                Rect {
                    x: 400.,
                    y: 400. + i as f32 * 150.,
                    width: 250.,
                    height: 110.,
                },
            ))
            .unwrap();
    }
    editor.document().clone()
}
/// Explicit route order; reject gaps, ambiguous order and disconnected paths.
pub fn compile(
    document: &Document,
    path: &str,
) -> std::result::Result<Vec<(Id, String, String)>, String> {
    if document.extensions.contains_key(super::paths::EXTENSION) {
        return super::paths::route(document, path);
    }
    legacy_compile(document, path)
}
pub fn legacy_compile(
    document: &Document,
    path: &str,
) -> std::result::Result<Vec<(Id, String, String)>, String> {
    if !["main", "alternative"].contains(&path) {
        return Err("invalid_path".into());
    }
    let mut nodes: Vec<_> = document
        .graph()
        .nodes()
        .values()
        .filter(|n| {
            n.type_id == SCENE && (n.properties["path"] == path || n.properties["path"] == "both")
        })
        .collect();
    nodes.sort_by_key(|n| n.properties["order"].as_u64().unwrap_or(0));
    for (i, node) in nodes.iter().enumerate() {
        if node.properties["order"].as_u64() != Some(i as u64) {
            return Err("ambiguous_path".into());
        }
        if i > 0
            && !document.graph().edges().values().any(|e| {
                e.from.node == nodes[i - 1].id && e.to.node == node.id && e.from.port == "next"
            })
        {
            return Err("disconnected_path".into());
        }
    }
    nodes
        .iter()
        .map(|n| {
            Ok((
                n.id,
                n.properties["title"].as_str().unwrap().into(),
                text(super::central_document::canonical(document, n)?)?,
            ))
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn borrowed_validation_preserves_text_and_counts_escaped_serialized_bytes() {
        let document = canonical("雨😀\r\n末尾", Id::new_v4(), Id::new_v4());
        validate_text(&document).unwrap();
        assert_eq!(text(&document).unwrap(), "雨😀\r\n末尾");
        let escaped = canonical(&"\0".repeat(3 * 1024 * 1024), Id::new_v4(), Id::new_v4());
        assert_eq!(validate_text(&escaped).unwrap_err(), "limit_exceeded");
        let oversized = canonical(
            &"a".repeat(MAX_SCENE_TEXT_BYTES + 1),
            Id::new_v4(),
            Id::new_v4(),
        );
        assert_eq!(validate_text(&oversized).unwrap_err(), "limit_exceeded");
    }
    #[test]
    fn narrative_executors_validate_cancel_and_cache() {
        let registry = registry();
        let document = initial_document(&registry);
        let mut scheduler = Scheduler::new(4, 100);
        let first = futures::executor::block_on(scheduler.run(
            document.graph(),
            &registry,
            Cancellation::default(),
        ))
        .unwrap();
        assert!(first.nodes.values().all(|n| n.status == Status::Completed));
        let cached = futures::executor::block_on(scheduler.run(
            document.graph(),
            &registry,
            Cancellation::default(),
        ))
        .unwrap();
        assert!(cached.nodes.values().all(|n| n.status == Status::Cached));
        let cancellation = Cancellation::default();
        cancellation.cancel();
        let cancelled =
            futures::executor::block_on(scheduler.run(document.graph(), &registry, cancellation))
                .unwrap();
        assert!(
            cancelled
                .nodes
                .values()
                .all(|n| n.status == Status::Cancelled)
        );
    }
    #[test]
    fn seeded_routes_and_semantic_cycles() {
        let registry = registry();
        let document = initial_document(&registry);
        Validator(registry.clone()).validate(&document).unwrap();
        assert_eq!(compile(&document, "main").unwrap().len(), 4);
        assert_eq!(compile(&document, "alternative").unwrap().len(), 4);
        // Reciprocal and cyclic character relationships do not become flow cycles.
        let people: Vec<_> = document
            .graph()
            .nodes()
            .values()
            .filter(|n| n.type_id == CHARACTER)
            .map(|n| n.id)
            .collect();
        let mut editor = Editor::new(document, 256)
            .unwrap()
            .with_validator(Arc::new(Validator(registry.clone())))
            .unwrap();
        let before = editor.document().to_json().unwrap();
        for (a, b) in [(0, 1), (1, 2), (2, 0)] {
            editor
                .execute(relation(
                    &registry,
                    people[a],
                    people[b],
                    "rival",
                    "rival",
                    false,
                    Rect::default(),
                ))
                .unwrap();
        }
        for _ in 0..3 {
            editor.undo().unwrap();
        }
        assert_eq!(editor.document().to_json().unwrap(), before);
    }
    #[test]
    fn invalid_relationship_rolls_back() {
        let registry = registry();
        let document = initial_document(&registry);
        let mut editor = Editor::new(document, 256)
            .unwrap()
            .with_validator(Arc::new(Validator(registry.clone())))
            .unwrap();
        let before = editor.document().to_json().unwrap();
        assert!(
            editor
                .execute(relation(
                    &registry,
                    Id::new_v4(),
                    Id::new_v4(),
                    "broken",
                    "friend",
                    true,
                    Rect::default()
                ))
                .is_err()
        );
        assert_eq!(editor.document().to_json().unwrap(), before);
    }
    #[test]
    fn canonical_identity_unicode_and_path_validation() {
        let original = "か\u{3099} / が / 👨‍👩‍👧‍👦\n雨";
        let doc = canonical(original, Id::new_v4(), Id::new_v4());
        assert_eq!(text(&doc).unwrap(), original);
        let registry = registry();
        let mut editor = Editor::new(initial_document(&registry), 10).unwrap();
        let edge = editor
            .document()
            .graph()
            .edges()
            .values()
            .find(|e| e.from.port == "next")
            .unwrap()
            .id;
        editor.execute(Command::Disconnect { id: edge }).unwrap();
        assert!(
            compile(editor.document(), "main").is_err()
                || compile(editor.document(), "alternative").is_err()
        );
    }
}
