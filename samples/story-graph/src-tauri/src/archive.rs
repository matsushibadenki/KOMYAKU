//! Portable, bounded, checksummed archive. Only verified files are atomically published.
use super::*;
use std::io::{Read, Write};
use std::path::Path;
use std::result::Result;

const MAGIC: &[u8] = b"KOMYAKU-STORY-ARCHIVE\0\x01";
const FILE_LIMIT: u64 = 128 * 1024 * 1024;
const ARCHIVE_LIMIT: u64 = 2 * 1024 * 1024 * 1024;
const META_LIMIT: u64 = 16 * 1024;

fn digest(bytes: &[u8]) -> Vec<u8> {
    ring::digest::digest(&ring::digest::SHA256, bytes)
        .as_ref()
        .to_vec()
}
fn write_record(writer: &mut impl Write, bytes: &[u8]) -> Result<(), String> {
    writer
        .write_all(&(bytes.len() as u64).to_le_bytes())
        .and_then(|_| writer.write_all(&digest(bytes)))
        .and_then(|_| writer.write_all(bytes))
        .map_err(|_| "archive_failed".into())
}
fn read_record(reader: &mut impl Read, limit: u64) -> Result<Vec<u8>, String> {
    let mut length = [0; 8];
    let mut expected = [0; 32];
    reader
        .read_exact(&mut length)
        .and_then(|_| reader.read_exact(&mut expected))
        .map_err(|_| "archive_invalid")?;
    let length = u64::from_le_bytes(length);
    if length > limit {
        return Err("archive_invalid".into());
    }
    let mut bytes = vec![0; length as usize];
    reader
        .read_exact(&mut bytes)
        .map_err(|_| "archive_invalid")?;
    if digest(&bytes) != expected {
        return Err("archive_invalid".into());
    }
    Ok(bytes)
}
fn snapshot_bytes(document: &Document) -> Result<Vec<u8>, String> {
    let bytes = serde_json::to_vec(&SavedWorkspace {
        format: "komyaku-story-workspace".into(),
        version: workspace_version(document),
        generation: None,
        document: document.clone(),
    })
    .map_err(|_| "archive_failed")?;
    if bytes.len() as u64 > FILE_LIMIT {
        return Err("limit_exceeded".into());
    }
    Ok(bytes)
}
fn decode_snapshot(
    bytes: &[u8],
    registry: Arc<unge_executor::Registry>,
) -> Result<Document, String> {
    let saved: SavedWorkspace = serde_json::from_slice(bytes).map_err(|_| "archive_invalid")?;
    if saved.format != "komyaku-story-workspace" || ![1, 2, 3].contains(&saved.version) {
        return Err("archive_invalid".into());
    }
    domain::Validator(registry)
        .validate(&saved.document)
        .map_err(|_| "archive_invalid")?;
    Ok(saved.document)
}
fn durable_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(|_| "archive_failed")?;
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "archive_failed".into())
}
pub(super) fn export_file(
    path: &Path,
    document: &Document,
    versions_root: &Path,
    settings: &preferences::Preferences,
    registry: Arc<unge_executor::Registry>,
) -> Result<(), String> {
    if path.extension().and_then(|v| v.to_str()) != Some("komyaku-story") {
        return Err("archive_extension_invalid".into());
    }
    domain::Validator(registry.clone())
        .validate(document)
        .map_err(|_| "archive_invalid")?;
    let versions = history::entries(versions_root)?;
    let parent = path.parent().ok_or("archive_failed")?;
    let temporary = parent.join(format!(".archive-{}.tmp", Id::new_v4()));
    let result = (|| {
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|_| "archive_failed")?;
        let mut writer = std::io::BufWriter::new(file);
        writer.write_all(MAGIC).map_err(|_| "archive_failed")?;
        write_record(
            &mut writer,
            &serde_json::to_vec(settings).map_err(|_| "archive_failed")?,
        )?;
        write_record(&mut writer, &snapshot_bytes(document)?)?;
        write_record(&mut writer, &(versions.len() as u32).to_le_bytes())?;
        for version in versions {
            // Read and validate each immutable snapshot once; archive memory is bounded by one snapshot.
            let bytes = history::read_file(
                &versions_root.join(&version.id).join("workspace.story.json"),
                FILE_LIMIT,
            )?;
            decode_snapshot(&bytes, registry.clone())?;
            write_record(
                &mut writer,
                &serde_json::to_vec(&version).map_err(|_| "archive_failed")?,
            )?;
            let actual = digest(&bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            if actual != version.hash {
                return Err("archive_invalid".into());
            }
            write_record(&mut writer, &bytes)?;
            if writer
                .get_ref()
                .metadata()
                .map_err(|_| "archive_failed")?
                .len()
                > ARCHIVE_LIMIT
            {
                return Err("limit_exceeded".into());
            }
        }
        writer.flush().map_err(|_| "archive_failed")?;
        if writer
            .get_ref()
            .metadata()
            .map_err(|_| "archive_failed")?
            .len()
            > ARCHIVE_LIMIT
        {
            return Err("limit_exceeded".into());
        }
        writer.get_ref().sync_all().map_err(|_| "archive_failed")?;
        std::fs::rename(&temporary, path).map_err(|_| "archive_failed")?;
        std::fs::File::open(parent)
            .and_then(|f| f.sync_all())
            .map_err(|_| "archive_failed")?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(temporary);
    }
    result
}

pub(super) fn import_file(
    path: &Path,
    library: &library::Library,
    registry: Arc<unge_executor::Registry>,
) -> Result<PathBuf, String> {
    let meta = std::fs::symlink_metadata(path).map_err(|_| "archive_invalid")?;
    if !meta.file_type().is_file() || meta.len() > ARCHIVE_LIMIT {
        return Err("archive_invalid".into());
    }
    let mut reader =
        std::io::BufReader::new(std::fs::File::open(path).map_err(|_| "archive_invalid")?);
    let mut magic = vec![0; MAGIC.len()];
    reader
        .read_exact(&mut magic)
        .map_err(|_| "archive_invalid")?;
    if magic != MAGIC {
        return Err("archive_invalid".into());
    }
    let mut settings: preferences::Preferences =
        serde_json::from_slice(&read_record(&mut reader, META_LIMIT)?)
            .map_err(|_| "archive_invalid")?;
    settings.left_panel_open = true;
    settings.right_panel_open = false;
    let document = decode_snapshot(&read_record(&mut reader, FILE_LIMIT)?, registry.clone())?;
    let count = read_record(&mut reader, 4)?;
    let count = u32::from_le_bytes(count.try_into().map_err(|_| "archive_invalid")?) as usize;
    if count > 512 {
        return Err("archive_invalid".into());
    }
    let title = if document.title.trim().is_empty() {
        "Untitled".into()
    } else {
        document.title.clone()
    };
    library.restore_package(document, title, settings, |staging| {
        let root = staging.join("versions");
        std::fs::create_dir(&root).map_err(|_| "archive_failed")?;
        let mut ids = std::collections::BTreeSet::new();
        for _ in 0..count {
            let metadata = read_record(&mut reader, META_LIMIT)?;
            let version: history::Version =
                serde_json::from_slice(&metadata).map_err(|_| "archive_invalid")?;
            if Id::parse_str(&version.id)
                .map_err(|_| "archive_invalid")?
                .to_string()
                != version.id
                || !ids.insert(version.id.clone())
            {
                return Err("archive_invalid".into());
            }
            let bytes = read_record(&mut reader, FILE_LIMIT)?;
            decode_snapshot(&bytes, registry.clone())?;
            let actual = digest(&bytes)
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>();
            if actual != version.hash {
                return Err("archive_invalid".into());
            }
            let dir = root.join(&version.id);
            std::fs::create_dir(&dir).map_err(|_| "archive_failed")?;
            durable_file(&dir.join("version.json"), &metadata)?;
            durable_file(&dir.join("workspace.story.json"), &bytes)?;
            std::fs::File::open(&dir)
                .and_then(|f| f.sync_all())
                .map_err(|_| "archive_failed")?;
        }
        if reader.read(&mut [0]).map_err(|_| "archive_invalid")? != 0 {
            return Err("archive_invalid".into());
        }
        let versions = history::entries(&root)?;
        if versions.len() != count {
            return Err("archive_invalid".into());
        }
        std::fs::File::open(root)
            .and_then(|f| f.sync_all())
            .map_err(|_| "archive_failed")?;
        Ok(())
    })
}

#[tauri::command]
pub async fn export_archive(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    store: tauri::State<'_, preferences::Store>,
) -> Result<bool, String> {
    allowed(&window)?;
    let host = host.inner().clone();
    let settings = store.value.lock().map_err(|_| "state_unavailable")?.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let title = match settings.language.as_str() {
            "en" => "Export work with history",
            "zh-CN" => "导出作品和历史",
            _ => "履歴を含めて作品を書き出す",
        };
        let Some(path) = rfd::FileDialog::new()
            .set_title(title)
            .set_file_name("work.komyaku-story")
            .add_filter("KOMYAKU archive", &["komyaku-story"])
            .save_file()
        else {
            return Ok(false);
        };
        let _gate = host.gate.lock().map_err(|_| "state_unavailable")?;
        let document = host.engine.snapshot().map_err(|e| e.code)?;
        export_file(
            &path,
            &document,
            &host.path.parent().ok_or("archive_failed")?.join("versions"),
            &settings,
            host.registry.clone(),
        )?;
        Ok(true)
    })
    .await
    .map_err(|_| "archive_failed".to_owned())?
}

