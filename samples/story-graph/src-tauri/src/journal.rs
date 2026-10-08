//! Versioned byte-delta persistence with bounded, verified recovery.
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
    current_hash: String,
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
        let current_hash = hash(&checkpoint);
        Ok(Self {
            current_hash,
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
    #[cfg(test)]
    pub fn prepare(&self, next: &[u8]) -> Result<Vec<u8>, String> {
        self.prepare_hashed(next).map(|(bytes, _)| bytes)
    }
    fn prepare_hashed(&self, next: &[u8]) -> Result<(Vec<u8>, String), String> {
        if next.len() > LIMIT || self.needs_checkpoint() {
            return Err("limit_exceeded".into());
        }
        let common = self.current.len().min(next.len());
        let mut offset = 0;
        while offset + 1024 <= common
            && self.current[offset..offset + 1024] == next[offset..offset + 1024]
        {
            offset += 1024;
        }
        offset += self.current[offset..]
            .iter()
            .zip(&next[offset..])
            .take_while(|(a, b)| a == b)
            .count();
        let mut suffix = 0;
        while suffix + 1024 <= common - offset
            && self.current[self.current.len() - suffix - 1024..self.current.len() - suffix]
                == next[next.len() - suffix - 1024..next.len() - suffix]
        {
            suffix += 1024;
        }
        suffix += self.current[offset..self.current.len() - suffix]
            .iter()
            .rev()
            .zip(next[offset..next.len() - suffix].iter().rev())
            .take_while(|(a, b)| a == b)
            .count();
        let after = hash(next);
        let record = Delta {
            version: 1,
            sequence: self.sequence + 1,
            before: self.current_hash.clone(),
            after: after.clone(),
            offset,
            removed: self.current.len() - offset - suffix,
            inserted: next[offset..next.len() - suffix].to_vec(),
        };
        let mut bytes = serde_json::to_vec(&record).map_err(|_| "journal_invalid")?;
        if bytes.len() > LIMIT {
            return Err("limit_exceeded".into());
        }
        bytes.push(b'\n');
        Ok((bytes, after))
    }
    pub fn commit(&mut self, record: &[u8]) -> Result<(), String> {
        if record.len() > LIMIT + 1 || record.last() != Some(&b'\n') || self.needs_checkpoint() {
            return Err("journal_invalid".into());
        }
        let delta: Delta =
            serde_json::from_slice(&record[..record.len() - 1]).map_err(|_| "journal_invalid")?;
        if delta.version != 1
            || delta.sequence != self.sequence + 1
            || delta.before != self.current_hash
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
        self.current_hash = delta.after;
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
// Cache only verified structure; paragraph updates replace small values in place.
struct Structure {
    envelope: String,
    nodes: std::collections::BTreeMap<unge_core::Id, unge_core::Node>,
}
fn envelope(doc: &unge_core::Document) -> String {
    serde_json::to_string(&(
        &doc.title,
        doc.schema_version,
        &doc.engine_version,
        &doc.plugin_versions,
        doc.graph().id,
        &doc.graph().name,
        doc.graph().edges(),
        doc.graph().groups(),
        doc.placement(),
    ))
    .expect("validated document metadata")
}
impl Structure {
    fn new(doc: &unge_core::Document) -> Self {
        Self {
            envelope: envelope(doc),
            nodes: doc.graph().nodes().clone(),
        }
    }
    fn matches(
        &self,
        doc: &unge_core::Document,
        patches: &[(serde_json::Value, serde_json::Value)],
    ) -> bool {
        use serde_json::Value;
        if self.envelope != envelope(doc) || self.nodes.len() != doc.graph().nodes().len() {
            return false;
        }
        let mut lookup = std::collections::BTreeMap::new();
        for (index, (old, new)) in patches.iter().enumerate() {
            if old["type"] != "paragraph" || new["type"] != "paragraph" || old["id"] != new["id"] {
                return false;
            }
            let Some(id) = old["id"].as_str() else {
                return false;
            };
            if lookup.insert(id, (index, old, new)).is_some() {
                return false;
            }
        }
        let mut seen = vec![0; patches.len()];
        fn equal(
            a: &Value,
            b: &Value,
            lookup: &std::collections::BTreeMap<&str, (usize, &Value, &Value)>,
            seen: &mut [usize],
        ) -> bool {
            if a["type"] == "paragraph" {
                if let Some((index, old, new)) = a["id"].as_str().and_then(|id| lookup.get(id)) {
                    seen[*index] += 1;
                    return a == *old && b == *new;
                }
                return a == b;
            }
            if a == b {
                return true;
            }
            match (a, b) {
                (Value::Object(a), Value::Object(b)) => {
                    a.len() == b.len()
                        && a.iter()
                            .all(|(k, v)| b.get(k).is_some_and(|w| equal(v, w, lookup, seen)))
                }
                (Value::Array(a), Value::Array(b)) => {
                    a.len() == b.len() && a.iter().zip(b).all(|(v, w)| equal(v, w, lookup, seen))
                }
                _ => false,
            }
        }
        self.nodes.iter().all(|(id, a)| {
            doc.graph().nodes().get(id).is_some_and(|b| {
                a.id == b.id
                    && a.type_id == b.type_id
                    && a.inputs == b.inputs
                    && a.outputs == b.outputs
                    && a.properties.len() == b.properties.len()
                    && a.properties.iter().all(|(k, v)| {
                        b.properties
                            .get(k)
                            .is_some_and(|w| equal(v, w, &lookup, &mut seen))
                    })
            })
        }) && seen.iter().all(|count| *count == 1)
    }
    fn advance(&mut self, patches: &[(serde_json::Value, serde_json::Value)]) {
        fn replace(
            value: &mut serde_json::Value,
            patches: &[(serde_json::Value, serde_json::Value)],
        ) {
            if value["type"] == "paragraph" {
                if let Some((_, new)) = patches.iter().find(|(old, _)| old == value) {
                    *value = new.clone();
                }
                return;
            }
            match value {
                serde_json::Value::Object(map) => {
                    for v in map.values_mut() {
                        replace(v, patches);
                    }
                }
                serde_json::Value::Array(items) => {
                    for v in items {
                        replace(v, patches);
                    }
                }
                _ => {}
            }
        }
        for node in self.nodes.values_mut() {
            for value in node.properties.values_mut() {
                replace(value, patches);
            }
        }
    }
}
struct Cache {
    path: std::path::PathBuf,
    journal_path: std::path::PathBuf,
    checkpoint_stamp: Option<Stamp>,
    journal_stamp: Option<Stamp>,
    recovery: Recovery,
    generation: Option<String>,
    structure: Structure,
}
// Transform only supplied paragraph objects; accept only an exact canonical result.
fn patched_bytes(
    current: &[u8],
    document: &unge_core::Document,
    patches: &[(serde_json::Value, serde_json::Value)],
    structure: Option<&Structure>,
) -> Option<Vec<u8>> {
    if patches.is_empty() || patches.len() > 64 {
        return None;
    }
    let text = std::str::from_utf8(current).ok()?;
    let mut spans = Vec::new();
    let mut converted = 0usize;
    for (old, new) in patches {
        let old = serde_json::to_string(old).ok()?;
        let new = serde_json::to_vec(new).ok()?;
        converted = converted.checked_add(old.len() + new.len())?;
        if converted > current.len() / 4 {
            return None;
        }
        let mut matches = text.match_indices(&old);
        let offset = matches.next()?.0;
        if matches.next().is_some() {
            return None;
        }
        spans.push((offset, offset + old.len(), new));
    }
    spans.sort_by_key(|s| s.0);
    let mut next = Vec::with_capacity(current.len() + 1024);
    let mut cursor = 0;
    for (start, end, bytes) in spans {
        if start < cursor {
            return None;
        }
        next.extend_from_slice(&current[cursor..start]);
        next.extend(bytes);
        cursor = end;
        if next.len() > LIMIT {
            return None;
        }
    }
    next.extend_from_slice(&current[cursor..]);
    if next.len() > LIMIT {
        return None;
    }
    if let Some(structure) = structure {
        if !structure.matches(document, patches) {
            return None;
        }
    } else {
        let saved: crate::SavedWorkspace = serde_json::from_slice(&next).ok()?;
        if saved.document != *document {
            return None;
        }
    }
    Some(next)
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
fn sync_workspace(path: &std::path::Path, journal: &std::path::Path) -> Result<(), String> {
    std::fs::File::open(path)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    match std::fs::File::open(journal) {
        Ok(file) => file.sync_all().map_err(|e| e.to_string())?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    std::fs::File::open(path.parent().unwrap_or(std::path::Path::new(".")))
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())
}
impl Store {
    pub fn save(
        &mut self,
        path: &std::path::Path,
        document: &unge_core::Document,
    ) -> Result<(), String> {
        self.save_patched(path, document, &[])
    }
    pub fn save_patched(
        &mut self,
        path: &std::path::Path,
        document: &unge_core::Document,
        patches: &[(serde_json::Value, serde_json::Value)],
    ) -> Result<(), String> {
        self.save_with_sync(path, document, patches, sync_workspace)
    }
    fn save_with_sync(
        &mut self,
        path: &std::path::Path,
        document: &unge_core::Document,
        patches: &[(serde_json::Value, serde_json::Value)],
        mut sync: impl FnMut(&std::path::Path, &std::path::Path) -> Result<(), String>,
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
                    structure: Structure::new(&previous.document),
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
        let partial = patched_bytes(
            recovery.journal.bytes(),
            document,
            patches,
            Some(&cache.structure),
        );
        let used_partial = partial.is_some();
        let next = if let Some(bytes) = partial {
            bytes
        } else {
            let mut next = Vec::with_capacity(recovery.journal.bytes().len().saturating_add(1024));
            serde_json::to_writer(
                &mut next,
                &Snapshot {
                    generation: &cache.generation,
                    format: "komyaku-story-workspace",
                    version: 1,
                    document,
                },
            )
            .map_err(|e| e.to_string())?;
            next
        };
        if next.len() > LIMIT {
            return Err("limit_exceeded".into());
        }
        if next == recovery.journal.bytes() {
            // An earlier fsync may have failed after publishing all bytes.
            // Equality alone does not establish durability.
            sync(path, &cache.journal_path)?;
            self.cache = Some(cache);
            return Ok(());
        }
        let delta = recovery.journal.prepare_hashed(&next);
        // Bound replay cost and disk growth. A new checkpoint chooses a new hash generation.
        let (delta, after_hash) = match delta {
            Ok((delta, after_hash))
                if delta.len() < next.len() / 2
                    && recovery.valid_bytes + delta.len() < 4 * 1024 * 1024 =>
            {
                (delta, after_hash)
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
        sync(path, &cache.journal_path)?;
        // prepare already computed both digests from these validated bytes.
        // After durable publication, adopt the exact source instead of parsing,
        // hashing and allocating the whole document again through replay.
        recovery.journal.current = next;
        recovery.journal.current_hash = after_hash;
        recovery.journal.sequence += 1;
        recovery.valid_bytes += delta.len();
        recovery.incomplete_tail = false;
        if used_partial {
            cache.structure.advance(patches);
        } else {
            cache.structure = Structure::new(document);
        }
        cache.journal_stamp = stamp(&cache.journal_path);
        self.cache = Some(cache);
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retry_after_sync_failure_requires_sync_even_when_bytes_match() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.story.json");
        let mut doc = unge_core::Document::default();
        doc.title = "雨".repeat(10000);
        let mut store = Store::default();
        store.save(&path, &doc).unwrap();
        doc.title.push_str("改稿");
        let error = store
            .save_with_sync(&path, &doc, &[], |_, _| Err("injected_sync_failure".into()))
            .unwrap_err();
        assert_eq!(error, "injected_sync_failure");
        assert!(store.cache.is_none());
        // Complete bytes are readable, but the preceding save was not acknowledged.
        assert_eq!(crate::load(&path).unwrap(), doc);
        let checkpoint = std::fs::read(&path).unwrap();
        let journal = sidecar(&path, &checkpoint);
        let records = std::fs::read(&journal).unwrap();
        let mut calls = 0;
        assert!(
            store
                .save_with_sync(&path, &doc, &[], |_, _| {
                    calls += 1;
                    Err("still_failing".into())
                })
                .is_err()
        );
        assert_eq!(calls, 1);
        assert!(store.cache.is_none());
        store
            .save_with_sync(&path, &doc, &[], |p, j| {
                calls += 1;
                sync_workspace(p, j)
            })
            .unwrap();
        assert_eq!(calls, 2);
        assert!(store.cache.is_some());
        assert_eq!(std::fs::read(journal).unwrap(), records);
        assert_eq!(crate::load(&path).unwrap(), doc);
    }
    #[test]
    fn unchanged_checkpoint_also_requires_durable_acknowledgement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.story.json");
        let doc = unge_core::Document::default();
        crate::persistence::save(&path, &doc).unwrap();
        let mut store = Store::default();
        assert!(
            store
                .save_with_sync(&path, &doc, &[], |_, _| Err(
                    "injected_directory_sync_failure".into()
                ))
                .is_err()
        );
        assert!(store.cache.is_none());
        store.save(&path, &doc).unwrap();
        assert_eq!(crate::load(&path).unwrap(), doc);
    }
    #[test]
    #[ignore = "manual paragraph serialization benchmark"]
    fn benchmark_paragraph_saves() {
        let registry = crate::domain::registry();
        let initial = crate::domain::initial_document(&registry);
        let id = initial
            .graph()
            .nodes()
            .values()
            .find(|n| n.type_id == crate::domain::SCENE)
            .unwrap()
            .id
            .to_string();
        let mut value = serde_json::to_value(&initial).unwrap();
        let canonical = &mut value["graph"]["nodes"][&id]["properties"]["canonical"];
        let template = canonical["content"][0].clone();
        canonical["content"] = serde_json::json!((0..1000).map(|_| {
            let mut paragraph = template.clone();
            paragraph["id"] = serde_json::json!(unge_core::Id::new_v4());
            paragraph["content"] = serde_json::json!([{"type":"text","text":"雨".repeat(1000),"marks":[],"metadata":{},"extensions":{}}]);
            paragraph
        }).collect::<Vec<_>>());
        for mode in ["full_serializer", "paragraph_serializer"] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("workspace.story.json");
            let mut current = value.clone();
            let doc: unge_core::Document = serde_json::from_value(current.clone()).unwrap();
            let mut store = Store::default();
            store.save(&path, &doc).unwrap();
            let mut times = vec![];
            for i in 0..10 {
                let old = current["graph"]["nodes"][&id]["properties"]["canonical"]["content"][50]
                    .clone();
                current["graph"]["nodes"][&id]["properties"]["canonical"]["content"][50]["content"]
                    [0]["text"] = serde_json::json!(format!("{}改稿{i}", "雨".repeat(1000)));
                let new = current["graph"]["nodes"][&id]["properties"]["canonical"]["content"][50]
                    .clone();
                let doc: unge_core::Document = serde_json::from_value(current.clone()).unwrap();
                if mode == "paragraph_serializer" {
                    let bytes = read_workspace(&path).unwrap();
                    assert!(
                        patched_bytes(&bytes, &doc, &[(old.clone(), new.clone())], None).is_some()
                    );
                }
                let start = std::time::Instant::now();
                if mode == "full_serializer" {
                    store.save(&path, &doc).unwrap();
                } else {
                    store.save_patched(&path, &doc, &[(old, new)]).unwrap();
                }
                times.push(start.elapsed().as_secs_f64() * 1000.);
                assert_eq!(crate::load(&path).unwrap(), doc);
            }
            times.sort_by(f64::total_cmp);
            println!("{mode}: median_ms={:.3}", (times[4] + times[5]) / 2.);
        }
    }
    #[test]
    fn paragraph_only_serialization_matches_canonical_document_and_falls_back_safely() {
        fn paragraph(value: &mut serde_json::Value) -> Option<&mut serde_json::Value> {
            if value["type"] == "paragraph" {
                return Some(value);
            }
            match value {
                serde_json::Value::Object(map) => map.values_mut().find_map(paragraph),
                serde_json::Value::Array(items) => items.iter_mut().find_map(paragraph),
                _ => None,
            }
        }
        let registry = crate::domain::registry();
        let mut doc = crate::domain::initial_document(&registry);
        doc.title = "雨".repeat(10000);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.story.json");
        let mut store = Store::default();
        store.save(&path, &doc).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let mut value = serde_json::to_value(&doc).unwrap();
        let p = paragraph(&mut value).unwrap();
        let old = p.clone();
        p["content"] = serde_json::json!([{"type":"text","text":"雨 👨‍👩‍👧‍👦 e\u{301}\n次の行","marks":[],"metadata":{},"extensions":{}}]);
        let new = p.clone();
        let next: unge_core::Document = serde_json::from_value(value).unwrap();
        let patches = vec![(old.clone(), new.clone())];
        assert!(patched_bytes(&bytes, &next, &patches, None).is_some());
        let mut structure = Structure::new(&doc);
        assert!(patched_bytes(&bytes, &next, &patches, Some(&structure)).is_some());
        assert!(!structure.matches(&next, &[]));
        let mut hidden_change = serde_json::to_value(&next).unwrap();
        let nodes = hidden_change["graph"]["nodes"].as_object_mut().unwrap();
        let node = nodes.values_mut().next().unwrap();
        node["properties"]["unlisted"] = serde_json::json!("must survive fallback");
        let hidden_change = serde_json::from_value(hidden_change).unwrap();
        assert!(patched_bytes(&bytes, &hidden_change, &patches, Some(&structure)).is_none());
        assert!(!structure.matches(&next, &[patches[0].clone(), patches[0].clone()]));
        structure.advance(&patches);
        assert_eq!(structure.nodes, *next.graph().nodes());
        assert!(structure.matches(&next, &[]));

        assert!(
            patched_bytes(
                &bytes,
                &next,
                &[(old.clone(), new.clone()), (old, new)],
                None
            )
            .is_none()
        );
        let mut other = next.clone();
        other.title.push_str("別の変更");
        assert!(patched_bytes(&bytes, &other, &patches, None).is_none());
        assert!(!Structure::new(&doc).matches(&other, &patches));
        store.save_patched(&path, &next, &patches).unwrap();
        assert_eq!(crate::load(&path).unwrap(), next);
        assert!(store.cache.as_ref().unwrap().structure.matches(&next, &[]));
        // Stale patch must save all other changes through the full serializer.
        store.save_patched(&path, &other, &patches).unwrap();
        assert_eq!(crate::load(&path).unwrap(), other);
    }
    #[test]
    fn cached_digest_stays_consistent_through_success_failure_and_recovery() {
        let mut journal = Journal::new("初稿".as_bytes().to_vec()).unwrap();
        assert_eq!(journal.current_hash, hash(journal.bytes()));
        let mut records = vec![];
        for next in ["改稿 👨‍👩‍👧‍👦", "", "最終稿 e\u{301}"] {
            let (record, after) = journal.prepare_hashed(next.as_bytes()).unwrap();
            assert_eq!(journal.current_hash, hash(journal.bytes()));
            journal.commit(&record).unwrap();
            assert_eq!(journal.current_hash, after);
            assert_eq!(after, hash(journal.bytes()));
            let before = journal.current_hash.clone();
            assert!(journal.commit(&record).is_err());
            assert_eq!(journal.current_hash, before);
            records.extend(record);
        }
        let recovered = Journal::recover("初稿".as_bytes().to_vec(), &records).unwrap();
        assert_eq!(recovered.journal.current_hash, journal.current_hash);
        assert_eq!(
            recovered.journal.current_hash,
            hash(recovered.journal.bytes())
        );
    }
    #[test]
    fn chunk_boundaries_insert_delete_and_identical_bytes_replay_exactly() {
        let base = vec![b'a'; 5000];
        for offset in [0, 1, 1023, 1024, 1025, 2048, 4999, 5000] {
            for removed in [0, 1, 1024] {
                if offset + removed > base.len() {
                    continue;
                }
                for inserted in [b"".as_slice(), b"xy", "雨👨‍👩‍👧‍👦".as_bytes()] {
                    let mut next = base.clone();
                    next.splice(offset..offset + removed, inserted.iter().copied());
                    let mut journal = Journal::new(base.clone()).unwrap();
                    let record = journal.prepare(&next).unwrap();
                    journal.commit(&record).unwrap();
                    assert_eq!(journal.bytes(), next);
                }
            }
        }
    }
    #[test]
    #[ignore = "manual real-file saving benchmark"]
    fn benchmark_cached_saves() {
        fn fill(value: &mut serde_json::Value) -> bool {
            if value["type"] == "text" && value["text"].is_string() {
                value["text"] = serde_json::json!("雨".repeat(1_000_000));
                return true;
            }
            match value {
                serde_json::Value::Object(map) => map.values_mut().any(fill),
                serde_json::Value::Array(items) => items.iter_mut().any(fill),
                _ => false,
            }
        }
        let registry = crate::domain::registry();
        let mut value = serde_json::to_value(crate::domain::initial_document(&registry)).unwrap();
        assert!(fill(&mut value));
        let initial: unge_core::Document = serde_json::from_value(value).unwrap();
        for mode in ["snapshot", "uncached", "cached"] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("workspace.story.json");
            crate::persistence::save(&path, &initial).unwrap();
            let mut store = Store::default();
            let mut doc = initial.clone();
            let mut samples = vec![];
            for i in 0..10 {
                doc.title = format!("改稿{i}");
                let start = std::time::Instant::now();
                match mode {
                    "snapshot" => {
                        crate::persistence::save(&path, &doc).unwrap();
                    }
                    "uncached" => save_workspace(&path, &doc).unwrap(),
                    _ => store.save(&path, &doc).unwrap(),
                }
                samples.push(start.elapsed().as_secs_f64() * 1000.);
                assert_eq!(crate::load(&path).unwrap(), doc);
            }
            samples.sort_by(f64::total_cmp);
            let journal_bytes: u64 = std::fs::read_dir(dir.path())
                .unwrap()
                .map(|e| e.unwrap())
                .filter(|e| e.path().extension().is_some_and(|s| s == "journal"))
                .map(|e| e.metadata().unwrap().len())
                .sum();
            let cache_capacity = store
                .cache
                .as_ref()
                .map_or(0, |c| c.recovery.journal.current.capacity());
            println!(
                "{mode}: median_ms={:.3} checkpoint_bytes={} journal_bytes={journal_bytes} cache_capacity={cache_capacity}",
                (samples[4] + samples[5]) / 2.,
                std::fs::metadata(&path).unwrap().len()
            );
        }
    }
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
