//! Shared KOMYAKU Archive v1, stored ZIP. The Canonical manuscript occurs once;
//! graph/layout references live in a namespaced Canonical document extension.
use super::*;
use std::collections::BTreeMap;
pub(super) const MIME: &str = "application/vnd.komyaku.archive+zip";
pub(super) const GRAPH_EXTENSION: &str = "komyaku.storygraph.workspace-v1";
const MAX: usize = 32 * 1024 * 1024;
fn error() -> String {
    "shared_archive_invalid".into()
}
fn crc(bytes: &[u8]) -> u32 {
    let mut crc = 0xffffffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb88320u32 & 0u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}
fn u16s(out: &mut Vec<u8>, v: u16) {
    out.extend(v.to_le_bytes());
}
fn u32s(out: &mut Vec<u8>, v: u32) {
    out.extend(v.to_le_bytes());
}
pub(super) fn zip(entries: Vec<(String, Vec<u8>)>) -> Vec<u8> {
    let mut out = vec![];
    let mut directory = vec![];
    let count = entries.len() as u16;
    for (name, bytes) in entries {
        let offset = out.len() as u32;
        let hash = crc(&bytes);
        u32s(&mut out, 0x04034b50);
        for v in [20, 0x800, 0, 0, 0] {
            u16s(&mut out, v);
        }
        for v in [hash, bytes.len() as u32, bytes.len() as u32] {
            u32s(&mut out, v);
        }
        u16s(&mut out, name.len() as u16);
        u16s(&mut out, 0);
        out.extend(name.as_bytes());
        out.extend(&bytes);
        u32s(&mut directory, 0x02014b50);
        for v in [20, 20, 0x800, 0, 0, 0] {
            u16s(&mut directory, v);
        }
        for v in [hash, bytes.len() as u32, bytes.len() as u32] {
            u32s(&mut directory, v);
        }
        for v in [name.len() as u16, 0, 0, 0, 0] {
            u16s(&mut directory, v);
        }
        u32s(&mut directory, 0);
        u32s(&mut directory, offset);
        directory.extend(name.as_bytes());
    }
    let start = out.len() as u32;
    let size = directory.len() as u32;
    out.extend(directory);
    u32s(&mut out, 0x06054b50);
    for v in [0, 0, count, count] {
        u16s(&mut out, v);
    }
    u32s(&mut out, size);
    u32s(&mut out, start);
    u16s(&mut out, 0);
    out
}
pub(super) fn read_zip(bytes: &[u8]) -> std::result::Result<BTreeMap<String, Vec<u8>>, String> {
    if bytes.len() < 22 || bytes.len() > MAX {
        return Err(error());
    }
    let read16 = |i: usize| {
        bytes
            .get(i..i + 2)
            .map(|b| u16::from_le_bytes(b.try_into().unwrap()))
            .ok_or_else(error)
    };
    let read32 = |i: usize| {
        bytes
            .get(i..i + 4)
            .map(|b| u32::from_le_bytes(b.try_into().unwrap()))
            .ok_or_else(error)
    };
    let end = bytes.len() - 22;
    if read32(end)? != 0x06054b50
        || read16(end + 4)? != 0
        || read16(end + 6)? != 0
        || read16(end + 20)? != 0
    {
        return Err(error());
    }
    let count = usize::from(read16(end + 8)?);
    let start = read32(end + 16)? as usize;
    if !(3..=515).contains(&count)
        || usize::from(read16(end + 10)?) != count
        || start.checked_add(read32(end + 12)? as usize) != Some(end)
    {
        return Err(error());
    }
    let mut entries = BTreeMap::new();
    let mut metadata = vec![];
    let mut offset = 0;
    while offset < start {
        if entries.len() >= count
            || read32(offset)? != 0x04034b50
            || read16(offset + 4)? != 20
            || read16(offset + 6)? != 0x800
            || read16(offset + 8)? != 0
            || read32(offset + 18)? != read32(offset + 22)?
            || read16(offset + 28)? != 0
        {
            return Err(error());
        }
        let size = read32(offset + 22)? as usize;
        let n = usize::from(read16(offset + 26)?);
        let data = offset.checked_add(30 + n).ok_or_else(error)?;
        let tail = data
            .checked_add(size)
            .filter(|n| *n <= start)
            .ok_or_else(error)?;
        let name = std::str::from_utf8(bytes.get(offset + 30..data).ok_or_else(error)?)
            .map_err(|_| error())?
            .to_string();
        if name.len() > 200
            || name
                .split('/')
                .any(|p| p.is_empty() || p == "." || p == "..")
            || name.contains(['\\', '\0'])
            || entries.contains_key(&name)
            || crc(&bytes[data..tail]) != read32(offset + 14)?
        {
            return Err(error());
        }
        metadata.push((name.clone(), offset, size, read32(offset + 14)?));
        entries.insert(name, bytes[data..tail].to_vec());
        offset = tail;
    }
    if entries.len() != count {
        return Err(error());
    }
    let mut directory = start;
    for (name, offset, size, hash) in metadata {
        if read32(directory)? != 0x02014b50
            || read16(directory + 4)? != 20
            || read16(directory + 6)? != 20
            || read16(directory + 8)? != 0x800
            || read16(directory + 10)? != 0
            || read32(directory + 16)? != hash
            || read32(directory + 20)? as usize != size
            || read32(directory + 24)? as usize != size
            || usize::from(read16(directory + 28)?) != name.len()
            || [30, 32, 34, 36]
                .iter()
                .any(|n| read16(directory + n).unwrap_or(1) != 0)
            || read32(directory + 38)? != 0
            || read32(directory + 42)? as usize != offset
        {
            return Err(error());
        }
        let tail = directory + 46 + name.len();
        if bytes.get(directory + 46..tail) != Some(name.as_bytes()) {
            return Err(error());
        }
        directory = tail;
    }
    if directory != end {
        return Err(error());
    }
    Ok(entries)
}
fn utc_timestamp() -> String {
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs();
    timestamp(seconds)
}
pub(super) fn timestamp(seconds: u64) -> String {
    let z = (seconds / 86400) as i64 + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let mut year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = mp + if mp < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z",
        seconds % 86400 / 3600,
        seconds % 3600 / 60,
        seconds % 60
    )
}
pub fn encode(document: &Document) -> std::result::Result<Vec<u8>, String> {
    let mut workspace = shared_workspace::project(document)?;
    let graph = workspace["graph"].take();
    let mut canonical = workspace["document"].take();
    canonical["extensions"][GRAPH_EXTENSION] = graph;
    let id = canonical["id"].as_str().ok_or_else(error)?;
    let path = format!("documents/{id}.json");
    let manifest = json!({"format":"komyaku-archive","formatVersion":1,"createdAt":utc_timestamp(),"document":{"id":id,"path":path},"assets":[],"extensions":{}});
    let bytes = zip(vec![
        ("mimetype".into(), MIME.as_bytes().to_vec()),
        (
            "manifest.json".into(),
            serde_json::to_vec(&manifest).map_err(|_| error())?,
        ),
        (path, serde_json::to_vec(&canonical).map_err(|_| error())?),
    ]);
    if bytes.len() > MAX {
        return Err("limit_exceeded".into());
    }
    Ok(bytes)
}
pub fn decode(bytes: &[u8]) -> std::result::Result<Document, String> {
    let mut entries = read_zip(bytes)?;
    if entries.remove("mimetype").as_deref() != Some(MIME.as_bytes()) {
        return Err(error());
    }
    let manifest: Value =
        serde_json::from_slice(&entries.remove("manifest.json").ok_or_else(error)?)
            .map_err(|_| error())?;
    if manifest["format"] != "komyaku-archive"
        || manifest["formatVersion"] != 1
        || manifest["assets"] != json!([])
        || manifest["extensions"] != json!({})
        || manifest.as_object().is_none_or(|fields| {
            fields.keys().any(|key| {
                ![
                    "format",
                    "formatVersion",
                    "createdAt",
                    "document",
                    "assets",
                    "extensions",
                ]
                .contains(&key.as_str())
            })
        })
        || manifest["document"].as_object().is_none_or(|fields| {
            fields.len() != 2 || !fields.contains_key("id") || !fields.contains_key("path")
        })
        || manifest["createdAt"].as_str().is_none_or(|value| {
            ![20, 24].contains(&value.len()) || !value.ends_with("Z") || !value.is_ascii()
        })
    {
        return Err(error());
    }
    let id = manifest["document"]["id"].as_str().ok_or_else(error)?;
    let parsed = Id::parse_str(id).map_err(|_| error())?;
    if parsed.to_string() != id {
        return Err(error());
    }
    let path = format!("documents/{id}.json");
    if manifest["document"]["path"] != path {
        return Err(error());
    }
    let mut canonical: Value =
        serde_json::from_slice(&entries.remove(&path).ok_or_else(error)?).map_err(|_| error())?;
    if !entries.is_empty() || canonical["id"] != id {
        return Err(error());
    }
    let graph = canonical["extensions"]
        .as_object_mut()
        .and_then(|o| o.remove(GRAPH_EXTENSION))
        .ok_or_else(error)?;
    shared_workspace::decode(
        json!({"schemaId":"https://komyaku.example/schemas/story-workspace/v1","schemaVersion":1,"document":canonical,"graph":graph}),
    )
}
#[tauri::command]
pub async fn export_shared_archive(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    history: Option<bool>,
) -> std::result::Result<bool, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        let bytes = if history.unwrap_or(false) {
            shared_history::encode(&host)?
        } else {
            host.engine
                .read_document(|d, _| encode(d))
                .map_err(|e| e.code)??
        };
        drop(_gate);
        let Some(path) = rfd::FileDialog::new()
            .add_filter("KOMYAKU Archive", &["komyaku"])
            .set_file_name("story.komyaku")
            .save_file()
        else {
            return Ok(false);
        };
        if path.extension().and_then(|s| s.to_str()) != Some("komyaku") {
            return Err("export_extension_invalid".into());
        }
        use std::io::Write;
        let mut tmp = tempfile::NamedTempFile::new_in(path.parent().ok_or("export_failed")?)
            .map_err(|_| "export_failed")?;
        tmp.write_all(&bytes)
            .and_then(|_| tmp.as_file().sync_all())
            .map_err(|_| "export_failed")?;
        tmp.persist(path).map_err(|_| "export_failed")?;
        Ok(true)
    })
    .await
    .map_err(|_| "export_failed".to_string())?
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_roundtrip_rejects_corruption_and_directory_tampering() {
        let d = domain::initial_document(&domain::registry());
        let bytes = encode(&d).unwrap();
        assert_eq!(
            decode(&bytes).unwrap().to_json().unwrap(),
            d.to_json().unwrap()
        );
        for position in [0, 40, bytes.len() - 6] {
            let mut bad = bytes.clone();
            bad[position] ^= 1;
            assert!(decode(&bad).is_err());
        }
        let mut tail = bytes.clone();
        tail.push(0);
        assert!(decode(&tail).is_err());
    }
    #[test]
    fn import_publishes_separate_workspace_and_corruption_never_publishes() {
        let dir = tempfile::tempdir().unwrap();
        let registry = domain::registry();
        let document = domain::initial_document(&registry);
        let bytes = encode(&document).unwrap();
        let source = dir.path().join("source.komyaku");
        std::fs::write(&source, &bytes).unwrap();
        let library = library::Library {
            root: dir.path().join("library"),
        };
        std::fs::create_dir(&library.root).unwrap();
        let restored = library
            .import_snapshot(
                &source,
                preferences::Preferences::default(),
                registry.clone(),
            )
            .unwrap();
        assert_eq!(std::fs::read(&source).unwrap(), bytes);
        assert!(load(&restored.join("workspace.story.json")).is_ok());
        let count = std::fs::read_dir(library.root.join("workspaces"))
            .unwrap()
            .count();
        let mut bad = bytes;
        bad[40] ^= 1;
        std::fs::write(&source, bad).unwrap();
        assert!(
            library
                .import_snapshot(&source, preferences::Preferences::default(), registry)
                .is_err()
        );
        assert_eq!(
            std::fs::read_dir(library.root.join("workspaces"))
                .unwrap()
                .count(),
            count
        );
    }
    #[test]
    #[ignore = "writes shared archive reference fixture"]
    fn shared_archive_fixture() {
        let d = domain::initial_document(&domain::registry());
        std::fs::write(
            "/private/tmp/komyaku-shared-archive-fixture.komyaku",
            encode(&d).unwrap(),
        )
        .unwrap();
    }
}
