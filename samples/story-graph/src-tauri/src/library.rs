use serde::Serialize;
use std::{
    fs::File,
    path::{Path, PathBuf},
    sync::Arc,
};
use unge_core::{Document, DocumentValidator, Id};

pub struct Library {
    pub root: PathBuf,
}
// The Rust host retains this lease for its entire lifetime, including floating panels.
pub struct WorkspaceLock {
    _file: File,
}
impl WorkspaceLock {
    pub fn acquire(directory: &Path) -> Result<Self, String> {
        let file = std::fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(directory.join(".workspace.lock"))
            .map_err(|_| "workspace_open_failed")?;
        file.try_lock().map_err(|_| "workspace_already_open")?;
        Ok(Self { _file: file })
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: String,
    title: String,
    modified: u64,
    current: bool,
    opened: bool,
    issue: Option<String>,
    default: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupEntry {
    id: String,
    title: String,
    modified: u64,
    scenes: usize,
    nodes: usize,
    issue: Option<String>,
}
fn backup_path(directory: &Path, id: &str) -> Result<PathBuf, String> {
    let parsed = Id::parse_str(id).map_err(|_| "backup_invalid")?;
    if parsed.to_string() != id {
        return Err("backup_invalid".into());
    }
    let path = directory.join(format!("backup-{id}.story.json"));
    if !std::fs::symlink_metadata(&path)
        .map_err(|_| "backup_invalid")?
        .file_type()
        .is_file()
    {
        return Err("backup_invalid".into());
    }
    Ok(path)
}
fn checked_snapshot(
    path: &Path,
    registry: Arc<unge_executor::Registry>,
) -> Result<Document, String> {
    let document = super::load(path).map_err(|_| "backup_invalid")?;
    let document =
        super::domain::migrate_hierarchy(document, &registry).map_err(|_| "backup_invalid")?;
    super::domain::Validator(registry)
        .validate(&document)
        .map_err(|_| "backup_invalid")?;
    Ok(document)
}
pub fn backups(
    directory: &Path,
    registry: Arc<unge_executor::Registry>,
) -> Result<Vec<BackupEntry>, String> {
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(directory).map_err(|_| "backup_restore_failed")? {
        let entry = entry.map_err(|_| "backup_restore_failed")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(id) = name
            .strip_prefix("backup-")
            .and_then(|name| name.strip_suffix(".story.json"))
        else {
            continue;
        };
        if Id::parse_str(id).is_err() {
            continue;
        }
        if entries.len() >= 512 {
            return Err("limit_exceeded".into());
        }
        let modified = entry
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
            .map_or(0, |time| time.as_secs());
        let result =
            backup_path(directory, id).and_then(|path| checked_snapshot(&path, registry.clone()));
        let (title, scenes, nodes, issue) = match result {
            Ok(doc) => {
                let scenes = doc
                    .graph()
                    .nodes()
                    .values()
                    .filter(|node| node.type_id == super::domain::SCENE)
                    .count();
                let nodes = doc.graph().nodes().len();
                (doc.title, scenes, nodes, None)
            }
            Err(error) => (String::new(), 0, 0, Some(error)),
        };
        entries.push(BackupEntry {
            id: id.into(),
            title,
            modified,
            scenes,
            nodes,
            issue,
        });
    }
    entries.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.id.cmp(&b.id)));
    Ok(entries)
}
impl Library {
    pub fn restore_backup(
        &self,
        source: &Path,
        id: &str,
        title: String,
        settings: super::preferences::Preferences,
        registry: Arc<unge_executor::Registry>,
    ) -> Result<PathBuf, String> {
        if title.trim().is_empty() || title.chars().count() > 200 {
            return Err("backup_title_invalid".into());
        }
        let path = backup_path(source, id)?;
        let document = checked_snapshot(&path, registry)?;
        self.restore_document(document, title, settings)
    }
    pub fn restore_document(
        &self,
        mut document: Document,
        title: String,
        settings: super::preferences::Preferences,
    ) -> Result<PathBuf, String> {
        if title.trim().is_empty() || title.chars().count() > 200 {
            return Err("backup_title_invalid".into());
        }
        document.title = title.trim().into();
        let parent = self.root.join("workspaces");
        std::fs::create_dir_all(&parent).map_err(|_| "backup_restore_failed")?;
        let directory = parent.join(Id::new_v4().to_string());
        std::fs::create_dir(&directory).map_err(|_| "backup_restore_failed")?;
        super::preferences::Store::load(directory.join("preferences.json"))?.save(settings)?;
        super::save(&directory.join("workspace.story.json"), &document)
            .map_err(|_| "backup_restore_failed")?;
        Ok(directory)
    }
    pub fn directory(&self, id: &str) -> Result<PathBuf, String> {
        if id == "default" {
            return Ok(self.root.clone());
        }
        let parsed = Id::parse_str(id).map_err(|_| "workspace_open_failed")?;
        if parsed.to_string() != id {
            return Err("workspace_open_failed".into());
        }
        let directory = self.root.join("workspaces").join(id);
        if std::fs::symlink_metadata(&directory)
            .map_err(|_| "workspace_open_failed")?
            .file_type()
            .is_symlink()
        {
            return Err("workspace_open_failed".into());
        }
        let root = self
            .root
            .canonicalize()
            .map_err(|_| "workspace_open_failed")?;
        if !directory
            .canonicalize()
            .map_err(|_| "workspace_open_failed")?
            .starts_with(root)
        {
            return Err("workspace_open_failed".into());
        }
        Ok(directory)
    }
    pub fn validated(
        &self,
        id: &str,
        registry: Arc<unge_executor::Registry>,
    ) -> Result<Document, String> {
        let directory = self.directory(id)?;
        if std::fs::symlink_metadata(directory.join("workspace.story.json"))
            .map_err(|_| "workspace_invalid")?
            .file_type()
            .is_symlink()
        {
            return Err("workspace_invalid".into());
        }
        let document = super::load(&directory.join("workspace.story.json"))
            .map_err(|_| "workspace_invalid")?;
        let document = super::domain::migrate_hierarchy(document, &registry)
            .map_err(|_| "workspace_invalid")?;
        super::domain::Validator(registry)
            .validate(&document)
            .map_err(|_| "workspace_invalid")?;
        Ok(document)
    }
    pub fn entries(
        &self,
        current: &Path,
        registry: Arc<unge_executor::Registry>,
    ) -> Result<Vec<Entry>, String> {
        let mut ids = vec!["default".to_owned()];
        let folder = self.root.join("workspaces");
        if folder.exists() {
            for item in std::fs::read_dir(folder).map_err(|_| "workspace_open_failed")? {
                let item = item.map_err(|_| "workspace_open_failed")?;
                if !item
                    .file_type()
                    .map_err(|_| "workspace_open_failed")?
                    .is_dir()
                {
                    continue;
                }
                let id = item.file_name().to_string_lossy().into_owned();
                if Id::parse_str(&id).is_ok() {
                    ids.push(id);
                }
                if ids.len() > 512 {
                    return Err("limit_exceeded".into());
                }
            }
        }
        let current = current.canonicalize().ok();
        let mut entries = Vec::new();
        for id in ids {
            let Ok(directory) = self.directory(&id) else {
                continue;
            };
            let path = directory.join("workspace.story.json");
            if !path.exists() {
                continue;
            }
            let modified = std::fs::metadata(&path)
                .ok()
                .and_then(|meta| meta.modified().ok())
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map_or(0, |time| time.as_secs());
            let is_current = current.is_some() && directory.canonicalize().ok() == current;
            let opened = if is_current {
                true
            } else {
                WorkspaceLock::acquire(&directory).is_err()
            };
            let (title, issue) = match self.validated(&id, registry.clone()) {
                Ok(doc) => (doc.title, None),
                Err(error) => (String::new(), Some(error)),
            };
            entries.push(Entry {
                default: id == "default",
                id,
                title,
                modified,
                current: is_current,
                opened,
                issue,
            });
        }
        entries.sort_by(|a, b| b.modified.cmp(&a.modified).then(a.id.cmp(&b.id)));
        Ok(entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restored_copy_preserves_graph_ids_without_touching_originals() {
        let root = std::env::temp_dir().join(format!("story-restore-{}", Id::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let library = Library { root: root.clone() };
        let registry = super::super::domain::registry();
        let doc = super::super::domain::initial_document(&registry);
        let id = Id::new_v4().to_string();
        let backup = root.join(format!("backup-{id}.story.json"));
        super::super::save(&backup, &doc).unwrap();
        let current = root.join("workspace.story.json");
        super::super::save(&current, &doc).unwrap();
        let original = std::fs::read(&backup).unwrap();
        let current_bytes = std::fs::read(&current).unwrap();
        let entries = backups(&root, registry.clone()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].scenes, 5);
        assert!(entries[0].issue.is_none());
        let directory = library
            .restore_backup(
                &root,
                &id,
                "復元した作品".into(),
                super::super::preferences::Preferences::default(),
                registry.clone(),
            )
            .unwrap();
        let restored = super::super::load(&directory.join("workspace.story.json")).unwrap();
        assert_eq!(restored.title, "復元した作品");
        assert_eq!(restored.graph(), doc.graph());
        assert_eq!(std::fs::read(&backup).unwrap(), original);
        assert_eq!(std::fs::read(&current).unwrap(), current_bytes);
        assert!(
            library
                .restore_backup(
                    &root,
                    "../workspace",
                    "test".into(),
                    super::super::preferences::Preferences::default(),
                    registry.clone()
                )
                .is_err()
        );
        assert!(
            library
                .restore_backup(
                    &root,
                    &id,
                    " ".into(),
                    super::super::preferences::Preferences::default(),
                    registry.clone()
                )
                .is_err()
        );
        std::fs::write(&backup, b"broken backup").unwrap();
        assert!(backups(&root, registry.clone()).unwrap()[0].issue.is_some());
        assert!(
            library
                .restore_backup(
                    &root,
                    &id,
                    "test".into(),
                    super::super::preferences::Preferences::default(),
                    registry
                )
                .is_err()
        );
        assert_eq!(std::fs::read(&backup).unwrap(), b"broken backup");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn library_validates_saved_projects_without_overwriting_corruption() {
        let root = std::env::temp_dir().join(format!("story-library-{}", Id::new_v4()));
        let library = Library { root: root.clone() };
        let id = Id::new_v4().to_string();
        let directory = root.join("workspaces").join(&id);
        std::fs::create_dir_all(&directory).unwrap();
        let registry = super::super::domain::registry();
        let mut doc = super::super::domain::blank_document(&registry, "ja").unwrap();
        doc.title = "星の旅".into();
        let path = directory.join("workspace.story.json");
        super::super::save(&path, &doc).unwrap();
        let entries = library.entries(&directory, registry.clone()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].title, "星の旅");
        assert!(entries[0].current);
        assert_eq!(
            library
                .validated(&id, registry.clone())
                .unwrap()
                .graph()
                .nodes()
                .len(),
            3
        );
        assert!(library.directory("../../elsewhere").is_err());
        assert!(library.directory("unknown").is_err());
        std::fs::write(&path, b"broken manuscript").unwrap();
        let entries = library.entries(&root, registry.clone()).unwrap();
        assert_eq!(entries[0].issue.as_deref(), Some("workspace_invalid"));
        assert!(library.validated(&id, registry).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"broken manuscript");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn document_lease_blocks_duplicate_hosts_and_releases_on_close() {
        let root = std::env::temp_dir().join(format!("story-lease-{}", Id::new_v4()));
        std::fs::create_dir_all(&root).unwrap();
        let lease = WorkspaceLock::acquire(&root).unwrap();
        assert!(WorkspaceLock::acquire(&root).is_err());
        drop(lease);
        assert!(WorkspaceLock::acquire(&root).is_ok());
        std::fs::remove_dir_all(root).unwrap();
    }
}
