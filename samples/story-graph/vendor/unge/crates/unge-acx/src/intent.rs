use crate::{AcxError, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use unge_core::{Command, Document, Edge, Editor, Group, Id, Properties, Rect, auto_layout};
use unge_executor::Registry;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Operation {
    CreateNode {
        id: Id,
        type_id: String,
        #[serde(default)]
        properties: Properties,
        rect: Rect,
    },
    DeleteNode {
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
    CreateGroup {
        group: Group,
    },
    DeleteGroup {
        id: Id,
    },
    AutoLayout {
        gap: [f32; 2],
    },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Intent {
    Edit {
        document_id: Id,
        expected_revision: u64,
        operations: Vec<Operation>,
    },
    Run {
        document_id: Id,
        expected_revision: u64,
    },
}
impl Intent {
    pub fn target(&self) -> (Id, u64) {
        match self {
            Self::Edit {
                document_id,
                expected_revision,
                ..
            }
            | Self::Run {
                document_id,
                expected_revision,
            } => (*document_id, *expected_revision),
        }
    }
    pub fn capability(&self) -> &'static str {
        match self {
            Self::Edit { .. } => crate::EDIT,
            Self::Run { .. } => crate::RUN,
        }
    }
}
/// Preview edits on an isolated document; the host receives one validated batch.
pub(crate) fn compile_edit(
    document: &Document,
    operations: &[Operation],
    registry: &Registry,
    create_types: &BTreeSet<String>,
) -> Result<(Command, Document)> {
    if operations.is_empty() || operations.len() > 256 {
        return Err(AcxError::new(
            "limit_exceeded",
            "edit requires 1..256 operations",
        ));
    }
    let mut preview = Editor::new(document.clone(), 0)?;
    let mut commands = Vec::new();
    for operation in operations {
        let command = match operation {
            Operation::CreateNode {
                id,
                type_id,
                properties,
                rect,
            } => {
                if !create_types.contains(type_id) {
                    return Err(AcxError::new(
                        "policy_denied",
                        format!("node creation not permitted: {type_id}"),
                    ));
                }
                let definition = registry
                    .definition(type_id)
                    .ok_or_else(|| AcxError::new("unknown_node_type", type_id))?;
                let mut node = definition.instantiate();
                node.id = *id;
                node.properties.extend(properties.clone());
                Command::AddNode { node, rect: *rect }
            }
            Operation::DeleteNode { id } => Command::RemoveNode { id: *id },
            Operation::MoveNode { id, rect } => Command::MoveNode {
                id: *id,
                rect: *rect,
            },
            Operation::Connect { edge } => Command::Connect { edge: edge.clone() },
            Operation::Disconnect { id } => Command::Disconnect { id: *id },
            Operation::SetProperty { id, key, value } => Command::SetProperty {
                id: *id,
                key: key.clone(),
                value: value.clone(),
            },
            Operation::CreateGroup { group } => {
                if preview.document().graph().groups().contains_key(&group.id) {
                    return Err(AcxError::new("invalid_graph", "group already exists"));
                }
                Command::SetGroup {
                    id: group.id,
                    group: Some(group.clone()),
                }
            }
            Operation::DeleteGroup { id } => {
                if !preview.document().graph().groups().contains_key(id) {
                    return Err(AcxError::new("invalid_graph", "group does not exist"));
                }
                Command::SetGroup {
                    id: *id,
                    group: None,
                }
            }
            Operation::AutoLayout { gap } => auto_layout(preview.document(), *gap)?,
        };
        preview.execute(command.clone())?;
        commands.push(command);
    }
    registry.validate_edit(preview.document().graph())?;
    Ok((Command::Batch { commands }, preview.document().clone()))
}
