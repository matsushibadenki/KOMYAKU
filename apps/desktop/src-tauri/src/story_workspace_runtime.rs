//! Rust-owned initialization, edits, reads, discovery and history capture.
//! Restore and reviewed merge remain separate runtime gates.
use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Summary {
    pub workspace_id: String,
    pub document_id: String,
    pub revision: i64,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    pub items: Vec<Summary>,
    pub next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct CaptureRequest {
    pub workspace_id: String,
    pub operation_id: String,
    pub expected_revision: i64,
    pub version_id: String,
    pub branch_id: String,
    pub branch_name: String,
    pub expected_branch_id: String,
    pub expected_head_id: String,
    pub kind: String,
    pub label: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CaptureResult {
    pub workspace_id: String,
    pub version_id: String,
    pub branch_id: String,
    pub revision: i64,
    pub replayed: bool,
}
pub(crate) async fn capture(
    pool: &Pool<Sqlite>,
    input: CaptureRequest,
) -> Result<CaptureResult, String> {
    if !(1..=9_007_199_254_740_990).contains(&input.expected_revision) {
        return Err("invalid_story_capture_revision".into());
    }
    let history = super::story_workspace_history::HistoryCommit {
        version_id: input.version_id.clone(),
        branch_id: input.branch_id.clone(),
        branch_name: input.branch_name,
        expected_branch_id: Some(input.expected_branch_id),
        expected_head_id: Some(input.expected_head_id.clone()),
        parent_ids: vec![input.expected_head_id],
        kind: input.kind,
        source_branch_id: None,
        restored_from_id: None,
        metadata: None,
    };
    let receipt = super::story_workspace_history::capture_owned_current(
        pool,
        &input.workspace_id,
        &input.operation_id,
        input.expected_revision,
        &history,
        input.label,
    )
    .await?;
    Ok(CaptureResult {
        workspace_id: input.workspace_id,
        version_id: input.version_id,
        branch_id: input.branch_id,
        revision: receipt.revision,
        replayed: receipt.replayed,
    })
}

pub(crate) async fn list(pool: &Pool<Sqlite>, after: Option<&str>) -> Result<Page, String> {
    if after.is_some_and(|cursor| !super::valid_lower_uuid(cursor)) {
        return Err("invalid_story_workspace_cursor".into());
    }
    let rows: Vec<(String, Option<String>, i64, Option<String>)> = sqlx::query_as(
        "SELECT workspace_id,
                CASE WHEN length(CAST(snapshot_json AS BLOB)) > 25165824 THEN NULL
                     WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json,'$.document.id') END,
                revision,
                CASE WHEN length(CAST(snapshot_json AS BLOB)) > 25165824 THEN NULL
                     WHEN json_valid(snapshot_json) THEN json_extract(snapshot_json,'$.graph.id') END
         FROM story_workspace_states WHERE workspace_id > ? ORDER BY workspace_id LIMIT 101",
    )
    .bind(after.unwrap_or(""))
    .fetch_all(pool)
    .await
    .map_err(|_| "story_workspace_list_unavailable")?;
    let mut items = Vec::with_capacity(rows.len());
    for (workspace_id, document_id, revision, graph_id) in rows {
        let document_id = document_id.ok_or("invalid_stored_story_workspace")?;
        if !super::valid_lower_uuid(&workspace_id)
            || !super::valid_lower_uuid(&document_id)
            || graph_id.as_deref() != Some(workspace_id.as_str())
            || !(1..=9_007_199_254_740_991).contains(&revision)
        {
            return Err("invalid_stored_story_workspace".into());
        }
        items.push(Summary {
            workspace_id,
            document_id,
            revision,
        });
    }
    let next_cursor = if items.len() > 100 {
        items.truncate(100);
        items.last().map(|item| item.workspace_id.clone())
    } else {
        None
    };
    Ok(Page { items, next_cursor })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn capture_boundary_derives_parents_and_returns_only_stable_receipt_metadata() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        super::super::story_workspace_store::migrate(&db)
            .await
            .unwrap();
        let id = |n| format!("00000000-0000-4000-8000-{n:012}");
        let document = super::super::story_document_validation::tests::document();
        let graph = serde_json::json!({"schemaId":"https://komyaku.example/schemas/story-graph/v1","schemaVersion":1,
            "id":id(10),"documentId":document["id"],"entities":[],"nodes":[],"edges":[],"paths":[]});
        let initial = super::super::story_workspace_history::HistoryCommit {
            version_id: id(20),
            branch_id: id(30),
            branch_name: "Main".into(),
            expected_branch_id: None,
            expected_head_id: None,
            parent_ids: vec![],
            kind: "initial".into(),
            source_branch_id: None,
            restored_from_id: None,
            metadata: None,
        };
        super::super::story_workspace_history::save_candidate(
            &db,
            &id(50),
            0,
            &document,
            &graph,
            &initial,
        )
        .await
        .unwrap();
        let request = serde_json::json!({"workspaceId":id(10),"operationId":id(51),"expectedRevision":1,
            "versionId":id(21),"branchId":id(30),"branchName":"Main","expectedBranchId":id(30),
            "expectedHeadId":id(20),"kind":"named","label":"日本語 English 简体中文"});
        let result = capture(&db, serde_json::from_value(request.clone()).unwrap())
            .await
            .unwrap();
        assert_eq!(result.revision, 2);
        assert!(!result.replayed);
        let serialized = serde_json::to_value(&result).unwrap();
        assert_eq!(serialized.as_object().unwrap().len(), 5);
        let parent: String = sqlx::query_scalar(
            "SELECT parent_id FROM story_workspace_version_parents WHERE version_id=?",
        )
        .bind(id(21))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(parent, id(20));
        assert!(
            capture(&db, serde_json::from_value(request.clone()).unwrap())
                .await
                .unwrap()
                .replayed
        );
        for key in ["authorId", "createdAt", "snapshotJson", "parentIds"] {
            let mut spoof = request.clone();
            spoof[key] = serde_json::json!("caller");
            assert!(serde_json::from_value::<CaptureRequest>(spoof).is_err());
        }
        let mut alternative = request.clone();
        alternative["operationId"] = serde_json::json!(id(52));
        alternative["versionId"] = serde_json::json!(id(22));
        alternative["branchId"] = serde_json::json!(id(31));
        alternative["branchName"] = serde_json::json!("Alternative");
        alternative["kind"] = serde_json::json!("alternative");
        alternative["expectedRevision"] = serde_json::json!(2);
        alternative["expectedHeadId"] = serde_json::json!(id(21));
        capture(&db, serde_json::from_value(alternative).unwrap())
            .await
            .unwrap();
        assert!(
            capture(&db, serde_json::from_value(request.clone()).unwrap())
                .await
                .unwrap()
                .replayed
        );
        let revision: i64 = sqlx::query_scalar("SELECT revision FROM story_workspace_states")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(revision, 3);
        let mut stale = request;
        stale["operationId"] = serde_json::json!(id(53));
        assert_eq!(
            capture(&db, serde_json::from_value(stale).unwrap())
                .await
                .unwrap_err(),
            "stale_story_workspace_revision"
        );
    }
    #[tokio::test]
    async fn discovery_pages_without_content_or_mutation_and_rejects_corrupt_identity() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        super::super::story_workspace_store::migrate(&db)
            .await
            .unwrap();
        assert!(list(&db, None).await.unwrap().items.is_empty());
        for n in (1..=102).rev() {
            let id = format!("00000000-0000-4000-8000-{n:012}");
            let snapshot = serde_json::json!({"document":{"id":id},"graph":{"id":id},"private":"not transferred"}).to_string();
            sqlx::query("INSERT INTO story_workspace_states VALUES(?,1,?)")
                .bind(id)
                .bind(snapshot)
                .execute(&db)
                .await
                .unwrap();
        }
        let first = list(&db, None).await.unwrap();
        assert_eq!(first.items.len(), 100);
        let second = list(&db, first.next_cursor.as_deref()).await.unwrap();
        assert_eq!(second.items.len(), 2);
        assert!(second.next_cursor.is_none());
        assert!(first.items.last().unwrap().workspace_id < second.items[0].workspace_id);
        assert!(!serde_json::to_string(&first).unwrap().contains("private"));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_receipts")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 0);
        assert_eq!(
            list(&db, Some("invalid")).await.unwrap_err(),
            "invalid_story_workspace_cursor"
        );
        sqlx::query("UPDATE story_workspace_states SET snapshot_json='{}' WHERE workspace_id=?")
            .bind(&second.items[0].workspace_id)
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(
            list(&db, first.next_cursor.as_deref()).await.unwrap_err(),
            "invalid_stored_story_workspace"
        );
        sqlx::query(
            "UPDATE story_workspace_states SET snapshot_json='not-json' WHERE workspace_id=?",
        )
        .bind(&second.items[0].workspace_id)
        .execute(&db)
        .await
        .unwrap();
        assert_eq!(
            list(&db, first.next_cursor.as_deref()).await.unwrap_err(),
            "invalid_stored_story_workspace"
        );
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InitializeRequest {
    pub operation_id: String,
    pub version_id: String,
    pub branch_id: String,
    pub branch_name: String,
    pub label: Option<String>,
    pub document: serde_json::Value,
    pub graph: serde_json::Value,
}
pub(crate) async fn initialize(
    pool: &Pool<Sqlite>,
    input: InitializeRequest,
) -> Result<CaptureResult, String> {
    if !super::valid_lower_uuid(&input.operation_id)
        || input
            .label
            .as_ref()
            .is_some_and(|label| label.encode_utf16().count() > 1000)
    {
        return Err("invalid_story_initialize_request".into());
    }
    let history = super::story_workspace_history::HistoryCommit {
        version_id: input.version_id.clone(),
        branch_id: input.branch_id.clone(),
        branch_name: input.branch_name,
        expected_branch_id: None,
        expected_head_id: None,
        parent_ids: vec![],
        kind: "initial".into(),
        source_branch_id: None,
        restored_from_id: None,
        metadata: None,
    };
    super::story_workspace_history::validate(&history)?;
    let ids = super::story_document_validation::validate_document_subset(&input.document)?;
    if input.graph["documentId"] != input.document["id"] {
        return Err("story_workspace_document_mismatch".into());
    }
    super::story_graph_validation::validate_graph_schema(&input.graph, &ids)
        .map_err(str::to_string)?;
    let workspace_id = input.graph["id"]
        .as_str()
        .ok_or("invalid_story_graph")?
        .to_string();
    let snapshot =
        serde_json::json!({"schemaId":"https://komyaku.example/schemas/story-workspace/v1",
        "schemaVersion":1,"document":input.document,"graph":input.graph})
        .to_string();
    let request = serde_json::json!({"kind":"initialize-owned-v1","operationId":input.operation_id,
        "snapshot":snapshot,"history":history,"label":input.label})
    .to_string();
    let receipt = super::story_workspace_store::initialize_owned_history(
        pool,
        &workspace_id,
        &input.operation_id,
        &request,
        &snapshot,
        &history,
        &input.label,
    )
    .await?;
    Ok(CaptureResult {
        workspace_id,
        version_id: input.version_id,
        branch_id: input.branch_id,
        revision: receipt.revision,
        replayed: receipt.replayed,
    })
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CurrentState {
    pub workspace_id: String,
    pub revision: i64,
    pub snapshot_json: String,
    pub current_branch_id: Option<String>,
    pub current_version_id: Option<String>,
}
pub(crate) async fn read(pool: &Pool<Sqlite>, workspace_id: &str) -> Result<CurrentState, String> {
    if !super::valid_lower_uuid(workspace_id) {
        return Err("invalid_story_workspace_id".into());
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|_| "story_workspace_read_unavailable")?;
    let row: Option<(i64, String)> = sqlx::query_as(
        "SELECT revision,snapshot_json FROM story_workspace_states WHERE workspace_id=?",
    )
    .bind(workspace_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| "story_workspace_read_unavailable")?;
    let (revision, snapshot_json) = row.ok_or("missing_story_workspace")?;
    if !(1..=9_007_199_254_740_991).contains(&revision) || snapshot_json.len() > 24 * 1024 * 1024 {
        return Err("invalid_stored_story_workspace".into());
    }
    let value: serde_json::Value =
        serde_json::from_str(&snapshot_json).map_err(|_| "invalid_stored_story_workspace")?;
    if value.as_object().is_none_or(|o| {
        o.len() != 4
            || o.keys()
                .any(|k| !["schemaId", "schemaVersion", "document", "graph"].contains(&k.as_str()))
    }) || value["schemaId"] != "https://komyaku.example/schemas/story-workspace/v1"
        || value["schemaVersion"] != 1
        || value["graph"]["id"].as_str() != Some(workspace_id)
        || value["graph"]["documentId"] != value["document"]["id"]
    {
        return Err("invalid_stored_story_workspace".into());
    }
    let ids = super::story_document_validation::validate_document_subset(&value["document"])?;
    super::story_graph_validation::validate_graph_schema(&value["graph"], &ids)
        .map_err(str::to_string)?;
    let selection: Option<(String, String)> = sqlx::query_as(
        "SELECT branch_id,version_id FROM story_workspace_selection WHERE workspace_id=?",
    )
    .bind(workspace_id)
    .fetch_optional(&mut *tx)
    .await
    .map_err(|_| "story_workspace_read_unavailable")?;
    if selection
        .as_ref()
        .is_some_and(|(b, v)| !super::valid_lower_uuid(b) || !super::valid_lower_uuid(v))
    {
        return Err("invalid_stored_story_workspace".into());
    }
    tx.commit()
        .await
        .map_err(|_| "story_workspace_read_unavailable")?;
    let (current_branch_id, current_version_id) = selection
        .map(|(b, v)| (Some(b), Some(v)))
        .unwrap_or((None, None));
    Ok(CurrentState {
        workspace_id: workspace_id.into(),
        revision,
        snapshot_json,
        current_branch_id,
        current_version_id,
    })
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct EditRequest {
    pub operation_id: String,
    pub command_json: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EditResult {
    pub workspace_id: String,
    pub revision: i64,
    pub replayed: bool,
}
pub(crate) async fn edit(pool: &Pool<Sqlite>, input: EditRequest) -> Result<EditResult, String> {
    let receipt =
        super::story_workspace_commands::execute(pool, &input.operation_id, &input.command_json)
            .await?;
    let value: serde_json::Value = serde_json::from_str(&receipt.snapshot_json)
        .map_err(|_| "invalid_stored_story_workspace")?;
    let workspace_id = value["graph"]["id"]
        .as_str()
        .ok_or("invalid_stored_story_workspace")?
        .to_string();
    Ok(EditResult {
        workspace_id,
        revision: receipt.revision,
        replayed: receipt.replayed,
    })
}

#[cfg(test)]
mod full_flow_tests {
    use super::*;
    use serde_json::json;
    #[tokio::test]
    async fn initialize_edit_capture_and_restart_keep_authoritative_state_and_exact_retries() {
        let path = std::env::temp_dir().join(format!(
            "komyaku-runtime-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::File::create(&path).unwrap();
        let url = format!("sqlite:{}", path.display());
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        super::super::story_workspace_store::migrate(&db)
            .await
            .unwrap();
        let id = |n| format!("00000000-0000-4000-8000-{n:012}");
        let document = super::super::story_document_validation::tests::document();
        let initial = json!({"operationId":id(50),"versionId":id(20),"branchId":id(30),"branchName":"Main","label":null,
            "document":document,"graph":{"schemaId":"https://komyaku.example/schemas/story-graph/v1","schemaVersion":1,
                "id":id(10),"documentId":document["id"],"entities":[],"nodes":[],"edges":[],"paths":[]}});
        let initialized = initialize(&db, serde_json::from_value(initial.clone()).unwrap())
            .await
            .unwrap();
        assert_eq!(initialized.revision, 1);
        assert!(!initialized.replayed);
        let base = read(&db, &id(10)).await.unwrap();
        assert_eq!(base.current_version_id, Some(id(20)));
        let command=json!({"documentId":document["id"],"graphId":id(10),"expectedRevision":1,"operations":[
            {"type":"put","collection":"nodes","value":{"id":id(11),"kind":"content","subtype":"scene","title":"日本語 English 简体中文","documentRefs":[],"preconditions":[],"effects":[]}},
            {"type":"put","collection":"paths","value":{"id":id(12),"name":"Route A","nodeIds":[id(11)]}}]}).to_string();
        let edited = edit(
            &db,
            EditRequest {
                operation_id: id(51),
                command_json: command.clone(),
            },
        )
        .await
        .unwrap();
        assert_eq!(edited.revision, 2);
        let working = read(&db, &id(10)).await.unwrap();
        assert_eq!(working.current_version_id, Some(id(20)));
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&working.snapshot_json).unwrap()["graph"]
                ["paths"][0]["name"],
            "Route A"
        );
        let capture_request = json!({"workspaceId":id(10),"operationId":id(52),"expectedRevision":2,
            "versionId":id(21),"branchId":id(30),"branchName":"Main","expectedBranchId":id(30),"expectedHeadId":id(20),"kind":"named","label":null});
        capture(
            &db,
            serde_json::from_value(capture_request.clone()).unwrap(),
        )
        .await
        .unwrap();
        let current = read(&db, &id(10)).await.unwrap();
        assert_eq!(current.revision, 3);
        assert_eq!(current.current_version_id, Some(id(21)));
        assert_eq!(current.snapshot_json, working.snapshot_json);
        let authors: Vec<String> = sqlx::query_scalar(
            "SELECT author_id FROM story_workspace_versions ORDER BY version_id",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(authors.len(), 2);
        assert_eq!(authors[0], authors[1]);
        let mut collision = initial.clone();
        collision["operationId"] = json!(id(53));
        assert!(initialize(&db, serde_json::from_value(collision).unwrap())
            .await
            .is_err());
        db.close().await;
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&url)
            .await
            .unwrap();
        assert!(
            initialize(&db, serde_json::from_value(initial).unwrap())
                .await
                .unwrap()
                .replayed
        );
        assert!(
            edit(
                &db,
                EditRequest {
                    operation_id: id(51),
                    command_json: command
                }
            )
            .await
            .unwrap()
            .replayed
        );
        assert!(
            capture(&db, serde_json::from_value(capture_request).unwrap())
                .await
                .unwrap()
                .replayed
        );
        let recovered = read(&db, &id(10)).await.unwrap();
        assert_eq!(recovered.revision, 3);
        assert_eq!(recovered.snapshot_json, current.snapshot_json);
        let receipts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_receipts")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(receipts, 3);
        db.close().await;
        std::fs::remove_file(path).unwrap();
    }
}
