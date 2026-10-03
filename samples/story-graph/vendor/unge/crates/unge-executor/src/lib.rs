//! Async DAG execution with bounded concurrency and opt-in pure-node caching.
mod properties;
pub use properties::*;

use futures::{StreamExt, future::BoxFuture, stream};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};
use unge_core::{Cardinality, DataType, Graph, GraphIndex, Id, Node, Port, Properties};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
pub enum Value {
    Bool(bool),
    Int(i64),
    Float(f64),
    String(String),
    Json(serde_json::Value),
    /// Immutable content/version ID resolved in a host-owned CPU/GPU resource store.
    Resource {
        id: Id,
        data_type: DataType,
    },
}
impl Value {
    pub fn data_type(&self) -> DataType {
        match self {
            Self::Bool(_) => DataType::Bool,
            Self::Int(_) => DataType::Int,
            Self::Float(_) => DataType::Float,
            Self::String(_) => DataType::String,
            Self::Json(_) => DataType::Json,
            Self::Resource { data_type, .. } => data_type.clone(),
        }
    }
    fn valid(&self) -> bool {
        !matches!(self, Self::Float(v) if !v.is_finite())
    }
}
pub type Inputs = BTreeMap<String, Vec<Value>>;
pub type Outputs = BTreeMap<String, Value>;
#[derive(Debug, Clone, Default)]
pub struct Cancellation(Arc<AtomicBool>);
impl Cancellation {
    pub fn cancel(&self) {
        self.0.store(true, Ordering::Release);
    }
    pub fn is_cancelled(&self) -> bool {
        self.0.load(Ordering::Acquire)
    }
}
#[derive(Clone)]
pub struct ExecutionContext {
    pub node: Id,
    pub properties: Properties,
    pub cancellation: Cancellation,
}
/// Implementations must yield; CPU-heavy work belongs on the host's worker pool.
pub trait NodeExecutor: Send + Sync {
    fn execute(
        &self,
        context: ExecutionContext,
        inputs: Inputs,
    ) -> BoxFuture<'_, Result<Outputs, String>>;
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LocalizedText {
    pub en: String,
    pub ja: String,
    pub zh_cn: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Definition {
    pub type_id: String,
    /// Bump when executor behavior or schema changes, invalidating cache keys.
    pub version: String,
    pub name: LocalizedText,
    pub description: LocalizedText,
    pub inputs: Vec<Port>,
    pub outputs: Vec<Port>,
    pub pure: bool,
    #[serde(default)]
    pub property_schema: PropertySchema,
}
impl Definition {
    pub fn instantiate(&self) -> Node {
        Node {
            id: Id::new_v4(),
            type_id: self.type_id.clone(),
            inputs: self.inputs.clone(),
            outputs: self.outputs.clone(),
            properties: self.property_schema.defaults(),
        }
    }
}
#[derive(Default)]
pub struct Registry {
    entries: BTreeMap<String, (Definition, Arc<dyn NodeExecutor>)>,
}
impl Registry {
    /// In-process executors are trusted host code. This is not a plugin sandbox.
    pub fn register(
        &mut self,
        definition: Definition,
        executor: Arc<dyn NodeExecutor>,
    ) -> Result<(), String> {
        if definition.type_id.is_empty() || definition.version.is_empty() {
            return Err("missing type id or version".into());
        }
        definition.property_schema.validate_schema()?;
        if self.entries.contains_key(&definition.type_id) {
            return Err("duplicate node definition".into());
        }
        self.entries
            .insert(definition.type_id.clone(), (definition, executor));
        Ok(())
    }
    pub fn definition(&self, id: &str) -> Option<&Definition> {
        self.entries.get(id).map(|e| &e.0)
    }
    pub fn definitions(&self) -> impl Iterator<Item = &Definition> {
        self.entries.values().map(|e| &e.0)
    }
    /// Editing allows unconnected required inputs while a graph is being built.
    /// Unknown types, forged ports and invalid properties are rejected.
    pub fn validate_edit(&self, graph: &Graph) -> unge_core::Result<()> {
        graph.validate()?;
        for node in graph.nodes().values() {
            let definition = self.definition(&node.type_id).ok_or_else(|| {
                unge_core::Error::Invalid(format!("unregistered node type: {}", node.type_id))
            })?;
            if node.inputs != definition.inputs || node.outputs != definition.outputs {
                return Err(unge_core::Error::Invalid(format!(
                    "schema mismatch: {}",
                    node.type_id
                )));
            }
            definition
                .property_schema
                .validate(&node.properties)
                .map_err(|e| {
                    unge_core::Error::Properties(format!(
                        "node {} ({}): {e}",
                        node.id, node.type_id
                    ))
                })?;
        }
        Ok(())
    }
    pub fn validate(&self, graph: &Graph) -> Result<(), String> {
        self.validate_edit(graph).map_err(|e| e.to_string())?;
        let index = GraphIndex::new(graph);
        for node in graph.nodes().values() {
            for port in &node.inputs {
                if port.required
                    && !index
                        .incoming
                        .get(&node.id)
                        .into_iter()
                        .flatten()
                        .any(|id| graph.edges()[id].to.port == port.name)
                {
                    return Err(format!("missing required input: {}.{}", node.id, port.name));
                }
            }
        }
        Ok(())
    }
}
impl unge_core::DocumentValidator for Registry {
    fn validate(&self, document: &unge_core::Document) -> unge_core::Result<()> {
        self.validate_edit(document.graph())
    }
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Completed,
    Cached,
    Failed,
    Blocked,
    Cancelled,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeResult {
    pub status: Status,
    pub outputs: Outputs,
    pub error: Option<String>,
}
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Report {
    pub nodes: BTreeMap<Id, NodeResult>,
}
struct CacheEntry {
    key: String,
    outputs: Outputs,
}
pub struct Scheduler {
    concurrency: usize,
    cache_limit: usize,
    cache: VecDeque<CacheEntry>,
}
impl Scheduler {
    pub fn new(concurrency: usize, cache_limit: usize) -> Self {
        Self {
            concurrency: concurrency.max(1),
            cache_limit,
            cache: VecDeque::new(),
        }
    }
    pub fn clear_cache(&mut self) {
        self.cache.clear();
    }
    pub async fn run(
        &mut self,
        graph: &Graph,
        registry: &Registry,
        cancellation: Cancellation,
    ) -> Result<Report, String> {
        registry.validate(graph)?;
        let layers = graph.layers().map_err(|e| e.to_string())?;
        let index = GraphIndex::new(graph);
        let mut report = Report::default();
        for layer in layers {
            let mut jobs = Vec::new();
            for id in layer {
                if cancellation.is_cancelled() {
                    report.nodes.insert(
                        id,
                        NodeResult {
                            status: Status::Cancelled,
                            outputs: Outputs::new(),
                            error: None,
                        },
                    );
                    continue;
                }
                let node = &graph.nodes()[&id];
                let (definition, executor) = &registry.entries[&node.type_id];
                let mut inputs = Inputs::new();
                let mut blocked = false;
                for edge in index
                    .incoming
                    .get(&id)
                    .into_iter()
                    .flatten()
                    .map(|id| &graph.edges()[id])
                {
                    match report.nodes[&edge.from.node].outputs.get(&edge.from.port) {
                        Some(value) => inputs
                            .entry(edge.to.port.clone())
                            .or_default()
                            .push(value.clone()),
                        None => blocked = true,
                    }
                }
                if blocked {
                    report.nodes.insert(
                        id,
                        NodeResult {
                            status: Status::Blocked,
                            outputs: Outputs::new(),
                            error: Some("upstream output unavailable".into()),
                        },
                    );
                    continue;
                }
                let key = serde_json::to_string(&(
                    &definition.type_id,
                    &definition.version,
                    &inputs,
                    &node.properties,
                ))
                .map_err(|e| e.to_string())?;
                if definition.pure
                    && let Some(entry) = self.cache.iter().find(|entry| entry.key == key)
                {
                    report.nodes.insert(
                        id,
                        NodeResult {
                            status: Status::Cached,
                            outputs: entry.outputs.clone(),
                            error: None,
                        },
                    );
                    continue;
                }
                let context = ExecutionContext {
                    node: id,
                    properties: node.properties.clone(),
                    cancellation: cancellation.clone(),
                };
                jobs.push(async move {
                    let result = if context.cancellation.is_cancelled() {
                        Err("cancelled".into())
                    } else {
                        executor.execute(context.clone(), inputs).await
                    };
                    let result = result.and_then(|outputs| {
                        validate_outputs(&definition.outputs, &outputs)?;
                        Ok(outputs)
                    });
                    (
                        id,
                        definition.pure,
                        key,
                        context.cancellation.is_cancelled(),
                        result,
                    )
                });
            }
            let mut pending = stream::iter(jobs).buffer_unordered(self.concurrency);
            while let Some((id, pure, key, cancelled, result)) = pending.next().await {
                let record = if cancelled {
                    NodeResult {
                        status: Status::Cancelled,
                        outputs: Outputs::new(),
                        error: None,
                    }
                } else {
                    match result {
                        Ok(outputs) => {
                            if pure && self.cache_limit > 0 {
                                self.cache.push_back(CacheEntry {
                                    key,
                                    outputs: outputs.clone(),
                                });
                                while self.cache.len() > self.cache_limit {
                                    self.cache.pop_front();
                                }
                            }
                            NodeResult {
                                status: Status::Completed,
                                outputs,
                                error: None,
                            }
                        }
                        Err(error) => NodeResult {
                            status: Status::Failed,
                            outputs: Outputs::new(),
                            error: Some(error),
                        },
                    }
                };
                report.nodes.insert(id, record);
            }
        }
        Ok(report)
    }
}
fn validate_outputs(ports: &[Port], outputs: &Outputs) -> Result<(), String> {
    for port in ports {
        if port.required && !outputs.contains_key(&port.name) {
            return Err(format!("missing output: {}", port.name));
        }
    }
    for (name, value) in outputs {
        let port = ports
            .iter()
            .find(|p| p.name == *name)
            .ok_or_else(|| format!("unknown output: {name}"))?;
        if !value.valid() || !port.data_type.accepts(&value.data_type()) {
            return Err(format!("invalid output type: {name}"));
        }
    }
    Ok(())
}

/// Small built-in example; extend via Registry without modifying the engine.
pub fn math_registry() -> Registry {
    struct Number;
    impl NodeExecutor for Number {
        fn execute(
            &self,
            ctx: ExecutionContext,
            _: Inputs,
        ) -> BoxFuture<'_, Result<Outputs, String>> {
            Box::pin(async move {
                let value = ctx
                    .properties
                    .get("value")
                    .and_then(|v| v.as_f64())
                    .ok_or("number.value must be numeric")?;
                Ok(BTreeMap::from([("value".into(), Value::Float(value))]))
            })
        }
    }
    struct Add;
    impl NodeExecutor for Add {
        fn execute(
            &self,
            _: ExecutionContext,
            inputs: Inputs,
        ) -> BoxFuture<'_, Result<Outputs, String>> {
            Box::pin(async move {
                let mut sum = 0.0;
                for name in ["a", "b"] {
                    match inputs.get(name).and_then(|v| v.first()) {
                        Some(Value::Float(v)) => sum += v,
                        _ => return Err(format!("missing float: {name}")),
                    }
                }
                Ok(BTreeMap::from([("value".into(), Value::Float(sum))]))
            })
        }
    }
    let text = |en: &str, ja: &str, zh: &str| LocalizedText {
        en: en.into(),
        ja: ja.into(),
        zh_cn: zh.into(),
    };
    let port = |name: &str| Port {
        name: name.into(),
        data_type: DataType::Float,
        cardinality: Cardinality::Single,
        required: true,
    };
    let mut registry = Registry::default();
    registry
        .register(
            Definition {
                type_id: "math.number".into(),
                version: "2".into(),
                name: text("Number", "数値", "数值"),
                description: text("Emit a constant number", "定数を出力", "输出常数"),
                inputs: vec![],
                outputs: vec![port("value")],
                pure: true,
                property_schema: PropertySchema {
                    fields: BTreeMap::from([(
                        "value".into(),
                        PropertyDefinition {
                            name: text("Value", "値", "值"),
                            description: text("Finite constant number", "有限の定数", "有限常数"),
                            value_type: PropertyType::Float {
                                minimum: None,
                                maximum: None,
                            },
                            required: true,
                            default: Some(0.into()),
                        },
                    )]),
                    additional_properties: true,
                },
            },
            Arc::new(Number),
        )
        .unwrap();
    registry
        .register(
            Definition {
                type_id: "math.add".into(),
                version: "1".into(),
                name: text("Add", "加算", "加法"),
                description: text("Add two numbers", "2つの数値を加算", "将两个数相加"),
                inputs: vec![port("a"), port("b")],
                outputs: vec![port("value")],
                pure: true,
                property_schema: PropertySchema::default(),
            },
            Arc::new(Add),
        )
        .unwrap();
    registry
}
