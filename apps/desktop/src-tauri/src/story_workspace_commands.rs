//! Internal composite command subset. Document replacement supports only
//! normalized prose/source/file blocks; remaining rich content fails closed. No public IPC yet.
use super::story_workspace_store::{commit, Receipt};
use serde::Deserialize;
use serde_json::Value;
use sqlx::{Pool, Sqlite};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Command {
    document_id: String,
    graph_id: String,
    expected_revision: i64,
    operations: Vec<Operation>,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum Operation {
    ReplaceDocument { document: Value },
    Put { collection: String, value: Value },
    Remove { collection: String, id: String },
}

pub(crate) async fn execute(
    pool: &Pool<Sqlite>,
    operation_id: &str,
    command_json: &str,
) -> Result<Receipt, String> {
    if !super::valid_lower_uuid(operation_id) || command_json.len() > 24 * 1024 * 1024 {
        return Err("invalid_story_command".into());
    }
    let command: Command =
        serde_json::from_str(command_json).map_err(|_| "invalid_story_command")?;
    if !super::valid_lower_uuid(&command.document_id)
        || !super::valid_lower_uuid(&command.graph_id)
        || !(0..=9_007_199_254_740_990).contains(&command.expected_revision)
        || command.operations.is_empty()
        || command.operations.len() > 100
    {
        return Err("invalid_story_command".into());
    }
    for operation in &command.operations {
        let (collection, id) = match operation {
            Operation::ReplaceDocument { document } => {
                super::story_document_validation::validate_document_subset(document)?;
                if document["id"].as_str() != Some(&command.document_id) {
                    return Err("story_command_workspace_mismatch".into());
                }
                continue;
            }
            Operation::Put { collection, value } => (
                collection,
                value["id"].as_str().ok_or("invalid_story_command")?,
            ),
            Operation::Remove { collection, id } => (collection, id.as_str()),
        };
        if !["nodes", "edges", "paths", "entities"].contains(&collection.as_str())
            || !super::valid_lower_uuid(id)
        {
            return Err("invalid_story_command".into());
        }
    }
    let value: Value = serde_json::from_str(command_json).map_err(|_| "invalid_story_command")?;
    let request =
        serde_json::to_string(&serde_json::json!({"operationId":operation_id,"command":value}))
            .map_err(|e| e.to_string())?;
    // Check durable receipt before reading/deriving a new candidate. The commit
    // primitive repeats this check under its writer reservation.
    let receipt:Option<(String,String,i64,String)>=sqlx::query_as(
        "SELECT workspace_id, request_json, revision, snapshot_json FROM story_workspace_receipts WHERE operation_id=?")
        .bind(operation_id).fetch_optional(pool).await.map_err(|e|e.to_string())?;
    if let Some((owner, previous, revision, snapshot_json)) = receipt {
        if owner != command.graph_id || previous != request {
            return Err("story_operation_collision".into());
        }
        return Ok(Receipt {
            revision,
            snapshot_json,
            replayed: true,
        });
    }
    let current: Option<(i64, String)> = sqlx::query_as(
        "SELECT revision,snapshot_json FROM story_workspace_states WHERE workspace_id=?",
    )
    .bind(&command.graph_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let (revision, snapshot) = current.ok_or("missing_story_workspace")?;
    if revision != command.expected_revision {
        return commit(
            pool,
            &command.graph_id,
            operation_id,
            command.expected_revision,
            &request,
            "{}",
        )
        .await;
    }
    let mut workspace: Value =
        serde_json::from_str(&snapshot).map_err(|_| "invalid_stored_story_workspace")?;
    if workspace["document"]["id"].as_str() != Some(&command.document_id)
        || workspace["graph"]["id"].as_str() != Some(&command.graph_id)
    {
        return Err("story_command_workspace_mismatch".into());
    }
    for operation in command.operations {
        if let Operation::ReplaceDocument { document } = &operation {
            workspace["document"] = document.clone();
            continue;
        }
        let (collection, id, replacement) = match operation {
            Operation::ReplaceDocument { .. } => unreachable!(),
            Operation::Put { collection, value } => (
                collection,
                value["id"].as_str().unwrap().to_string(),
                Some(value),
            ),
            Operation::Remove { collection, id } => (collection, id, None),
        };
        let items = workspace["graph"][&collection]
            .as_array_mut()
            .ok_or("invalid_stored_story_workspace")?;
        let index = items
            .iter()
            .position(|item| item["id"].as_str() == Some(&id));
        match (index, replacement) {
            (Some(index), Some(value)) => items[index] = value,
            (None, Some(value)) => items.push(value),
            (Some(index), None) => {
                items.remove(index);
            }
            (None, None) => return Err("missing_story_command_target".into()),
        }
    }
    let canonical =
        super::story_document_validation::validate_document_subset(&workspace["document"])?;
    super::story_graph_validation::validate_graph_schema(&workspace["graph"], &canonical)
        .map_err(str::to_string)?;
    let proposed = serde_json::to_string(&workspace).map_err(|e| e.to_string())?;
    // CAS at commit prevents applying the derived candidate over a concurrent edit.
    commit(
        pool,
        &command.graph_id,
        operation_id,
        revision,
        &request,
        &proposed,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn id(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012x}")
    }
    #[tokio::test]
    async fn commands_validate_final_graph_and_replay_without_reapplying() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        super::super::story_workspace_store::migrate(&pool)
            .await
            .unwrap();
        let document = super::super::story_document_validation::tests::document();
        let graph = json!({"schemaId":"https://komyaku.example/schemas/story-graph/v1","schemaVersion":1,"id":id(2),"documentId":id(1),"nodes":[],"edges":[],"paths":[],"entities":[]});
        super::super::story_workspace_store::commit_workspace(&pool, &id(3), 0, &document, &graph)
            .await
            .unwrap();
        let node = json!({"id":id(4),"kind":"content","subtype":"scene","title":"場面","documentRefs":[],"preconditions":[],"effects":[]});
        let command=json!({"documentId":id(1),"graphId":id(2),"expectedRevision":1,"operations":[{"type":"put","collection":"nodes","value":node}]}).to_string();
        let mut invalid: Value = serde_json::from_str(&command).unwrap();
        invalid["operations"][0]["value"]["documentRefs"] = json!([{"nodeId":id(99)}]);
        assert_eq!(
            execute(&pool, &id(9), &invalid.to_string())
                .await
                .unwrap_err(),
            "missing_canonical_node_reference"
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_receipts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let saved = execute(&pool, &id(5), &command).await.unwrap();
        assert_eq!(saved.revision, 2);
        let remove=json!({"documentId":id(1),"graphId":id(2),"expectedRevision":2,"operations":[{"type":"remove","collection":"nodes","id":id(4)}]}).to_string();
        execute(&pool, &id(6), &remove).await.unwrap();
        let replay = execute(&pool, &id(5), &command).await.unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.snapshot_json, saved.snapshot_json);
        let revision: i64 = sqlx::query_scalar("SELECT revision FROM story_workspace_states")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(revision, 3);
        let replacement = serde_json::json!({"schemaId":"https://komyaku.example/schemas/document/v1","schemaVersion":1,
            "id":id(1),"type":"document","attrs":{"language":"ja","direction":"auto","writingMode":"horizontal-tb"},
            "metadata":{"title":"置換本文"},"extensions":{},"content":[{"id":id(13),"schemaVersion":1,"provenance":{"createdAt":"2026-10-07T12:34:56+09:00","createdBy":id(14),"sourceVersionId":id(15)},"type":"paragraph","attrs":{"lang":null,"dir":"auto"},"content":[],"metadata":{},"extensions":{},"renderArtifacts":[]}]});
        let replace = serde_json::json!({"documentId":id(1),"graphId":id(2),"expectedRevision":3,
            "operations":[{"type":"replace-document","document":replacement}]})
        .to_string();
        let changed = execute(&pool, &id(12), &replace).await.unwrap();
        assert_eq!(changed.revision, 4);
        let restored: Value = serde_json::from_str(&changed.snapshot_json).unwrap();
        assert_eq!(restored["document"], replacement);
        assert!(execute(&pool, &id(12), &replace).await.unwrap().replayed);
        let mut empty = replacement.clone();
        empty["content"] = json!([]);
        let invalid_replace = json!({"documentId":id(1),"graphId":id(2),"expectedRevision":4,
            "operations":[{"type":"replace-document","document":empty}]})
        .to_string();
        assert_eq!(
            execute(&pool, &id(16), &invalid_replace).await.unwrap_err(),
            "invalid_story_document"
        );
        let revision: i64 = sqlx::query_scalar("SELECT revision FROM story_workspace_states")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(revision, 4);
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM story_workspace_receipts WHERE operation_id=?",
        )
        .bind(id(16))
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(count, 0);

        assert_eq!(
            execute(&pool, &id(5), &remove).await.unwrap_err(),
            "story_operation_collision"
        );
        assert_eq!(
            execute(&pool, &id(7), &command).await.unwrap_err(),
            "stale_story_workspace_revision"
        );
    }
    #[tokio::test]
    async fn invalid_stored_document_cannot_be_readopted_by_graph_edit() {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        super::super::story_workspace_store::migrate(&pool)
            .await
            .unwrap();
        let document = super::super::story_document_validation::tests::document();
        let graph = json!({"schemaId":"https://komyaku.example/schemas/story-graph/v1","schemaVersion":1,"id":id(20),"documentId":document["id"],"nodes":[],"edges":[],"paths":[],"entities":[]});
        let saved = super::super::story_workspace_store::commit_workspace(
            &pool,
            &id(21),
            0,
            &document,
            &graph,
        )
        .await
        .unwrap();
        let mut corrupted: Value = serde_json::from_str(&saved.snapshot_json).unwrap();
        corrupted["document"]["content"] = json!([]);
        let snapshot = corrupted.to_string();
        sqlx::query("UPDATE story_workspace_states SET snapshot_json=?")
            .bind(&snapshot)
            .execute(&pool)
            .await
            .unwrap();
        let command = json!({"documentId":document["id"],"graphId":id(20),"expectedRevision":1,"operations":[{"type":"put","collection":"entities","value":{"id":id(22),"type":"character","name":"人物","initialState":{}}}]}).to_string();
        assert_eq!(
            execute(&pool, &id(23), &command).await.unwrap_err(),
            "invalid_story_document"
        );
        let current: (i64, String) =
            sqlx::query_as("SELECT revision,snapshot_json FROM story_workspace_states")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(current, (1, snapshot));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_receipts")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
        pool.close().await;
    }
    #[tokio::test]
    async fn concurrent_commands_adopt_only_one_expected_revision() {
        let path = std::env::temp_dir().join(format!(
            "komyaku-story-race-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true)
            .busy_timeout(std::time::Duration::from_secs(5));
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(2)
            .connect_with(options)
            .await
            .unwrap();
        super::super::story_workspace_store::migrate(&pool)
            .await
            .unwrap();
        let document = super::super::story_document_validation::tests::document();
        let graph = json!({"schemaId":"https://komyaku.example/schemas/story-graph/v1","schemaVersion":1,"id":id(20),"documentId":document["id"],"nodes":[],"edges":[],"paths":[],"entities":[]});
        super::super::story_workspace_store::commit_workspace(&pool, &id(21), 0, &document, &graph)
            .await
            .unwrap();
        let command = |entity| {
            json!({"documentId":document["id"],"graphId":id(20),"expectedRevision":1,"operations":[{"type":"put","collection":"entities","value":{"id":id(entity),"type":"character","name":format!("人物{entity}"),"initialState":{}}}]}).to_string()
        };
        let left = command(22);
        let right = command(23);
        let left_id = id(24);
        let right_id = id(25);
        let (a, b) = tokio::join!(
            execute(&pool, &left_id, &left),
            execute(&pool, &right_id, &right)
        );
        assert_eq!(usize::from(a.is_ok()) + usize::from(b.is_ok()), 1);
        let (saved, rejected, operation, request) = match (a, b) {
            (Ok(saved), Err(error)) => (saved, error, left_id, left),
            (Err(error), Ok(saved)) => (saved, error, right_id, right),
            _ => unreachable!(),
        };
        assert_eq!(rejected, "stale_story_workspace_revision");
        assert_eq!(saved.revision, 2);
        let snapshot: Value = serde_json::from_str(&saved.snapshot_json).unwrap();
        assert_eq!(snapshot["graph"]["entities"].as_array().unwrap().len(), 1);
        let receipt_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_receipts")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(receipt_count, 2);
        let replay = execute(&pool, &operation, &request).await.unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.snapshot_json, saved.snapshot_json);
        pool.close().await;
        std::fs::remove_file(path).unwrap();
    }
}
