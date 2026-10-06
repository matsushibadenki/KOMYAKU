//! Stream bounded snapshots to a private temporary file, then atomically publish.
use ring::digest::{Context, SHA256};
use serde::Serialize;
use std::{
    io::{self, BufWriter, Write},
    path::Path,
};
use unge_core::Document;

const SNAPSHOT_LIMIT: u64 = 128 * 1024 * 1024;
#[derive(Debug)]
pub struct Receipt {
    pub bytes: u64,
    pub hash: String,
}
struct DigestWriter<W> {
    inner: W,
    digest: Context,
    bytes: u64,
    limit: u64,
    exceeded: bool,
}
impl<W: Write> Write for DigestWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        if buffer.len() as u64 > self.limit.saturating_sub(self.bytes) {
            self.exceeded = true;
            return Err(io::Error::other("limit_exceeded"));
        }
        let written = self.inner.write(buffer)?;
        self.digest.update(&buffer[..written]);
        self.bytes += written as u64;
        Ok(written)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.inner.flush()
    }
}
impl<W> DigestWriter<W> {
    fn new(inner: W, limit: u64) -> Self {
        Self {
            inner,
            digest: Context::new(&SHA256),
            bytes: 0,
            limit,
            exceeded: false,
        }
    }
    fn receipt(self) -> Receipt {
        Receipt {
            bytes: self.bytes,
            hash: self
                .digest
                .finish()
                .as_ref()
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect(),
        }
    }
}
pub fn save(path: &Path, document: &Document) -> Result<Receipt, String> {
    save_with_limit(path, document, SNAPSHOT_LIMIT)
}
fn save_with_limit(path: &Path, document: &Document, limit: u64) -> Result<Receipt, String> {
    document.validate().map_err(|e| e.to_string())?;
    #[derive(Serialize)]
    struct Snapshot<'a> {
        generation: String,
        format: &'static str,
        version: u32,
        document: &'a Document,
    }
    let parent = path
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let temporary = tempfile::Builder::new()
        .prefix(".komyaku-snapshot-")
        .tempfile_in(parent)
        .map_err(|e| e.to_string())?;
    let file = temporary.as_file().try_clone().map_err(|e| e.to_string())?;
    let mut writer = BufWriter::with_capacity(64 * 1024, DigestWriter::new(file, limit));
    let result = serde_json::to_writer(
        &mut writer,
        &Snapshot {
            generation: unge_core::Id::new_v4().to_string(),
            format: "komyaku-story-workspace",
            version: 1,
            document,
        },
    );
    if let Err(error) = result {
        return Err(if writer.get_ref().exceeded {
            "limit_exceeded".into()
        } else {
            error.to_string()
        });
    }
    if let Err(error) = writer.flush() {
        return Err(if writer.get_ref().exceeded {
            "limit_exceeded".into()
        } else {
            error.to_string()
        });
    }
    let receipt = writer.into_inner().map_err(|e| e.to_string())?.receipt();
    temporary.as_file().sync_all().map_err(|e| e.to_string())?;
    temporary.persist(path).map_err(|e| e.to_string())?;
    std::fs::File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|e| e.to_string())?;
    Ok(receipt)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn compact_snapshots_preserve_unicode_and_match_the_written_digest() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.story.json");
        let mut document = Document::default();
        document.title = "雨 👨\u{200d}👩\u{200d}👧\u{200d}👦 e\u{301}\r\n次の行".into();
        let receipt = save(&path, &document).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert_eq!(receipt.bytes, bytes.len() as u64);
        let digest = ring::digest::digest(&SHA256, &bytes)
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        assert_eq!(receipt.hash, digest);
        assert_eq!(crate::load(&path).unwrap(), document);
        let old = crate::SavedWorkspace {
            generation: None,
            format: "komyaku-story-workspace".into(),
            version: 1,
            document: document.clone(),
        };
        std::fs::write(&path, serde_json::to_vec_pretty(&old).unwrap()).unwrap();
        assert_eq!(crate::load(&path).unwrap(), document);
    }
    #[test]
    fn oversize_or_failed_publication_preserves_the_previous_file_and_cleans_temporary_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("workspace.story.json");
        save(&path, &Document::default()).unwrap();
        let original = std::fs::read(&path).unwrap();
        let mut huge = Document::default();
        huge.title = "雨".repeat(100000);
        assert_eq!(
            save_with_limit(&path, &huge, 1000).unwrap_err(),
            "limit_exceeded"
        );
        assert_eq!(std::fs::read(&path).unwrap(), original);
        let target = dir.path().join("directory");
        std::fs::create_dir(&target).unwrap();
        assert!(save(&target, &Document::default()).is_err());
        assert!(target.is_dir());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
    #[test]
    fn digest_tracks_actual_bytes_when_writes_are_partial() {
        struct Partial(Vec<u8>);
        impl Write for Partial {
            fn write(&mut self, b: &[u8]) -> io::Result<usize> {
                let n = b.len().min(3);
                self.0.extend_from_slice(&b[..n]);
                Ok(n)
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut writer = DigestWriter::new(Partial(vec![]), 16);
        writer.write_all(b"abcdefgh").unwrap();
        assert_eq!(writer.inner.0, b"abcdefgh");
        assert_eq!(writer.bytes, 8);
        assert!(writer.write_all(b"123456789").is_err());
        assert_eq!(writer.bytes, 8);
        assert_eq!(
            writer.receipt().hash,
            ring::digest::digest(&SHA256, b"abcdefgh")
                .as_ref()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>()
        );
    }
}
