use crate::*;
use serde::{Deserialize, Serialize};
use std::{collections::VecDeque, sync::Arc};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Command {
    SetDocumentExtension {
        key: String,
        value: Option<serde_json::Value>,
    },
    SetDocumentEntry {
        extension: String,
        key: String,
        value: Option<serde_json::Value>,
    },
    SetNestedDocumentExtension {
        extension: String,
        pointer: String,
        value: serde_json::Value,
    },
    SetNestedProperty {
        id: Id,
        key: String,
        pointer: String,
        value: serde_json::Value,
    },
    SetDocumentTitle {
        title: String,
    },
    AddNode {
        node: Node,
        rect: Rect,
    },
    RemoveNode {
        id: Id,
    },
    MoveNode {
        id: Id,
        rect: Rect,
    },
    Connect {
        edge: Edge,
    },
    Disconnect {
        id: Id,
    },
    SetProperty {
        id: Id,
        key: String,
        value: Option<serde_json::Value>,
    },
    SetGroup {
        id: Id,
        group: Option<Group>,
    },
    Batch {
        commands: Vec<Command>,
    },
}
impl Command {
    /// Apply without whole-graph cloning; return the inverse for rollback/history.
    fn apply(self, doc: &mut Document) -> Result<Command> {
        Ok(match self {
            Self::SetDocumentExtension { key, value } => {
                let previous = if let Some(value) = value {
                    doc.extensions.insert(key.clone(), value)
                } else {
                    doc.extensions.remove(&key)
                };
                Self::SetDocumentExtension {
                    key,
                    value: previous,
                }
            }
            Self::SetDocumentEntry {
                extension,
                key,
                value,
            } => {
                let entries = doc
                    .extensions
                    .get_mut(&extension)
                    .and_then(serde_json::Value::as_object_mut)
                    .ok_or_else(|| Error::Invalid("missing_document_store".into()))?;
                let previous = match value {
                    Some(value) => entries.insert(key.clone(), value),
                    None => entries.remove(&key),
                };
                Self::SetDocumentEntry {
                    extension,
                    key,
                    value: previous,
                }
            }
            Self::SetNestedDocumentExtension {
                extension,
                pointer,
                value,
            } => {
                let target = doc
                    .extensions
                    .get_mut(&extension)
                    .and_then(|store| store.pointer_mut(&pointer))
                    .ok_or_else(|| Error::Invalid("invalid_document_path".into()))?;
                let previous = std::mem::replace(target, value);
                Self::SetNestedDocumentExtension {
                    extension,
                    pointer,
                    value: previous,
                }
            }
            Self::SetNestedProperty {
                id,
                key,
                pointer,
                value,
            } => {
                let node = doc
                    .graph
                    .nodes
                    .get_mut(&id)
                    .ok_or_else(|| Error::Missing(id.to_string()))?;
                let property = node
                    .properties
                    .get_mut(&key)
                    .ok_or_else(|| Error::Invalid("missing_property".into()))?;
                let target = property
                    .pointer_mut(&pointer)
                    .ok_or_else(|| Error::Invalid("invalid_property_path".into()))?;
                let old = std::mem::replace(target, value);
                Self::SetNestedProperty {
                    id,
                    key,
                    pointer,
                    value: old,
                }
            }
            Self::SetDocumentTitle { title } => {
                let old = std::mem::replace(&mut doc.title, title);
                Self::SetDocumentTitle { title: old }
            }
            Self::AddNode { node, rect } => {
                let id = node.id;
                if doc.graph.nodes.contains_key(&id) {
                    return Err(Error::Duplicate(id.to_string()));
                }
                if !rect.valid() {
                    return Err(Error::Invalid("invalid rectangle".into()));
                }
                doc.graph.nodes.insert(id, node);
                doc.placement.insert(id, rect);
                Self::RemoveNode { id }
            }
            Self::RemoveNode { id } => {
                let node = doc
                    .graph
                    .nodes
                    .remove(&id)
                    .ok_or_else(|| Error::Missing(id.to_string()))?;
                let rect = doc.placement.remove(&id).unwrap_or_default();
                let mut restore = vec![Self::AddNode { node, rect }];
                let edges: Vec<_> = doc
                    .graph
                    .edges
                    .values()
                    .filter(|e| e.from.node == id || e.to.node == id)
                    .map(|e| e.id)
                    .collect();
                for edge_id in edges {
                    restore.push(Self::Connect {
                        edge: doc.graph.edges.remove(&edge_id).unwrap(),
                    });
                }
                for group in doc.graph.groups.values_mut() {
                    if group.nodes.contains(&id) {
                        restore.push(Self::SetGroup {
                            id: group.id,
                            group: Some(group.clone()),
                        });
                        group.nodes.remove(&id);
                    }
                }
                Self::Batch { commands: restore }
            }
            Self::MoveNode { id, rect } => {
                if !doc.graph.nodes.contains_key(&id) {
                    return Err(Error::Missing(id.to_string()));
                }
                if !rect.valid() {
                    return Err(Error::Invalid("invalid rectangle".into()));
                }
                let old = doc.placement.insert(id, rect).unwrap_or_default();
                Self::MoveNode { id, rect: old }
            }
            Self::Connect { edge } => {
                let id = edge.id;
                if doc.graph.edges.contains_key(&id) {
                    return Err(Error::Duplicate(id.to_string()));
                }
                doc.graph.edges.insert(id, edge);
                Self::Disconnect { id }
            }
            Self::Disconnect { id } => Self::Connect {
                edge: doc
                    .graph
                    .edges
                    .remove(&id)
                    .ok_or_else(|| Error::Missing(id.to_string()))?,
            },
            Self::SetProperty { id, key, value } => {
                let node = doc
                    .graph
                    .nodes
                    .get_mut(&id)
                    .ok_or_else(|| Error::Missing(id.to_string()))?;
                let old = match value {
                    Some(value) => node.properties.insert(key.clone(), value),
                    None => node.properties.remove(&key),
                };
                Self::SetProperty {
                    id,
                    key,
                    value: old,
                }
            }
            Self::SetGroup { id, group } => {
                if group.as_ref().is_some_and(|g| g.id != id) {
                    return Err(Error::Invalid("group id mismatch".into()));
                }
                let old = match group {
                    Some(group) => doc.graph.groups.insert(id, group),
                    None => doc.graph.groups.remove(&id),
                };
                Self::SetGroup { id, group: old }
            }
            Self::Batch { commands } => {
                let mut inverses = Vec::new();
                for command in commands {
                    match command.apply(doc) {
                        Ok(inverse) => inverses.push(inverse),
                        Err(error) => {
                            for inverse in inverses.into_iter().rev() {
                                inverse.apply(doc).expect("internal rollback invariant");
                            }
                            return Err(error);
                        }
                    }
                }
                inverses.reverse();
                Self::Batch { commands: inverses }
            }
        })
    }
}

