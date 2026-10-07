//! Internal persistence primitive. Not an IPC boundary: the Rust workspace
//! owner must validate the composite and derive request/snapshot bytes itself.
use sqlx::{Pool, Sqlite};

const MAX_BYTES: usize = 24 * 1024 * 1024;
const MAX_REVISION: i64 = 9_007_199_254_740_990;

#[derive(Debug, PartialEq)]
pub(crate) struct Receipt {
    pub revision: i64,
    pub snapshot_json: String,
    pub replayed: bool,
}

pub(crate) async fn migrate(pool: &Pool<Sqlite>) -> Result<(), sqlx::Error> {
    let mut tx = pool.begin().await?;
    sqlx::query("CREATE TABLE IF NOT EXISTS story_workspace_states (
        workspace_id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision > 0), snapshot_json TEXT NOT NULL)")
        .execute(&mut *tx).await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS story_workspace_receipts (
        operation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, request_json TEXT NOT NULL,
        revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
        FOREIGN KEY(workspace_id) REFERENCES story_workspace_states(workspace_id))",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS story_workspace_assets (
        workspace_id TEXT NOT NULL REFERENCES story_workspace_states(workspace_id),
        asset_id TEXT NOT NULL, PRIMARY KEY(workspace_id,asset_id))",
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await
}

