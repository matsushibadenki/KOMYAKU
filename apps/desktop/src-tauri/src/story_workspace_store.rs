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
