//! Native checkpoint v3: one shared Canonical Document with graph references.
//! Legacy snapshots remain readable; unsupported bridge envelopes keep the
//! legacy representation rather than losing data or imposing a smaller limit.
use crate::*;
use std::io::Write;
pub fn write(
    writer: impl Write,
    document: &Document,
    generation: Option<String>,
) -> std::result::Result<(), String> {
    #[derive(Serialize)]
    struct Envelope<'a> {
        #[serde(skip_serializing_if = "Option::is_none")]
        generation: Option<String>,
        format: &'static str,
        version: u32,
        #[serde(skip_serializing_if = "Option::is_none")]
        document: Option<&'a Document>,
        #[serde(skip_serializing_if = "Option::is_none")]
        workspace: Option<Value>,
    }
    let workspace = shared_workspace::project(document).ok();
    let version = if workspace.is_some() {
        3
    } else {
        workspace_version(document)
    };
    serde_json::to_writer(
        writer,
        &Envelope {
            generation,
            format: "komyaku-story-workspace",
            version,
            document: workspace.is_none().then_some(document),
            workspace,
        },
    )
    .map_err(|error| error.to_string())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn composite_checkpoint_contains_one_manuscript_and_reads_legacy_versions() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("workspace.story.json");
        let document = domain::initial_document(&domain::registry());
        persistence::save(&path, &document).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        let value: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(value["version"], 3);
        assert!(value.get("document").is_none());
        assert!(value["workspace"]["document"]["content"].is_array());
        assert_eq!(load(&path).unwrap(), document);
        let native = &value["workspace"]["graph"]["extensions"]["komyaku.storygraph.native-v1"]["graph"]
            ["nodes"];
        assert!(
            native
                .as_object()
                .unwrap()
                .values()
                .all(|node| node["properties"].get("canonical").is_none())
        );
        for version in [1, 2] {
            std::fs::write(
                &path,
                serde_json::to_vec(&SavedWorkspace {
                    generation: None,
                    format: "komyaku-story-workspace".into(),
                    version,
                    document: document.clone(),
                })
                .unwrap(),
            )
            .unwrap();
            assert_eq!(load(&path).unwrap(), document);
        }
        let mut invalid = value;
        invalid["document"] = serde_json::to_value(&document).unwrap();
        std::fs::write(&path, serde_json::to_vec(&invalid).unwrap()).unwrap();
        assert!(load(&path).is_err());
    }
}