pub(crate) async fn commit(
    pool: &Pool<Sqlite>,
    workspace_id: &str,
    operation_id: &str,
    expected_revision: i64,
    request_json: &str,
    snapshot_json: &str,
) -> Result<Receipt, String> {
    if workspace_id.is_empty()
        || workspace_id.len() > 100
        || operation_id.is_empty()
        || operation_id.len() > 100
        || !(0..=MAX_REVISION).contains(&expected_revision)
        || request_json.len() > MAX_BYTES
        || snapshot_json.len() > MAX_BYTES
    {
        return Err("invalid_story_storage_request".into());
    }
    // Reject malformed JSON before opening a transaction. Semantic validation
    // belongs to the future native owner; callers cannot be WebView input.
    serde_json::from_str::<serde_json::Value>(request_json)
        .map_err(|_| "invalid_story_storage_request")?;
    serde_json::from_str::<serde_json::Value>(snapshot_json)
        .map_err(|_| "invalid_story_storage_request")?;
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    // Reserve the writer before reading receipts, so concurrent callers serialize.
    sqlx::query("UPDATE story_workspace_states SET revision = revision WHERE workspace_id = ?")
        .bind(workspace_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    let previous: Option<(String, String, i64, String)> = sqlx::query_as(
        "SELECT workspace_id, request_json, revision, snapshot_json FROM story_workspace_receipts WHERE operation_id = ?")
        .bind(operation_id).fetch_optional(&mut *tx).await.map_err(|e| e.to_string())?;
    if let Some((owner, request, revision, snapshot)) = previous {
        if owner != workspace_id || request != request_json {
            return Err("story_operation_collision".into());
        }
        tx.commit().await.map_err(|e| e.to_string())?;
        return Ok(Receipt {
            revision,
            snapshot_json: snapshot,
            replayed: true,
        });
    }
    let asset_ids = verify_workspace_assets(&mut tx, snapshot_json).await?;
    let revision = expected_revision + 1;
    if expected_revision == 0 {
        let inserted = sqlx::query("INSERT INTO story_workspace_states(workspace_id, revision, snapshot_json) VALUES (?, ?, ?) ON CONFLICT(workspace_id) DO NOTHING")
            .bind(workspace_id).bind(revision).bind(snapshot_json).execute(&mut *tx).await.map_err(|e| e.to_string())?;
        if inserted.rows_affected() != 1 {
            return Err("stale_story_workspace_revision".into());
        }
    } else {
        let updated = sqlx::query("UPDATE story_workspace_states SET revision = ?, snapshot_json = ? WHERE workspace_id = ? AND revision = ?")
            .bind(revision).bind(snapshot_json).bind(workspace_id).bind(expected_revision)
            .execute(&mut *tx).await.map_err(|e| e.to_string())?;
        if updated.rows_affected() != 1 {
            return Err("stale_story_workspace_revision".into());
        }
    }
    sqlx::query("DELETE FROM story_workspace_assets WHERE workspace_id=?")
        .bind(workspace_id)
        .execute(&mut *tx)
        .await
        .map_err(|e| e.to_string())?;
    for asset_id in asset_ids {
        sqlx::query("INSERT INTO story_workspace_assets(workspace_id,asset_id) VALUES (?,?)")
            .bind(workspace_id)
            .bind(asset_id)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;
    }
    sqlx::query("INSERT INTO story_workspace_receipts(operation_id, workspace_id, request_json, revision, snapshot_json) VALUES (?, ?, ?, ?, ?)")
        .bind(operation_id).bind(workspace_id).bind(request_json).bind(revision).bind(snapshot_json)
        .execute(&mut *tx).await.map_err(|e| e.to_string())?;
    tx.commit().await.map_err(|e| e.to_string())?;
    Ok(Receipt {
        revision,
        snapshot_json: snapshot_json.into(),
        replayed: false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;
    async fn database() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        pool
    }
    #[tokio::test]
    async fn replay_preserves_later_state_and_rejects_collisions() {
        let pool = database().await;
        let first = commit(
            &pool,
            "workspace",
            "op1",
            0,
            "{\"expectedRevision\":0}",
            "{\"document\":1,\"graph\":1}",
        )
        .await
        .unwrap();
        commit(
            &pool,
            "workspace",
            "op2",
            1,
            "{\"expectedRevision\":1}",
            "{\"document\":2,\"graph\":2}",
        )
        .await
        .unwrap();
        let replay = commit(
            &pool,
            "workspace",
            "op1",
            0,
            "{\"expectedRevision\":0}",
            "{}",
        )
        .await
        .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.snapshot_json, first.snapshot_json);
        let revision: i64 = sqlx::query_scalar("SELECT revision FROM story_workspace_states")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(revision, 2);
        assert_eq!(
            commit(&pool, "workspace", "op1", 0, "{}", "{}")
                .await
                .unwrap_err(),
            "story_operation_collision"
        );
        assert_eq!(
            commit(&pool, "workspace", "op3", 0, "{}", "{}")
                .await
                .unwrap_err(),
            "stale_story_workspace_revision"
        );
    }
    #[tokio::test]
    async fn receipt_insert_failure_rolls_back_state() {
        let pool = database().await;
        commit(&pool, "workspace", "op1", 0, "{}", "{\"original\":true}")
            .await
            .unwrap();
        sqlx::query("CREATE TRIGGER reject_receipt BEFORE INSERT ON story_workspace_receipts BEGIN SELECT RAISE(ABORT, 'injected receipt failure'); END")
            .execute(&pool).await.unwrap();
        assert!(commit(&pool, "workspace", "op2", 1, "{}", "{}")
            .await
            .is_err());
        let state: (i64, String) =
            sqlx::query_as("SELECT revision, snapshot_json FROM story_workspace_states")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(state, (1, "{\"original\":true}".into()));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_receipts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }
    #[tokio::test]
    async fn reopened_database_replays_exact_snapshot() {
        let path = std::env::temp_dir().join(format!(
            "komyaku-story-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let url = format!("sqlite://{}?mode=rwc", path.display());
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let saved = commit(
            &pool,
            "workspace",
            "op1",
            0,
            "{}",
            "{\"text\":\"本文\",\"graph\":[]}",
        )
        .await
        .unwrap();
        pool.close().await;
        let reopened = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        migrate(&reopened).await.unwrap();
        let replay = commit(&reopened, "workspace", "op1", 0, "{}", "{}")
            .await
            .unwrap();
        assert_eq!(saved.snapshot_json, replay.snapshot_json);
        assert_eq!(replay.revision, 1);
        assert!(replay.replayed);
        reopened.close().await;
        std::fs::remove_file(path).unwrap();
    }
}

/// Internal bridge: validates the supported normalized Canonical subset and
/// Graph schema/reference closure before deriving the snapshot in Rust.
/// This is deliberately not an IPC command.
pub(crate) async fn commit_workspace(
    pool: &Pool<Sqlite>,
    operation_id: &str,
    expected_revision: i64,
    document: &serde_json::Value,
    graph: &serde_json::Value,
) -> Result<Receipt, String> {
    if !super::valid_lower_uuid(operation_id) {
        return Err("invalid_story_operation_id".into());
    }
    let document_id = document["id"]
        .as_str()
        .filter(|id| super::valid_lower_uuid(id))
        .ok_or("invalid_story_workspace_document")?;
    if graph["documentId"].as_str() != Some(document_id) {
        return Err("story_workspace_document_mismatch".into());
    }
    let ids = super::story_document_validation::validate_document_subset(document)?;
    super::story_graph_validation::validate_graph_schema(graph, &ids).map_err(str::to_string)?;
    let workspace_id = graph["id"].as_str().ok_or("invalid_story_graph")?;
    let workspace = serde_json::json!({"schemaId":"https://komyaku.example/schemas/story-workspace/v1",
        "schemaVersion":1,"document":document,"graph":graph});
    let snapshot = serde_json::to_string(&workspace).map_err(|e| e.to_string())?;
    let request = serde_json::to_string(&serde_json::json!({"operationId":operation_id,
        "expectedRevision":expected_revision,"workspace":workspace}))
    .map_err(|e| e.to_string())?;
    commit(
        pool,
        workspace_id,
        operation_id,
        expected_revision,
        &request,
        &snapshot,
    )
    .await
}

#[cfg(test)]
mod workspace_tests {
    use super::*;
    use serde_json::json;
    #[tokio::test]
    async fn validates_graph_before_atomic_workspace_adoption() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let document = super::super::story_document_validation::tests::document();
        let mut graph = json!({"schemaId":"https://komyaku.example/schemas/story-graph/v1","schemaVersion":1,
            "id":"00000000-0000-4000-8000-000000000002","documentId":document["id"],"nodes":[],"edges":[],"paths":[],"entities":[]});
        let operation = "00000000-0000-4000-8000-000000000003";
        let first = commit_workspace(&pool, operation, 0, &document, &graph)
            .await
            .unwrap();
        assert!(
            commit_workspace(&pool, operation, 0, &document, &graph)
                .await
                .unwrap()
                .replayed
        );
        let saved: serde_json::Value = serde_json::from_str(&first.snapshot_json).unwrap();
        assert_eq!(saved["document"], document);
        assert_eq!(saved["graph"], graph);
        graph["nodes"] = json!([{"id":"00000000-0000-4000-8000-000000000004","kind":"content","subtype":"scene","title":"Scene",
            "documentRefs":[{"nodeId":"00000000-0000-4000-8000-000000000099"}],"preconditions":[],"effects":[]}]);
        assert_eq!(
            commit_workspace(
                &pool,
                "00000000-0000-4000-8000-000000000005",
                1,
                &document,
                &graph
            )
            .await
            .unwrap_err(),
            "missing_canonical_node_reference"
        );
        let revision: i64 = sqlx::query_scalar("SELECT revision FROM story_workspace_states")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(revision, 1);
    }
    #[tokio::test]
    async fn invalid_initial_documents_leave_no_workspace_or_receipt() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        let document = super::super::story_document_validation::tests::document();
        let graph = json!({"schemaId":"https://komyaku.example/schemas/story-graph/v1","schemaVersion":1,
            "id":"00000000-0000-4000-8000-000000000020","documentId":document["id"],"nodes":[],"edges":[],"paths":[],"entities":[]});
        let mut empty = document.clone();
        empty["content"] = json!([]);
        let mut unsupported = document.clone();
        unsupported["content"][0]["type"] = json!("unknown");
        let mut duplicate = document.clone();
        duplicate["content"] = json!([document["content"][0], document["content"][0]]);
        let mut unsafe_link = document.clone();
        unsafe_link["content"][0]["content"] = json!([{"type":"text","text":"link","marks":[{"type":"link","href":"javascript:alert(1)"}],"metadata":{},"extensions":{}}]);
        for invalid in [empty, unsupported, duplicate, unsafe_link] {
            assert!(commit_workspace(
                &pool,
                "00000000-0000-4000-8000-000000000030",
                0,
                &invalid,
                &graph
            )
            .await
            .is_err());
            for table in [
                "story_workspace_states",
                "story_workspace_receipts",
                "story_workspace_assets",
            ] {
                let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                    .fetch_one(&pool)
                    .await
                    .unwrap();
                assert_eq!(count, 0, "{table}");
            }
        }
        assert_eq!(
            commit_workspace(
                &pool,
                "00000000-0000-4000-8000-000000000030",
                0,
                &document,
                &graph
            )
            .await
            .unwrap()
            .revision,
            1
        );
    }
}

async fn verify_workspace_assets(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    snapshot: &str,
) -> Result<Vec<String>, String> {
    use sha2::{Digest, Sha256};
    let value: serde_json::Value =
        serde_json::from_str(snapshot).map_err(|_| "invalid_story_storage_request")?;
    // Low-level test snapshots are opaque. Composite production snapshots have
    // an explicit contract and collect only actual typed nodes, never metadata.
    if value["schemaId"] != "https://komyaku.example/schemas/story-workspace/v1" {
        return Ok(vec![]);
    }
    let mut pending: Vec<&serde_json::Value> = value["document"]["content"]
        .as_array()
        .ok_or("invalid_story_workspace_document")?
        .iter()
        .collect();
    let mut references = std::collections::BTreeMap::new();
    let mut count = 0;
    while let Some(node) = pending.pop() {
        count += 1;
        if count > 100_000 {
            return Err("story_document_limit_exceeded".into());
        }
        if node["type"] == "file" || node["type"] == "image" {
            let id = node["assetId"]
                .as_str()
                .filter(|id| super::valid_lower_uuid(id))
                .ok_or("invalid_story_asset_reference")?;
            let media = node["mediaType"]
                .as_str()
                .ok_or("invalid_story_asset_reference")?;
            if references.insert(id, media).is_some_and(|old| old != media) {
                return Err("story_asset_media_mismatch".into());
            }
        }
        if let Some(artifacts) = node["renderArtifacts"].as_array() {
            if artifacts.len() > 20 {
                return Err("invalid_story_asset_reference".into());
            }
            for artifact in artifacts {
                let id = artifact["assetId"]
                    .as_str()
                    .filter(|id| super::valid_lower_uuid(id))
                    .ok_or("invalid_story_asset_reference")?;
                let media = artifact["mediaType"]
                    .as_str()
                    .ok_or("invalid_story_asset_reference")?;
                if references.insert(id, media).is_some_and(|old| old != media) {
                    return Err("story_asset_media_mismatch".into());
                }
            }
        }
        for field in ["content", "caption"] {
            if let Some(children) = node[field].as_array() {
                pending.extend(children);
            }
        }
    }
    for (id, media) in &references {
        let asset:Option<(Vec<u8>,i64,String,String)>=sqlx::query_as("SELECT bytes,byte_size,content_hash,media_type FROM local_archive_assets WHERE asset_id=?")
            .bind(id).fetch_optional(&mut **tx).await.map_err(|e|e.to_string())?;
        let (bytes, size, hash, stored_media) = asset.ok_or("missing_story_workspace_asset")?;
        if stored_media != *media {
            return Err("story_asset_media_mismatch".into());
        }
        if size != bytes.len() as i64
            || bytes.is_empty()
            || bytes.len() > 1024 * 1024
            || Sha256::digest(&bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
                != hash
        {
            return Err("story_asset_integrity_mismatch".into());
        }
    }
    Ok(references.keys().map(|id| id.to_string()).collect())
}

#[cfg(test)]
mod asset_tests {
    use super::*;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    #[tokio::test]
    async fn missing_or_corrupt_render_artifacts_cannot_adopt_workspace() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        migrate(&pool).await.unwrap();
        sqlx::query("CREATE TABLE local_archive_assets(asset_id TEXT,bytes BLOB,byte_size INTEGER,content_hash TEXT,media_type TEXT)")
            .execute(&pool).await.unwrap();
        let asset = "00000000-0000-4000-8000-000000000009";
        let snapshot=json!({"schemaId":"https://komyaku.example/schemas/story-workspace/v1","document":{"content":[{"type":"horizontal_rule","renderArtifacts":[{"assetId":asset,"role":"render-cache","mediaType":"text/plain"}]}]}}).to_string();
        assert_eq!(
            commit(&pool, "w", "op", 0, "{}", &snapshot)
                .await
                .unwrap_err(),
            "missing_story_workspace_asset"
        );
        let file_snapshot=json!({"schemaId":"https://komyaku.example/schemas/story-workspace/v1","document":{"content":[{"type":"file","assetId":asset,"mediaType":"text/plain"}]}}).to_string();
        assert_eq!(
            commit(&pool, "w", "file-op", 0, "{}", &file_snapshot)
                .await
                .unwrap_err(),
            "missing_story_workspace_asset"
        );
        sqlx::query("INSERT INTO local_archive_assets VALUES (?,?,?,?,?)")
            .bind(asset)
            .bind(b"hello".as_slice())
            .bind(5i64)
            .bind("0".repeat(64))
            .bind("text/plain")
            .execute(&pool)
            .await
            .unwrap();
        assert_eq!(
            commit(&pool, "w", "op", 0, "{}", &snapshot)
                .await
                .unwrap_err(),
            "story_asset_integrity_mismatch"
        );
        sqlx::query("UPDATE local_archive_assets SET content_hash=?")
            .bind(
                Sha256::digest(b"hello")
                    .iter()
                    .map(|byte| format!("{byte:02x}"))
                    .collect::<String>(),
            )
            .execute(&pool)
            .await
            .unwrap();
        let saved = commit(&pool, "w", "op", 0, "{}", &snapshot).await.unwrap();
        assert_eq!(saved.revision, 1);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_assets")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let conflicting=json!({"schemaId":"https://komyaku.example/schemas/story-workspace/v1","document":{"content":[{"type":"file","assetId":asset,"mediaType":"text/plain","renderArtifacts":[{"assetId":asset,"role":"preview","mediaType":"image/png"}]}]}}).to_string();
        assert_eq!(
            commit(&pool, "w", "conflict", 1, "{}", &conflicting)
                .await
                .unwrap_err(),
            "story_asset_media_mismatch"
        );
        let revision: i64 = sqlx::query_scalar(
            "SELECT revision FROM story_workspace_states WHERE workspace_id='w'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(revision, 1);
        sqlx::query("CREATE TRIGGER reject_receipt BEFORE INSERT ON story_workspace_receipts BEGIN SELECT RAISE(ABORT,'fail'); END").execute(&pool).await.unwrap();
        let empty=json!({"schemaId":"https://komyaku.example/schemas/story-workspace/v1","document":{"content":[]}}).to_string();
        assert!(commit(&pool, "w", "op2", 1, "{}", &empty).await.is_err());
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_assets")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }
}
