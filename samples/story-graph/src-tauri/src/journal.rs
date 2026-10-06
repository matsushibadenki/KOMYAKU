//! Versioned byte-delta recovery contract. Runtime integration follows fault tests.
use ring::digest::{SHA256, digest};
use serde::{Deserialize, Serialize};

const LIMIT: usize = 128 * 1024 * 1024;
const RECORDS: usize = 256;
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Delta {
    version: u32,
    sequence: u64,
    before: String,
    after: String,
    offset: usize,
    removed: usize,
    inserted: Vec<u8>,
}
fn hash(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
/// The checkpoint bytes are the generation identity; replay never mutates them.
pub struct Journal {
    current: Vec<u8>,
    sequence: u64,
}
pub struct Recovery {
    pub journal: Journal,
    /// Bytes belonging to complete, verified records. Truncate an incomplete tail here.
    pub valid_bytes: usize,
    pub incomplete_tail: bool,
}
impl Journal {
    pub fn new(checkpoint: Vec<u8>) -> Result<Self, String> {
        if checkpoint.len() > LIMIT {
            return Err("limit_exceeded".into());
        }
        Ok(Self {
            current: checkpoint,
            sequence: 0,
        })
    }
    pub fn bytes(&self) -> &[u8] {
        &self.current
    }
    pub fn needs_checkpoint(&self) -> bool {
        self.sequence >= RECORDS as u64
    }
    /// Prepare without advancing: only commit after the caller syncs the record.
    pub fn prepare(&self, next: &[u8]) -> Result<Vec<u8>, String> {
        if next.len() > LIMIT || self.needs_checkpoint() {
            return Err("limit_exceeded".into());
        }
        let offset = self
            .current
            .iter()
            .zip(next)
            .take_while(|(a, b)| a == b)
            .count();
        let suffix = self.current[offset..]
            .iter()
            .rev()
            .zip(next[offset..].iter().rev())
            .take_while(|(a, b)| a == b)
            .count();
        let record = Delta {
            version: 1,
            sequence: self.sequence + 1,
            before: hash(&self.current),
            after: hash(next),
            offset,
            removed: self.current.len() - offset - suffix,
            inserted: next[offset..next.len() - suffix].to_vec(),
        };
        let mut bytes = serde_json::to_vec(&record).map_err(|_| "journal_invalid")?;
        if bytes.len() > LIMIT {
            return Err("limit_exceeded".into());
        }
        bytes.push(b'\n');
        Ok(bytes)
    }
    pub fn commit(&mut self, record: &[u8]) -> Result<(), String> {
        if record.len() > LIMIT + 1 || record.last() != Some(&b'\n') || self.needs_checkpoint() {
            return Err("journal_invalid".into());
        }
        let delta: Delta =
            serde_json::from_slice(&record[..record.len() - 1]).map_err(|_| "journal_invalid")?;
        if delta.version != 1
            || delta.sequence != self.sequence + 1
            || delta.before != hash(&self.current)
        {
            return Err("journal_invalid".into());
        }
        let end = delta
            .offset
            .checked_add(delta.removed)
            .filter(|&n| n <= self.current.len())
            .ok_or("journal_invalid")?;
        let size = self.current.len() - delta.removed;
        if size
            .checked_add(delta.inserted.len())
            .is_none_or(|n| n > LIMIT)
        {
            return Err("limit_exceeded".into());
        }
        let mut next = Vec::with_capacity(size + delta.inserted.len());
        next.extend_from_slice(&self.current[..delta.offset]);
        next.extend_from_slice(&delta.inserted);
        next.extend_from_slice(&self.current[end..]);
        if hash(&next) != delta.after {
            return Err("journal_invalid".into());
        }
        self.current = next;
        self.sequence = delta.sequence;
        Ok(())
    }
    pub fn recover(checkpoint: Vec<u8>, records: &[u8]) -> Result<Recovery, String> {
        if records.len() > LIMIT {
            return Err("limit_exceeded".into());
        }
        let mut journal = Self::new(checkpoint)?;
        let mut valid_bytes = 0;
        for line in records.split_inclusive(|b| *b == b'\n') {
            if line.last() != Some(&b'\n') {
                break;
            }
            journal.commit(line)?;
            valid_bytes += line.len();
        }
        Ok(Recovery {
            journal,
            valid_bytes,
            incomplete_tail: valid_bytes != records.len(),
        })
    }
}
// Only mutable workspaces use sidecars. Backup and history snapshots remain standalone.
fn sidecar(path: &std::path::Path, checkpoint: &[u8]) -> std::path::PathBuf {
    path.with_file_name(format!(".workspace-{}.journal", hash(checkpoint)))
}
fn bounded_read(path: &std::path::Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take(LIMIT as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > LIMIT {
        return Err("limit_exceeded".into());
    }
    Ok(bytes)
}
pub fn read_workspace(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let checkpoint = bounded_read(path)?;
    if path.file_name().is_none_or(|n| n != "workspace.story.json") {
        return Ok(checkpoint);
    }
    let journal_path = sidecar(path, &checkpoint);
    match bounded_read(&journal_path) {
        Ok(records) => Ok(Journal::recover(checkpoint, &records)?.journal.current),
        Err(_) if !journal_path.exists() => Ok(checkpoint),
        Err(error) => Err(error),
    }
}
pub fn modified(path: &std::path::Path) -> Result<std::time::SystemTime, String> {
    let checkpoint = bounded_read(path)?;
    let base = std::fs::metadata(path)
        .and_then(|m| m.modified())
        .map_err(|e| e.to_string())?;
    let journal = std::fs::metadata(sidecar(path, &checkpoint)).and_then(|m| m.modified());
    Ok(journal.map_or(base, |time| time.max(base)))
}
#[derive(PartialEq, Eq)]
struct Stamp {
    length: u64,
    modified: Option<std::time::SystemTime>,
    #[cfg(unix)]
    inode: u64,
}
fn stamp(path: &std::path::Path) -> Option<Stamp> {
    let meta = std::fs::metadata(path).ok()?;
    #[cfg(unix)]
    use std::os::unix::fs::MetadataExt;
    Some(Stamp {
        length: meta.len(),
        modified: meta.modified().ok(),
        #[cfg(unix)]
        inode: meta.ino(),
    })
}
struct Cache {
    path: std::path::PathBuf,
    journal_path: std::path::PathBuf,
    checkpoint_stamp: Option<Stamp>,
    journal_stamp: Option<Stamp>,
    recovery: Recovery,
    generation: Option<String>,
}
#[derive(Default)]
pub struct Store {
    cache: Option<Cache>,
}
pub fn save_workspace(
    path: &std::path::Path,
    document: &unge_core::Document,
) -> Result<(), String> {
    Store::default().save(path, document)
}
impl Store {
    pub fn save(
        &mut self,
        path: &std::path::Path,
        document: &unge_core::Document,
    ) -> Result<(), String> {
        use std::io::Write;
        document.validate().map_err(|e| e.to_string())?;
        if path.file_name().is_none_or(|n| n != "workspace.story.json") || !path.exists() {
            self.cache = None;
            return crate::persistence::save(path, document).map(|_| ());
        }
        let mut cache = match self.cache.take() {
            Some(cache)
                if cache.path == path
                    && cache.checkpoint_stamp == stamp(path)
                    && cache.journal_stamp == stamp(&cache.journal_path) =>
            {
                cache
            }
            _ => {
                let checkpoint = bounded_read(path)?;
                let journal_path = sidecar(path, &checkpoint);
                let records = if journal_path.exists() {
                    bounded_read(&journal_path)?
                } else {
                    vec![]
                };
                let recovery = Journal::recover(checkpoint, &records)?;
                let previous: crate::SavedWorkspace =
                    serde_json::from_slice(recovery.journal.bytes())
                        .map_err(|_| "journal_invalid")?;
                Cache {
                    path: path.into(),
                    checkpoint_stamp: stamp(path),
                    journal_stamp: stamp(&journal_path),
                    journal_path,
                    recovery,
                    generation: previous.generation,
                }
            }
        };
        let recovery = &mut cache.recovery;
        #[derive(Serialize)]
        struct Snapshot<'a> {
            #[serde(skip_serializing_if = "Option::is_none")]
            generation: &'a Option<String>,
            format: &'static str,
            version: u32,
            document: &'a unge_core::Document,
        }
        let next = serde_json::to_vec(&Snapshot {
            generation: &cache.generation,
            format: "komyaku-story-workspace",
            version: 1,
            document,
        })
        .map_err(|e| e.to_string())?;
        if next.len() > LIMIT {
            return Err("limit_exceeded".into());
        }
        if next == recovery.journal.bytes() {
            self.cache = Some(cache);
            return Ok(());
        }
        let delta = recovery.journal.prepare(&next);
        // Bound replay cost and disk growth. A new checkpoint chooses a new hash generation.
        let delta = match delta {
            Ok(delta)
                if delta.len() < next.len() / 2
                    && recovery.valid_bytes + delta.len() < 4 * 1024 * 1024 =>
            {
                delta
            }
            _ => {
                crate::persistence::save(path, document)?;
                // Old generations cannot apply to the new checkpoint, even after a crash here.
                let _ = std::fs::remove_file(&cache.journal_path);
                return Ok(());
            }
        };
        let mut options = std::fs::OpenOptions::new();
        options.create(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options
            .open(&cache.journal_path)
            .map_err(|e| e.to_string())?;
        if recovery.incomplete_tail {
            file.set_len(recovery.valid_bytes as u64)
                .map_err(|e| e.to_string())?;
        }
        use std::io::{Seek, SeekFrom};
        file.seek(SeekFrom::End(0)).map_err(|e| e.to_string())?;
        file.write_all(&delta).map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        std::fs::File::open(path.parent().unwrap_or(std::path::Path::new(".")))
            .and_then(|f| f.sync_all())
            .map_err(|e| e.to_string())?;
        recovery.journal.commit(&delta)?;
        recovery.valid_bytes += delta.len();
        recovery.incomplete_tail = false;
        cache.journal_stamp = stamp(&cache.journal_path);
        self.cache = Some(cache);
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cached_saves_advance_and_external_changes_invalidate_the_cache() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.story.json");
        let mut doc = unge_core::Document::default();
        doc.title = "雨".repeat(10000);
        let mut store = Store::default();
        store.save(&path, &doc).unwrap();
        doc.title.push('一');
        store.save(&path, &doc).unwrap();
        assert_eq!(store.cache.as_ref().unwrap().recovery.journal.sequence, 1);
        doc.title.push('二');
        store.save(&path, &doc).unwrap();
        assert_eq!(store.cache.as_ref().unwrap().recovery.journal.sequence, 2);
        assert_eq!(crate::load(&path).unwrap(), doc);
        let active = store.cache.as_ref().unwrap().journal_path.clone();
        std::fs::write(&active, b"broken\n").unwrap();
        assert!(store.save(&path, &doc).is_err());
        assert!(store.cache.is_none());
        std::fs::remove_file(&active).unwrap();
        store.save(&path, &doc).unwrap();
        assert_eq!(crate::load(&path).unwrap(), doc);
        let mut replacement = doc.clone();
        replacement.title = "別原稿".repeat(10000);
        crate::persistence::save(&path, &replacement).unwrap();
        replacement.title.push('三');
        store.save(&path, &replacement).unwrap();
        assert_eq!(crate::load(&path).unwrap(), replacement);
        assert_eq!(store.cache.as_ref().unwrap().recovery.journal.sequence, 1);
    }
    #[test]
    fn durable_save_reopens_latest_and_repairs_a_torn_tail() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.story.json");
        let mut doc = unge_core::Document::default();
        doc.title = "雨".repeat(10000);
        save_workspace(&path, &doc).unwrap();
        let checkpoint = std::fs::read(&path).unwrap();
        doc.title.push_str("第一稿");
        save_workspace(&path, &doc).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), checkpoint);
        assert_eq!(crate::load(&path).unwrap(), doc);
        let journal_path = sidecar(&path, &checkpoint);
        let length = std::fs::metadata(&journal_path).unwrap().len();
        assert!(length < 1000);
        std::fs::OpenOptions::new()
            .append(true)
            .open(&journal_path)
            .unwrap()
            .write_all(b"{broken tail")
            .unwrap();
        assert_eq!(crate::load(&path).unwrap(), doc);
        doc.title.push_str("第二稿");
        save_workspace(&path, &doc).unwrap();
        assert_eq!(crate::load(&path).unwrap(), doc);
        let records = std::fs::read(&journal_path).unwrap();
        assert!(
            !Journal::recover(checkpoint, &records)
                .unwrap()
                .incomplete_tail
        );
        let backup = dir.path().join("backup-test.story.json");
        save_workspace(&backup, &doc).unwrap();
        assert_eq!(crate::load(&backup).unwrap(), doc);
    }
    #[test]
    fn checkpoint_rotation_rejects_stale_generation_and_preserves_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.story.json");
        let mut doc = unge_core::Document::default();
        doc.title = "a".repeat(10000);
        save_workspace(&path, &doc).unwrap();
        let base = std::fs::read(&path).unwrap();
        doc.title.push('b');
        save_workspace(&path, &doc).unwrap();
        let old_path = sidecar(&path, &base);
        let old_records = std::fs::read(&old_path).unwrap();
        doc.title = "c".repeat(10000);
        save_workspace(&path, &doc).unwrap();
        assert_ne!(std::fs::read(&path).unwrap(), base);
        // Simulate crash before old-generation cleanup.
        std::fs::write(&old_path, &old_records).unwrap();
        assert_eq!(crate::load(&path).unwrap(), doc);
        doc.title.push('d');
        save_workspace(&path, &doc).unwrap();
        let checkpoint = std::fs::read(&path).unwrap();
        let active = sidecar(&path, &checkpoint);
        std::fs::write(&active, b"broken\n").unwrap();
        assert!(crate::load(&path).is_err());
        assert!(save_workspace(&path, &doc).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), checkpoint);
        assert_eq!(std::fs::read(&active).unwrap(), b"broken\n");
    }
    #[test]
    fn unicode_delta_is_small_and_preparation_does_not_advance() {
        let base = "雨".repeat(1_000_000).into_bytes();
        let mut changed = base.clone();
        changed.splice(1_500_000..1_500_003, "👨‍👩‍👧‍👦e\u{301}".bytes());
        let mut journal = Journal::new(base.clone()).unwrap();
        let delta = journal.prepare(&changed).unwrap();
        assert!(delta.len() < 1000);
        assert_eq!(journal.bytes(), base);
        journal.commit(&delta).unwrap();
        assert_eq!(journal.bytes(), changed);
        let recovered = Journal::recover(base, &delta).unwrap();
        assert_eq!(recovered.journal.bytes(), changed);
        assert!(!recovered.incomplete_tail);
    }
    #[test]
    fn every_incomplete_tail_recovers_only_the_last_durable_record() {
        let mut journal = Journal::new(b"initial".to_vec()).unwrap();
        let first = journal.prepare(b"one").unwrap();
        journal.commit(&first).unwrap();
        let second = journal.prepare(b"two").unwrap();
        for cut in 0..second.len() {
            let records = [first.as_slice(), &second[..cut]].concat();
            let recovery = Journal::recover(b"initial".to_vec(), &records).unwrap();
            assert_eq!(recovery.journal.bytes(), b"one");
            assert_eq!(recovery.valid_bytes, first.len());
            assert_eq!(recovery.incomplete_tail, cut != 0);
        }
    }
    #[test]
    fn corruption_wrong_generation_reorder_and_replay_are_rejected() {
        let mut journal = Journal::new(b"base".to_vec()).unwrap();
        let first = journal.prepare(b"one").unwrap();
        journal.commit(&first).unwrap();
        let second = journal.prepare(b"two").unwrap();
        assert!(Journal::recover(b"other".to_vec(), &first).is_err());
        assert!(Journal::recover(b"base".to_vec(), &second).is_err());
        assert!(journal.commit(&first).is_err());
        let mut value: serde_json::Value = serde_json::from_slice(&second).unwrap();
        value["inserted"] = serde_json::json!([120]);
        let mut bad = serde_json::to_vec(&value).unwrap();
        bad.push(b'\n');
        assert!(journal.commit(&bad).is_err());
        assert_eq!(journal.bytes(), b"one");
        assert!(Journal::recover(b"base".to_vec(), b"broken\n").is_err());
    }
    #[test]
    fn checkpoint_boundary_and_empty_insert_delete_roundtrip() {
        let mut journal = Journal::new(vec![]).unwrap();
        let mut records = vec![];
        for i in 0..RECORDS {
            let next = if i % 2 == 0 {
                b"text".as_slice()
            } else {
                b"".as_slice()
            };
            let delta = journal.prepare(next).unwrap();
            journal.commit(&delta).unwrap();
            records.extend(delta);
        }
        assert!(journal.needs_checkpoint());
        assert!(journal.prepare(b"new").is_err());
        assert!(
            Journal::recover(vec![], &records)
                .unwrap()
                .journal
                .needs_checkpoint()
        );
        let restarted = Journal::new(journal.bytes().to_vec()).unwrap();
        assert!(!restarted.needs_checkpoint());
    }
}
