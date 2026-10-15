//! Durable local reviews. The journal is written before adoption; editor draft,
//! composite history, receipt and journal completion commit in one transaction.
use super::{story_workspace_proposal as proposals, story_workspace_runtime as runtime};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Sqlite, Transaction};
pub(crate) const SCHEMA: &str = include_str!("../migrations/0012_story_agent_reviews.sql");
fn err<E>(_: E) -> String {
    "story_review_storage_unavailable".into()
}
fn hash(s: &str) -> String {
    Sha256::digest(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn id(s: &str) -> Result<(), String> {
    if super::valid_lower_uuid(s) {
        Ok(())
    } else {
        Err("invalid_story_review_id".into())
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Stage {
    pub review_id: String,
    pub proposal: proposals::Proposal,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Review {
    pub review_id: String,
    pub workspace_id: String,
    pub status: String,
    pub proposal: proposals::Proposal,
    pub candidate_hash: String,
    pub snapshot_json: String,
    pub base_snapshot_json: String,
}

pub(crate) async fn load(pool: &Pool<Sqlite>, review_id: &str) -> Result<Review, String> {
    id(review_id)?;
    let row:Option<(String,Option<String>,Option<String>,String,String)>=sqlx::query_as(
        "SELECT workspace_id,CASE WHEN length(CAST(proposal_json AS BLOB))<=25165824 THEN proposal_json END,
         CASE WHEN length(CAST(candidate_json AS BLOB))<=25165824 THEN candidate_json END,candidate_hash,status FROM story_agent_reviews WHERE review_id=?")
        .bind(review_id).fetch_optional(pool).await.map_err(err)?;
    let (workspace_id, proposal, candidate, candidate_hash, status) =
        row.ok_or("missing_story_review")?;
    let proposal: proposals::Proposal =
        serde_json::from_str(&proposal.ok_or("invalid_stored_story_review")?).map_err(err)?;
    let candidate = candidate.ok_or("invalid_stored_story_review")?;
    if hash(&candidate) != candidate_hash {
        return Err("story_review_hash_mismatch".into());
    }
    let base:Option<(Option<String>,String)>=sqlx::query_as("SELECT CASE WHEN length(CAST(snapshot_json AS BLOB))<=25165824 THEN snapshot_json END,snapshot_hash FROM story_workspace_versions WHERE workspace_id=? AND version_id=?")
        .bind(&workspace_id).bind(&proposal.base_version_id).fetch_optional(pool).await.map_err(err)?;
    let (base, base_hash) = base.ok_or("missing_story_version")?;
    let base = base.ok_or("invalid_stored_story_workspace")?;
    if hash(&base) != base_hash || base_hash != proposal.base_snapshot_hash {
        return Err("story_version_hash_mismatch".into());
    }
    let command = super::story_workspace_commands::parse(&proposal.command_json)?;
    if command.graph_id != workspace_id
        || super::story_workspace_commands::derive(&base, &command)? != candidate
    {
        return Err("invalid_stored_story_review".into());
    }
    Ok(Review {
        review_id: review_id.into(),
        workspace_id,
        status,
        proposal,
        candidate_hash,
        snapshot_json: candidate,
        base_snapshot_json: base,
    })
}
pub(crate) async fn list(pool: &Pool<Sqlite>, document_id: &str) -> Result<Vec<Value>, String> {
    id(document_id)?;
    let rows:Vec<(String,String,String)>=sqlx::query_as(
        "SELECT r.review_id,r.workspace_id,r.status FROM story_agent_reviews r JOIN story_workspace_states s USING(workspace_id)
         WHERE json_extract(s.snapshot_json,'$.document.id')=? AND r.status IN ('review','attempting') ORDER BY r.review_id LIMIT 33")
        .bind(document_id).fetch_all(pool).await.map_err(err)?;
    if rows.len() > 32 {
        return Err("story_review_list_limit".into());
    }
    Ok(rows.into_iter().map(|(review_id,workspace_id,status)|json!({"reviewId":review_id,"workspaceId":workspace_id,"status":status})).collect())
}
async fn lock(tx: &mut Transaction<'_, Sqlite>) -> Result<(), String> {
    sqlx::query("UPDATE story_agent_reviews SET status=status WHERE 0")
        .execute(&mut **tx)
        .await
        .map_err(err)?;
    Ok(())
}
pub(crate) async fn stage(pool: &Pool<Sqlite>, input: Stage) -> Result<Review, String> {
    id(&input.review_id)?;
    let preview = proposals::preview(pool, &input.proposal).await?;
    let proposal_json = serde_json::to_string(&input.proposal).map_err(err)?;
    if proposal_json.len() > 24 * 1024 * 1024 {
        return Err("invalid_story_review".into());
    }
    let mut tx = pool.begin().await.map_err(err)?;
    lock(&mut tx).await?;
    let prior: Option<String> =
        sqlx::query_scalar("SELECT proposal_json FROM story_agent_reviews WHERE review_id=?")
            .bind(&input.review_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(err)?;
    if let Some(prior) = prior {
        if prior != proposal_json {
            return Err("story_review_collision".into());
        }
        tx.commit().await.map_err(err)?;
        return load(pool, &input.review_id).await;
    }
    let (count,bytes):(i64,i64)=sqlx::query_as("SELECT count(*),coalesce(sum(length(CAST(candidate_json AS BLOB))+length(CAST(proposal_json AS BLOB))),0) FROM story_agent_reviews WHERE workspace_id=? AND status IN ('review','attempting')")
        .bind(&preview.workspace_id).fetch_one(&mut *tx).await.map_err(err)?;
    if count >= 8
        || bytes as usize + proposal_json.len() + preview.snapshot_json.len() > 64 * 1024 * 1024
    {
        return Err("story_review_limit".into());
    }
    let workspace: Value = serde_json::from_str(&preview.snapshot_json).map_err(err)?;
    if workspace["document"].to_string().len() > 12 * 1024 * 1024 {
        return Err("story_review_editor_limit".into());
    }
    let base: String = sqlx::query_scalar(
        "SELECT snapshot_json FROM story_workspace_versions WHERE workspace_id=? AND version_id=?",
    )
    .bind(&preview.workspace_id)
    .bind(&input.proposal.base_version_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(err)?;
    check_draft(&mut tx, &base).await?;
    let assets =
        super::story_workspace_store::verify_workspace_assets(&mut tx, &preview.snapshot_json)
            .await?;
    sqlx::query("INSERT INTO story_agent_reviews(review_id,workspace_id,proposal_json,candidate_json,candidate_hash,status) VALUES(?,?,?,?,?,'review')")
        .bind(&input.review_id).bind(&preview.workspace_id).bind(proposal_json).bind(&preview.snapshot_json).bind(&preview.candidate_hash).execute(&mut *tx).await.map_err(err)?;
    for asset in assets {
        sqlx::query("INSERT INTO story_agent_review_assets VALUES(?,?)")
            .bind(&input.review_id)
            .bind(asset)
            .execute(&mut *tx)
            .await
            .map_err(err)?;
    }
    sqlx::query("UPDATE local_archive_assets SET lifecycle_status='active',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE asset_id IN (SELECT asset_id FROM story_agent_review_assets WHERE review_id=?)")
        .bind(&input.review_id).execute(&mut *tx).await.map_err(err)?;
    tx.commit().await.map_err(err)?;
    load(pool, &input.review_id).await
}
async fn check_draft(
    tx: &mut Transaction<'_, Sqlite>,
    base: &str,
) -> Result<(String, i64), String> {
    let base: Value = serde_json::from_str(base).map_err(err)?;
    let document_id = base["document"]["id"]
        .as_str()
        .ok_or("invalid_stored_story_workspace")?;
    let row:Option<(String,i64,i64)>=sqlx::query_as("SELECT d.content_json,d.local_revision,d.is_composing FROM local_drafts d JOIN local_documents l ON l.id=d.document_id WHERE d.document_id=? AND l.deleted_at IS NULL AND l.archived_at IS NULL")
        .bind(document_id).fetch_optional(&mut **tx).await.map_err(err)?;
    let (document, revision, composing) = row.ok_or("story_review_editor_required")?;
    if revision < 0
        || revision >= 9_007_199_254_740_990
        || composing != 0
        || document.len() > 24 * 1024 * 1024
        || serde_json::from_str::<Value>(&document).map_err(err)? != base["document"]
    {
        return Err("story_review_editor_changed".into());
    }
    Ok((document_id.into(), revision))
}
async fn uuid(tx: &mut Transaction<'_, Sqlite>) -> Result<String, String> {
    let raw: String = sqlx::query_scalar("SELECT lower(hex(randomblob(16)))")
        .fetch_one(&mut **tx)
        .await
        .map_err(err)?;
    Ok(format!(
        "{}-{}-4{}-8{}-{}",
        &raw[..8],
        &raw[8..12],
        &raw[13..16],
        &raw[17..20],
        &raw[20..]
    ))
}
pub(crate) async fn attempt(
    pool: &Pool<Sqlite>,
    review_id: &str,
) -> Result<runtime::CaptureResult, String> {
    let review = load(pool, review_id).await?;
    let mut tx = pool.begin().await.map_err(err)?;
    lock(&mut tx).await?;
    let (status, stored): (String, Option<String>) =
        sqlx::query_as("SELECT status,adoption_json FROM story_agent_reviews WHERE review_id=?")
            .bind(review_id)
            .fetch_one(&mut *tx)
            .await
            .map_err(err)?;
    if status == "rejected" {
        return Err("story_review_rejected".into());
    }
    let input: proposals::Adoption = if let Some(stored) = stored {
        serde_json::from_str(&stored).map_err(err)?
    } else {
        check_draft(&mut tx, &review.base_snapshot_json).await?;
        let input = proposals::Adoption {
            proposal: review.proposal,
            operation_id: uuid(&mut tx).await?,
            version_id: uuid(&mut tx).await?,
            candidate_hash: review.candidate_hash,
            label: None,
        };
        sqlx::query(
            "UPDATE story_agent_reviews SET adoption_json=?,status='attempting' WHERE review_id=?",
        )
        .bind(serde_json::to_string(&input).map_err(err)?)
        .bind(review_id)
        .execute(&mut *tx)
        .await
        .map_err(err)?;
        input
    };
    tx.commit().await.map_err(err)?;
    proposals::adopt_inner(pool, input, Some(review_id)).await
}
pub(crate) async fn reject(pool: &Pool<Sqlite>, review_id: &str) -> Result<(), String> {
    id(review_id)?;
    let mut tx = pool.begin().await.map_err(err)?;
    lock(&mut tx).await?;
    let status: Option<String> =
        sqlx::query_scalar("SELECT status FROM story_agent_reviews WHERE review_id=?")
            .bind(review_id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(err)?;
    if status.as_deref() == Some("adopted") {
        return Err("story_review_already_adopted".into());
    }
    if status.is_none() {
        return Err("missing_story_review".into());
    }
    sqlx::query("UPDATE story_agent_reviews SET status='rejected' WHERE review_id=?")
        .bind(review_id)
        .execute(&mut *tx)
        .await
        .map_err(err)?;
    sqlx::query("DELETE FROM story_agent_review_assets WHERE review_id=?")
        .bind(review_id)
        .execute(&mut *tx)
        .await
        .map_err(err)?;
    tx.commit().await.map_err(err)?;
    Ok(())
}
pub(crate) async fn finish(
    tx: &mut Transaction<'_, Sqlite>,
    review_id: &str,
    request: &str,
    snapshot: &str,
) -> Result<(), String> {
    let (status,stored,base_id,workspace_id):(String,String,String,String)=sqlx::query_as(
        "SELECT status,adoption_json,json_extract(proposal_json,'$.baseVersionId'),workspace_id FROM story_agent_reviews WHERE review_id=?")
        .bind(review_id).fetch_one(&mut **tx).await.map_err(err)?;
    if status != "attempting" || stored != request {
        return Err("story_review_adoption_changed".into());
    }
    let base: String = sqlx::query_scalar(
        "SELECT snapshot_json FROM story_workspace_versions WHERE workspace_id=? AND version_id=?",
    )
    .bind(workspace_id)
    .bind(base_id)
    .fetch_one(&mut **tx)
    .await
    .map_err(err)?;
    let (document_id, revision) = check_draft(tx, &base).await?;
    let candidate: Value = serde_json::from_str(snapshot).map_err(err)?;
    let document = &candidate["document"];
    if document.to_string().len() > 12 * 1024 * 1024 {
        return Err("story_review_editor_limit".into());
    }
    let now: String = sqlx::query_scalar("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now')")
        .fetch_one(&mut **tx)
        .await
        .map_err(err)?;
    let updated=sqlx::query("UPDATE local_drafts SET content_json=?,local_revision=?,updated_at=? WHERE document_id=? AND local_revision=? AND is_composing=0")
        .bind(document.to_string()).bind(revision+1).bind(&now).bind(&document_id).bind(revision).execute(&mut **tx).await.map_err(err)?;
    if updated.rows_affected() != 1 {
        return Err("story_review_editor_changed".into());
    }
    sqlx::query("UPDATE local_documents SET title=?,default_language=?,default_direction=?,default_writing_mode=?,updated_at=? WHERE id=?")
        .bind(document.pointer("/metadata/title").and_then(Value::as_str).unwrap_or(""))
        .bind(document.pointer("/attrs/language").and_then(Value::as_str).unwrap_or("und"))
        .bind(document.pointer("/attrs/direction").and_then(Value::as_str).unwrap_or("auto"))
        .bind(document.pointer("/attrs/writingMode").and_then(Value::as_str).unwrap_or("horizontal-tb"))
        .bind(&now).bind(&document_id).execute(&mut **tx).await.map_err(err)?;
    let assets = super::story_workspace_store::verify_workspace_assets(tx, snapshot).await?;
    sqlx::query("DELETE FROM local_document_asset_references WHERE document_id=?")
        .bind(&document_id)
        .execute(&mut **tx)
        .await
        .map_err(err)?;
    sqlx::query("DELETE FROM local_archive_asset_references WHERE document_id=?")
        .bind(&document_id)
        .execute(&mut **tx)
        .await
        .map_err(err)?;
    for asset in assets {
        sqlx::query("INSERT INTO local_document_asset_references(document_id,asset_id,updated_at) SELECT ?,asset_id,? FROM local_asset_previews WHERE asset_id=?")
            .bind(&document_id).bind(&now).bind(&asset).execute(&mut **tx).await.map_err(err)?;
        sqlx::query("INSERT INTO local_archive_asset_references(document_id,asset_id,updated_at) SELECT ?,asset_id,? FROM local_archive_assets WHERE asset_id=?")
            .bind(&document_id).bind(&now).bind(&asset).execute(&mut **tx).await.map_err(err)?;
        sqlx::query("UPDATE local_archive_assets SET lifecycle_status='active',updated_at=? WHERE asset_id=?")
            .bind(&now).bind(&asset).execute(&mut **tx).await.map_err(err)?;
        sqlx::query("UPDATE local_asset_previews SET lifecycle_status='active',last_referenced_at=?,quarantined_at=NULL WHERE asset_id=?")
            .bind(&now).bind(&asset).execute(&mut **tx).await.map_err(err)?;
    }
    sqlx::query(
        "UPDATE story_agent_reviews SET status='adopted',editor_revision=? WHERE review_id=?",
    )
    .bind(revision + 1)
    .bind(review_id)
    .execute(&mut **tx)
    .await
    .map_err(err)?;
    sqlx::query("DELETE FROM story_agent_review_assets WHERE review_id=?")
        .bind(review_id)
        .execute(&mut **tx)
        .await
        .map_err(err)?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Checkpoint {
    pub workspace_id: String,
    pub operation_id: String,
    pub version_id: String,
    pub expected_revision: i64,
    pub expected_head_id: String,
    pub branch_id: String,
}
pub(crate) async fn checkpoint(
    pool: &Pool<Sqlite>,
    input: Checkpoint,
) -> Result<runtime::CaptureResult, String> {
    for value in [
        &input.workspace_id,
        &input.operation_id,
        &input.version_id,
        &input.expected_head_id,
        &input.branch_id,
    ] {
        id(value)?;
    }
    if !(1..9_007_199_254_740_991).contains(&input.expected_revision) {
        return Err("invalid_story_review_checkpoint".into());
    }
    let request = json!({"type":"editor-checkpoint-v1","input":input}).to_string();
    let result = |revision, replayed| runtime::CaptureResult {
        workspace_id: input.workspace_id.clone(),
        version_id: input.version_id.clone(),
        branch_id: input.branch_id.clone(),
        revision,
        replayed,
    };
    let previous:Option<(String,String,i64)>=sqlx::query_as("SELECT workspace_id,request_json,revision FROM story_workspace_receipts WHERE operation_id=?")
        .bind(&input.operation_id).fetch_optional(pool).await.map_err(err)?;
    if let Some((workspace, stored, revision)) = previous {
        if workspace != input.workspace_id || stored != request {
            return Err("story_operation_collision".into());
        }
        return Ok(result(revision, true));
    }
    let current = runtime::read(pool, &input.workspace_id).await?;
    if current.revision != input.expected_revision {
        return Err("stale_story_workspace_revision".into());
    }
    if current.current_version_id.as_ref() != Some(&input.expected_head_id)
        || current.current_branch_id.as_ref() != Some(&input.branch_id)
    {
        return Err("stale_story_history_selection".into());
    }
    let workspace: Value = serde_json::from_str(&current.snapshot_json).map_err(err)?;
    let document_id = workspace["document"]["id"]
        .as_str()
        .ok_or("invalid_stored_story_workspace")?;
    let draft:String=sqlx::query_scalar("SELECT d.content_json FROM local_drafts d JOIN local_documents l ON l.id=d.document_id WHERE d.document_id=? AND d.is_composing=0 AND l.deleted_at IS NULL AND l.archived_at IS NULL")
        .bind(document_id).fetch_one(pool).await.map_err(err)?;
    if draft.len() > 24 * 1024 * 1024 {
        return Err("invalid_story_review_checkpoint".into());
    }
    let document: Value = serde_json::from_str(&draft).map_err(err)?;
    let command=super::story_workspace_commands::parse(&json!({"documentId":document_id,"graphId":input.workspace_id,"expectedRevision":current.revision,"operations":[{"type":"replace-document","document":document}]}).to_string())?;
    let candidate = super::story_workspace_commands::derive(&current.snapshot_json, &command)?;
    let branch_name: String = sqlx::query_scalar(
        "SELECT name FROM story_workspace_branches WHERE workspace_id=? AND branch_id=?",
    )
    .bind(&input.workspace_id)
    .bind(&input.branch_id)
    .fetch_one(pool)
    .await
    .map_err(err)?;
    let history = super::story_workspace_history::HistoryCommit {
        version_id: input.version_id.clone(),
        branch_id: input.branch_id.clone(),
        branch_name,
        expected_branch_id: Some(input.branch_id.clone()),
        expected_head_id: Some(input.expected_head_id.clone()),
        parent_ids: vec![input.expected_head_id.clone()],
        kind: "named".into(),
        source_branch_id: None,
        restored_from_id: None,
        metadata: None,
    };
    let receipt = super::story_workspace_store::adopt_owned_candidate(
        pool,
        &input.workspace_id,
        &input.operation_id,
        input.expected_revision,
        &request,
        &candidate,
        &history,
        &None,
    )
    .await?;
    Ok(result(receipt.revision, receipt.replayed))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn uid(n: usize) -> String {
        format!("00000000-0000-4000-8000-{n:012x}")
    }
    async fn seed(db: &Pool<Sqlite>) -> Stage {
        crate::tests::migrate_test_pool(db).await;
        sqlx::raw_sql(SCHEMA).execute(db).await.unwrap();
        let workspace: Value = serde_json::from_str(include_str!(
            "../../../../packages/story-graph/test/fixtures/query-workspace.json"
        ))
        .unwrap();
        let document = &workspace["document"];
        sqlx::query("INSERT INTO local_documents(id,created_at,updated_at) VALUES(?,'2026-10-15T00:00:00Z','2026-10-15T00:00:00Z')").bind(uid(1)).execute(db).await.unwrap();
        sqlx::query("INSERT INTO local_drafts(document_id,schema_version,content_json,local_revision,updated_at) VALUES(?,1,?,1,'2026-10-15T00:00:00Z')")
            .bind(uid(1)).bind(document.to_string()).execute(db).await.unwrap();
        runtime::initialize(db,serde_json::from_value(json!({"operationId":uid(300),"versionId":uid(200),"branchId":uid(400),"branchName":"Main","label":null,
            "document":document,"graph":workspace["graph"]})).unwrap()).await.unwrap();
        let state = runtime::read(db, &uid(3)).await.unwrap();
        let mut after = document.clone();
        after["content"][0]["content"] = json!([{"type":"text","text":"確認 / Reviewed / 已审核","marks":[],"metadata":{},"extensions":{}}]);
        Stage{review_id:uid(500),proposal:proposals::Proposal{base_version_id:uid(200),branch_id:uid(400),base_snapshot_hash:hash(&state.snapshot_json),command_json:json!({"documentId":uid(1),"graphId":uid(3),"expectedRevision":1,"operations":[{"type":"replace-document","document":after}]}).to_string()}}
    }
    #[tokio::test]
    async fn reviews_and_uncertain_requests_recover_and_editor_adoption_is_atomic() {
        let path = std::env::temp_dir().join(format!(
            "komyaku-review-recovery-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let settings = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(settings.clone())
            .await
            .unwrap();
        let input = seed(&db).await;
        let review_id = input.review_id.clone();
        let reviewed = stage(&db, input).await.unwrap();
        assert_eq!(list(&db, &uid(1)).await.unwrap().len(), 1);
        assert_eq!(runtime::read(&db, &uid(3)).await.unwrap().revision, 1);
        db.close().await;
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(settings.clone())
            .await
            .unwrap();
        let restored = load(&db, &review_id).await.unwrap();
        assert_eq!(restored.snapshot_json, reviewed.snapshot_json);
        assert_eq!(restored.status, "review");
        // Failure after editor mirroring must roll back draft, history and journal
        // completion, while the prepared IDs stay durable for an exact retry.
        sqlx::query("CREATE TRIGGER fail_review_completion BEFORE UPDATE OF status ON story_agent_reviews WHEN NEW.status='adopted' BEGIN SELECT RAISE(ABORT,'injected'); END").execute(&db).await.unwrap();
        assert!(attempt(&db, &review_id).await.is_err());
        let (status, prepared): (String, String) = sqlx::query_as(
            "SELECT status,adoption_json FROM story_agent_reviews WHERE review_id=?",
        )
        .bind(&review_id)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(status, "attempting");
        let (draft, revision): (String, i64) = sqlx::query_as(
            "SELECT content_json,local_revision FROM local_drafts WHERE document_id=?",
        )
        .bind(uid(1))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(revision, 1);
        assert!(!draft.contains("Reviewed"));
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM story_workspace_versions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 1);
        sqlx::query("DROP TRIGGER fail_review_completion")
            .execute(&db)
            .await
            .unwrap();
        db.close().await;
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(settings)
            .await
            .unwrap();
        let stored: String =
            sqlx::query_scalar("SELECT adoption_json FROM story_agent_reviews WHERE review_id=?")
                .bind(&review_id)
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(prepared, stored);
        let accepted = attempt(&db, &review_id).await.unwrap();
        assert!(!accepted.replayed);
        assert_eq!(load(&db, &review_id).await.unwrap().status, "adopted");
        assert!(list(&db, &uid(1)).await.unwrap().is_empty());
        let (draft, revision): (String, i64) = sqlx::query_as(
            "SELECT content_json,local_revision FROM local_drafts WHERE document_id=?",
        )
        .bind(uid(1))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(revision, 2);
        assert!(draft.contains("Reviewed"));
        // Retry after a newer ordinary edit must not copy the old adopted prose
        // back over that edit or allocate another Version.
        sqlx::query("UPDATE local_drafts SET local_revision=3,content_json=replace(content_json,'Reviewed','Later')").execute(&db).await.unwrap();
        assert!(attempt(&db, &review_id).await.unwrap().replayed);
        let text: String = sqlx::query_scalar("SELECT content_json FROM local_drafts")
            .fetch_one(&db)
            .await
            .unwrap();
        assert!(text.contains("Later"));
        assert_eq!(
            reject(&db, &review_id).await.unwrap_err(),
            "story_review_already_adopted"
        );
        db.close().await;
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn changed_editor_and_rejected_reviews_cannot_be_adopted() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let input = seed(&db).await;
        let review_id = input.review_id.clone();
        stage(&db, input).await.unwrap();
        sqlx::query("UPDATE local_drafts SET content_json=replace(content_json,'und','ja'),local_revision=2").execute(&db).await.unwrap();
        assert_eq!(
            attempt(&db, &review_id).await.unwrap_err(),
            "story_review_editor_changed"
        );
        assert_eq!(runtime::read(&db, &uid(3)).await.unwrap().revision, 1);
        reject(&db, &review_id).await.unwrap();
        assert_eq!(
            attempt(&db, &review_id).await.unwrap_err(),
            "story_review_rejected"
        );
        assert!(list(&db, &uid(1)).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn rejection_revokes_a_prepared_native_adoption_and_rolls_back_its_writes() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let input = seed(&db).await;
        let review_id = input.review_id.clone();
        let saved = stage(&db, input).await.unwrap();
        let adoption = proposals::Adoption {
            proposal: saved.proposal,
            operation_id: uid(301),
            version_id: uid(201),
            candidate_hash: saved.candidate_hash,
            label: None,
        };
        sqlx::query(
            "UPDATE story_agent_reviews SET status='attempting',adoption_json=? WHERE review_id=?",
        )
        .bind(serde_json::to_string(&adoption).unwrap())
        .bind(&review_id)
        .execute(&db)
        .await
        .unwrap();
        reject(&db, &review_id).await.unwrap();
        assert_eq!(
            proposals::adopt_inner(&db, adoption, Some(&review_id))
                .await
                .unwrap_err(),
            "story_review_adoption_changed"
        );
        assert_eq!(runtime::read(&db, &uid(3)).await.unwrap().revision, 1);
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM story_workspace_versions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn editor_checkpoint_versions_current_prose_atomically_and_replays() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let _ = seed(&db).await;
        let mut document: Value = serde_json::from_str::<Value>(
            &runtime::read(&db, &uid(3)).await.unwrap().snapshot_json,
        )
        .unwrap()["document"]
            .clone();
        document["metadata"]["title"] = json!("編集済み / Edited / 已编辑");
        sqlx::query("UPDATE local_drafts SET content_json=?,local_revision=2")
            .bind(document.to_string())
            .execute(&db)
            .await
            .unwrap();
        let input = || Checkpoint {
            workspace_id: uid(3),
            operation_id: uid(302),
            version_id: uid(202),
            expected_revision: 1,
            expected_head_id: uid(200),
            branch_id: uid(400),
        };
        assert!(!checkpoint(&db, input()).await.unwrap().replayed);
        let state = runtime::read(&db, &uid(3)).await.unwrap();
        assert_eq!(state.current_version_id, Some(uid(202)));
        assert_eq!(
            serde_json::from_str::<Value>(&state.snapshot_json).unwrap()["document"],
            document
        );
        assert!(checkpoint(&db, input()).await.unwrap().replayed);
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM story_workspace_versions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 2);
    }

    #[tokio::test]
    async fn pending_candidate_assets_are_retained_then_transferred_to_immutable_history() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mut input = seed(&db).await;
        let asset = uid(900);
        sqlx::query("INSERT INTO local_archive_assets(asset_id,bytes,byte_size,content_hash,media_type,inspection_policy_version,lifecycle_status,created_at,updated_at) VALUES(?,?,5,?,'text/plain','baseline-signature-v1','quarantined','2026-10-15T00:00:00Z','2026-10-15T00:00:00Z')")
            .bind(&asset).bind(b"hello".as_slice()).bind(hash("hello")).execute(&db).await.unwrap();
        let mut command: Value = serde_json::from_str(&input.proposal.command_json).unwrap();
        command["operations"][0]["document"]["content"][0]["renderArtifacts"] =
            json!([{"assetId":asset,"role":"render-cache","mediaType":"text/plain"}]);
        input.proposal.command_json = command.to_string();
        let review_id = input.review_id.clone();
        stage(&db, input).await.unwrap();
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM local_retained_asset_references WHERE asset_id=?",
        )
        .bind(&asset)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(count, 1);
        let status: String = sqlx::query_scalar(
            "SELECT lifecycle_status FROM local_archive_assets WHERE asset_id=?",
        )
        .bind(&asset)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(status, "active");
        attempt(&db, &review_id).await.unwrap();
        let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM story_agent_review_assets")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(pending, 0);
        let kept: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM story_workspace_version_assets WHERE asset_id=?",
        )
        .bind(&asset)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(kept, 1);
        let linked: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM local_archive_asset_references WHERE asset_id=?",
        )
        .bind(&asset)
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(linked, 1);
    }
}
