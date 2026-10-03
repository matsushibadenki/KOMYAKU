use crate::{AcxError, Result};
use std::sync::Mutex;
use unge_core::{Command, Document, Editor, Id};

#[derive(Debug, Clone)]
pub struct Snapshot {
    pub document: Document,
    pub revision: u64,
}
impl Snapshot {
    pub fn summary(&self) -> serde_json::Value {
        serde_json::json!({"documentId":self.document.graph().id,"revision":self.revision,
            "nodes":self.document.graph().nodes().len(),"edges":self.document.graph().edges().len(),
            "groups":self.document.graph().groups().len()})
    }
}
/// Methods MUST check document ID + revision and mutate under the same lock.
/// `apply` is one undo step; `undo` must fail if that step is no longer available.
pub trait GraphHost: Send + Sync {
    fn snapshot(&self) -> Result<Snapshot>;
    fn apply(&self, document: Id, expected_revision: u64, command: Command) -> Result<Snapshot>;
    fn undo(&self, document: Id, expected_revision: u64) -> Result<Snapshot>;
}
pub fn check_snapshot(snapshot: &Snapshot, document: Id, expected_revision: u64) -> Result<()> {
    if snapshot.document.graph().id != document {
        return Err(AcxError::new(
            "document_mismatch",
            "document does not match the host",
        ));
    }
    if snapshot.revision != expected_revision {
        return Err(AcxError::new(
            "revision_conflict",
            format!("current revision is {}", snapshot.revision),
        ));
    }
    Ok(())
}
/// A standalone in-memory host for CLI/server integration. Tauri uses its Engine instead.
pub struct MemoryHost {
    editor: Mutex<Editor>,
}
impl MemoryHost {
    pub fn new(document: Document) -> Result<Self> {
        Ok(Self::from_editor(Editor::new(document, 256)?))
    }
    /// Preserve the same validator and history budget for direct and AI edits.
    pub fn from_editor(editor: Editor) -> Self {
        Self {
            editor: Mutex::new(editor),
        }
    }
}
fn snapshot(editor: &Editor) -> Snapshot {
    Snapshot {
        document: editor.document().clone(),
        revision: editor.revision(),
    }
}
impl GraphHost for MemoryHost {
    fn snapshot(&self) -> Result<Snapshot> {
        let editor = self
            .editor
            .lock()
            .map_err(|e| AcxError::new("host_unavailable", e))?;
        Ok(snapshot(&editor))
    }
    fn apply(&self, document: Id, expected_revision: u64, command: Command) -> Result<Snapshot> {
        let mut editor = self
            .editor
            .lock()
            .map_err(|e| AcxError::new("host_unavailable", e))?;
        check_snapshot(&snapshot(&editor), document, expected_revision)?;
        editor.execute(command)?;
        Ok(snapshot(&editor))
    }
    fn undo(&self, document: Id, expected_revision: u64) -> Result<Snapshot> {
        let mut editor = self
            .editor
            .lock()
            .map_err(|e| AcxError::new("host_unavailable", e))?;
        check_snapshot(&snapshot(&editor), document, expected_revision)?;
        if !editor.undo()? {
            return Err(AcxError::new(
                "recovery_unavailable",
                "undo history is unavailable",
            ));
        }
        Ok(snapshot(&editor))
    }
}