/// Host-supplied, deterministic validation. Runs on the final state of every
/// transaction, including undo/redo. Must not perform side effects or re-enter Editor.
pub trait DocumentValidator: Send + Sync {
    fn validate(&self, document: &Document) -> Result<()>;
}

/// Limits cover undo and redo together. Bytes measure serialized command payloads,
/// not allocator overhead, the live document, or host/GPU resources.
#[derive(Debug, Clone, Copy)]
pub struct HistoryLimits {
    pub max_steps: usize,
    pub max_bytes: usize,
}
impl Default for HistoryLimits {
    fn default() -> Self {
        Self {
            max_steps: 256,
            max_bytes: 16 * 1024 * 1024,
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryStats {
    pub undo_steps: usize,
    pub redo_steps: usize,
    pub bytes: usize,
}
#[derive(Debug)]
struct HistoryEntry {
    command: Command,
    bytes: usize,
}
impl HistoryEntry {
    fn new(command: Command) -> Self {
        // Count without allocating a second serialized copy of a large command.
        struct Counter(usize);
        impl std::io::Write for Counter {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                self.0 = self.0.saturating_add(bytes.len());
                Ok(bytes.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let mut counter = Counter(0);
        let bytes = match serde_json::to_writer(&mut counter, &command) {
            Ok(()) => counter.0,
            Err(_) => usize::MAX, // Unaccountable commands are never retained.
        };
        Self { command, bytes }
    }
}

/// Single source of truth. Share this from Rust app state, never from a WebView.
pub struct Editor {
    document: Document,
    undo: VecDeque<HistoryEntry>,
    redo: VecDeque<HistoryEntry>,
    history_limits: HistoryLimits,
    history_bytes: usize,
    validator: Option<Arc<dyn DocumentValidator>>,
    revision: u64,
}
impl std::fmt::Debug for Editor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Editor")
            .field("document", &self.document)
            .field("revision", &self.revision)
            .field("history", &self.history_stats())
            .field("history_limits", &self.history_limits)
            .field("has_validator", &self.validator.is_some())
            .finish_non_exhaustive()
    }
}
impl Editor {
    /// Uses the default byte budget (16 MiB) with the supplied step limit.
    pub fn new(document: Document, history_limit: usize) -> Result<Self> {
        Self::with_history_limits(
            document,
            HistoryLimits {
                max_steps: history_limit,
                ..HistoryLimits::default()
            },
        )
    }
    pub fn with_history_limits(document: Document, history_limits: HistoryLimits) -> Result<Self> {
        document.validate()?;
        let mut document = document;
        for id in document.graph.nodes.keys() {
            document.placement.entry(*id).or_default();
        }
        Ok(Self {
            document,
            undo: VecDeque::new(),
            redo: VecDeque::new(),
            history_limits,
            history_bytes: 0,
            validator: None,
            revision: 0,
        })
    }
    /// Install before the first edit. The loaded document is validated immediately;
    /// changing schemas for an existing history requires a new editor/migration.
    pub fn with_validator(mut self, validator: Arc<dyn DocumentValidator>) -> Result<Self> {
        if self.revision != 0 {
            return Err(Error::Invalid("install validator before editing".into()));
        }
        validator.validate(&self.document)?;
        self.validator = Some(validator);
        Ok(self)
    }
    pub fn document(&self) -> &Document {
        &self.document
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn history_stats(&self) -> HistoryStats {
        HistoryStats {
            undo_steps: self.undo.len(),
            redo_steps: self.redo.len(),
            bytes: self.history_bytes,
        }
    }
    fn apply_checked(&mut self, command: Command) -> Result<Command> {
        let next_revision = self
            .revision
            .checked_add(1)
            .ok_or_else(|| Error::Invalid("revision exhausted".into()))?;
        let inverse = command.apply(&mut self.document)?;
        let validation = self.document.validate().and_then(|()| {
            self.validator
                .as_ref()
                .map_or(Ok(()), |v| v.validate(&self.document))
        });
        if let Err(error) = validation {
            inverse
                .apply(&mut self.document)
                .expect("internal rollback invariant");
            return Err(error);
        }
        self.revision = next_revision;
        Ok(inverse)
    }
    fn clear_history(&mut self) {
        self.undo.clear();
        self.redo.clear();
        self.history_bytes = 0;
    }
    fn remember(&mut self, command: Command, undo: bool) {
        if self.history_limits.max_steps == 0 || self.history_limits.max_bytes == 0 {
            self.clear_history();
            return;
        }
        let entry = HistoryEntry::new(command);
        if entry.bytes == usize::MAX || entry.bytes > self.history_limits.max_bytes {
            // A missing step is a barrier: never skip it and undo an older edit.
            self.clear_history();
            return;
        }
        // Evict oldest undo first, then farthest redo, preserving adjacent steps.
        while self.undo.len() + self.redo.len() >= self.history_limits.max_steps
            || self.history_bytes > self.history_limits.max_bytes - entry.bytes
        {
            let removed = self
                .undo
                .pop_front()
                .or_else(|| self.redo.pop_front())
                .expect("history accounting invariant");
            self.history_bytes -= removed.bytes;
        }
        self.history_bytes += entry.bytes;
        if undo {
            self.undo.push_back(entry);
        } else {
            self.redo.push_back(entry);
        }
    }
    pub fn execute(&mut self, command: Command) -> Result<u64> {
        let inverse = self.apply_checked(command)?;
        for entry in self.redo.drain(..) {
            self.history_bytes -= entry.bytes;
        }
        self.remember(inverse, true);
        Ok(self.revision)
    }
    pub fn undo(&mut self) -> Result<bool> {
        let Some(entry) = self.undo.back() else {
            return Ok(false);
        };
        // Retain history on validation failure; only remove after success.
        let inverse = self.apply_checked(entry.command.clone())?;
        self.history_bytes -= self.undo.pop_back().unwrap().bytes;
        self.remember(inverse, false);
        Ok(true)
    }
    pub fn redo(&mut self) -> Result<bool> {
        let Some(entry) = self.redo.back() else {
            return Ok(false);
        };
        let inverse = self.apply_checked(entry.command.clone())?;
        self.history_bytes -= self.redo.pop_back().unwrap().bytes;
        self.remember(inverse, true);
        Ok(true)
    }
}

/// Copy only selected nodes and internal connections. Paste allocates fresh IDs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fragment {
    nodes: Vec<(Node, Rect)>,
    edges: Vec<Edge>,
}
impl Fragment {
    pub fn copy(doc: &Document, ids: &std::collections::BTreeSet<Id>) -> Self {
        Self {
            nodes: doc
                .graph
                .nodes
                .values()
                .filter(|n| ids.contains(&n.id))
                .map(|n| {
                    (
                        n.clone(),
                        doc.placement.get(&n.id).copied().unwrap_or_default(),
                    )
                })
                .collect(),
            edges: doc
                .graph
                .edges
                .values()
                .filter(|e| ids.contains(&e.from.node) && ids.contains(&e.to.node))
                .cloned()
                .collect(),
        }
    }
    pub fn paste(&self, offset: [f32; 2]) -> Command {
        let mut ids = std::collections::BTreeMap::new();
        let mut commands = Vec::new();
        for (node, rect) in &self.nodes {
            let mut node = node.clone();
            let new = Id::new_v4();
            ids.insert(node.id, new);
            node.id = new;
            commands.push(Command::AddNode {
                node,
                rect: Rect {
                    x: rect.x + offset[0],
                    y: rect.y + offset[1],
                    ..*rect
                },
            });
        }
        for edge in &self.edges {
            // Ignore malformed clipboard edges instead of indexing untrusted IDs.
            if let (Some(from), Some(to)) = (ids.get(&edge.from.node), ids.get(&edge.to.node)) {
                commands.push(Command::Connect {
                    edge: Edge {
                        id: Id::new_v4(),
                        from: Endpoint {
                            node: *from,
                            port: edge.from.port.clone(),
                        },
                        to: Endpoint {
                            node: *to,
                            port: edge.to.port.clone(),
                        },
                    },
                });
            }
        }
        Command::Batch { commands }
    }
}

/// Deterministic left-to-right layout. A whole layout is one undo step.
pub fn auto_layout(doc: &Document, gap: [f32; 2]) -> Result<Command> {
    if gap.iter().any(|v| !v.is_finite() || *v < 0.0) {
        return Err(Error::Invalid("invalid layout gap".into()));
    }
    let mut commands = Vec::new();
    let mut x = 0.0;
    for layer in doc.graph.layers()? {
        let mut y = 0.0;
        let mut width: f32 = 0.0;
        for id in layer {
            let rect = doc.placement.get(&id).copied().unwrap_or_default();
            commands.push(Command::MoveNode {
                id,
                rect: Rect { x, y, ..rect },
            });
            y += rect.height + gap[1];
            width = width.max(rect.width);
        }
        x += width + gap[0];
    }
    Ok(Command::Batch { commands })
}