#[tauri::command]
pub async fn import_archive(
    window: tauri::WebviewWindow,
    host: tauri::State<'_, Host>,
    library: tauri::State<'_, library::Library>,
    store: tauri::State<'_, preferences::Store>,
) -> Result<bool, String> {
    allowed(&window)?;
    let root = library.root.clone();
    let registry = host.registry.clone();
    let language = store
        .value
        .lock()
        .map_err(|_| "state_unavailable")?
        .language
        .clone();
    tauri::async_runtime::spawn_blocking(move || {
        let title = match language.as_str() {
            "en" => "Import work with history",
            "zh-CN" => "导入作品和历史",
            _ => "履歴を含む作品を取り込む",
        };
        let Some(path) = rfd::FileDialog::new()
            .set_title(title)
            .add_filter("KOMYAKU archive", &["komyaku-story"])
            .pick_file()
        else {
            return Ok(false);
        };
        let library = library::Library { root };
        let directory = import_file(&path, &library, registry)?;
        launch_workspace(&directory, &library.root, true).map_err(|_| "backup_open_failed")?;
        Ok(true)
    })
    .await
    .map_err(|_| "archive_failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (PathBuf, Arc<unge_executor::Registry>, Document) {
        let root = std::env::temp_dir().join(format!("komyaku-archive-test-{}", Id::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let registry = domain::registry();
        let document = domain::initial_document(&registry);
        (root, registry, document)
    }
    #[test]
    fn empty_profile_restores_draft_history_graph_and_preferences_exactly() {
        let (root, registry, mut document) = fixture();
        let versions = root.join("source-versions");
        let first = history::record(&versions, &document, "初稿😃".into()).unwrap();
        document.title = "改稿：雨の駅から".into();
        let second = history::record(&versions, &document, "改稿".into()).unwrap();
        document.title = "まだ版に保存していない作業原稿".into();
        let settings = preferences::Preferences {
            body_size: 20.,
            actor_bold: true,
            ..Default::default()
        };
        let archive = root.join("work.komyaku-story");
        export_file(&archive, &document, &versions, &settings, registry.clone()).unwrap();
        let original = std::fs::read(&archive).unwrap();
        let library = library::Library {
            root: root.join("empty-profile"),
        };
        let restored = import_file(&archive, &library, registry.clone()).unwrap();
        assert_eq!(
            load(&restored.join("workspace.story.json"))
                .unwrap()
                .to_json()
                .unwrap(),
            document.to_json().unwrap()
        );
        let recovered = history::entries(&restored.join("versions")).unwrap();
        assert_eq!(recovered.len(), 2);
        assert_eq!(recovered[0].id, second.id);
        assert_eq!(recovered[1].id, first.id);
        for id in [&first.id, &second.id] {
            assert_eq!(
                std::fs::read(
                    restored
                        .join("versions")
                        .join(id)
                        .join("workspace.story.json")
                )
                .unwrap(),
                std::fs::read(versions.join(id).join("workspace.story.json")).unwrap()
            );
        }
        let store = preferences::Store::load(restored.join("preferences.json")).unwrap();
        assert_eq!(*store.value.lock().unwrap(), settings);
        assert_eq!(std::fs::read(&archive).unwrap(), original);
        // A new version after import continues the preserved history, rather than starting over.
        history::record(&restored.join("versions"), &document, "続き".into()).unwrap();
        assert_eq!(
            history::entries(&restored.join("versions")).unwrap().len(),
            3
        );
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn damaged_truncated_and_trailing_archives_publish_no_workspace() {
        let (root, registry, document) = fixture();
        let versions = root.join("versions");
        history::record(&versions, &document, "版".into()).unwrap();
        let archive = root.join("work.komyaku-story");
        export_file(
            &archive,
            &document,
            &versions,
            &Default::default(),
            registry.clone(),
        )
        .unwrap();
        let original = std::fs::read(&archive).unwrap();
        let library = library::Library {
            root: root.join("destination"),
        };
        for mode in 0..3 {
            let mut bytes = original.clone();
            match mode {
                0 => {
                    let index = bytes.len() - 1;
                    bytes[index] ^= 1;
                }
                1 => {
                    bytes.truncate(bytes.len() - 30);
                }
                _ => bytes.push(0),
            }
            std::fs::write(&archive, bytes).unwrap();
            assert!(import_file(&archive, &library, registry.clone()).is_err());
            let workspaces = library.root.join("workspaces");
            if workspaces.exists() {
                assert_eq!(std::fs::read_dir(workspaces).unwrap().count(), 0);
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_export_preserves_existing_destination_and_rejects_future_formats() {
        let (root, registry, document) = fixture();
        let versions = root.join("versions");
        let version = history::record(&versions, &document, "版".into()).unwrap();
        let archive = root.join("work.komyaku-story");
        std::fs::write(&archive, b"previous export").unwrap();
        std::fs::write(
            versions.join(version.id).join("workspace.story.json"),
            b"broken",
        )
        .unwrap();
        assert!(
            export_file(
                &archive,
                &document,
                &versions,
                &Default::default(),
                registry.clone()
            )
            .is_err()
        );
        assert_eq!(std::fs::read(&archive).unwrap(), b"previous export");
        assert!(!std::fs::read_dir(&root).unwrap().any(|e| {
            e.unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with(".archive-")
        }));
        let mut future = MAGIC.to_vec();
        *future.last_mut().unwrap() = 2;
        std::fs::write(&archive, future).unwrap();
        assert!(
            import_file(
                &archive,
                &library::Library {
                    root: root.join("empty")
                },
                registry
            )
            .is_err()
        );
        assert!(!root.join("empty").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}
