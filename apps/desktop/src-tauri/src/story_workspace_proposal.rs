//! Native review preview and atomic, explicitly requested single-parent adoption.
//! No external Agent authentication or two-parent merge is implied.
use super::{story_workspace_commands as commands, story_workspace_runtime as runtime};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Sqlite};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Proposal {
    pub command_json: String,
    pub base_version_id: String,
    pub branch_id: String,
    pub base_snapshot_hash: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    pub workspace_id: String,
    pub revision: i64,
    pub base_version_id: String,
    pub branch_id: String,
    pub base_snapshot_hash: String,
    pub candidate_hash: String,
    pub snapshot_json: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Adoption {
    pub proposal: Proposal,
    pub operation_id: String,
    pub version_id: String,
    pub candidate_hash: String,
    pub label: Option<String>,
}
fn hash(s: &str) -> String {
    Sha256::digest(s.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}
fn valid_hash(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn validate(input: &Proposal) -> Result<commands::Command, String> {
    if !super::valid_lower_uuid(&input.base_version_id)
        || !super::valid_lower_uuid(&input.branch_id)
        || !valid_hash(&input.base_snapshot_hash)
    {
        return Err("invalid_story_proposal".into());
    }
    let command = commands::parse(&input.command_json)?;
    if command.expected_revision < 1 {
        return Err("invalid_story_proposal".into());
    }
    Ok(command)
}
pub(crate) async fn preview(pool: &Pool<Sqlite>, input: &Proposal) -> Result<Preview, String> {
    let command = validate(input)?;
    let current = runtime::read(pool, &command.graph_id).await?;
    if current.revision != command.expected_revision {
        return Err("stale_story_workspace_revision".into());
    }
    if current.current_version_id.as_ref() != Some(&input.base_version_id)
        || current.current_branch_id.as_ref() != Some(&input.branch_id)
    {
        return Err("stale_story_history_selection".into());
    }
    let saved:Option<(Option<String>,String)>=sqlx::query_as(
        "SELECT CASE WHEN length(CAST(snapshot_json AS BLOB))<=25165824 THEN snapshot_json END,snapshot_hash
         FROM story_workspace_versions WHERE workspace_id=? AND version_id=?")
        .bind(&command.graph_id).bind(&input.base_version_id).fetch_optional(pool).await.map_err(|_|"story_proposal_storage_unavailable")?;
    let (snapshot, stored_hash) = saved.ok_or("missing_story_version")?;
    let snapshot = snapshot.ok_or("invalid_stored_story_workspace")?;
    if hash(&snapshot) != stored_hash {
        return Err("story_version_hash_mismatch".into());
    }
    if stored_hash != input.base_snapshot_hash {
        return Err("stale_story_proposal_base".into());
    }
    // A dirty draft must first be explicitly checkpointed; Agent answers and the
    // proposed edit must start from exactly the same declared facts and prose.
    if snapshot != current.snapshot_json {
        return Err("story_agent_checkpoint_required".into());
    }
    let candidate = commands::derive(&snapshot, &command)?;
    if candidate.len() > 24 * 1024 * 1024 {
        return Err("invalid_story_proposal".into());
    }
    Ok(Preview {
        workspace_id: command.graph_id,
        revision: current.revision,
        base_version_id: input.base_version_id.clone(),
        branch_id: input.branch_id.clone(),
        base_snapshot_hash: stored_hash,
        candidate_hash: hash(&candidate),
        snapshot_json: candidate,
    })
}
async fn replay(
    pool: &Pool<Sqlite>,
    operation_id: &str,
    workspace_id: &str,
    request: &str,
) -> Result<Option<i64>, String> {
    let previous:Option<(String,String,i64)>=sqlx::query_as("SELECT workspace_id,request_json,revision FROM story_workspace_receipts WHERE operation_id=?")
        .bind(operation_id).fetch_optional(pool).await.map_err(|_|"story_proposal_storage_unavailable")?;
    if let Some((workspace, previous, revision)) = previous {
        if workspace != workspace_id || previous != request {
            return Err("story_operation_collision".into());
        }
        return Ok(Some(revision));
    }
    Ok(None)
}

pub(crate) async fn adopt(
    pool: &Pool<Sqlite>,
    input: Adoption,
) -> Result<runtime::CaptureResult, String> {
    adopt_inner(pool,input,None).await
}
pub(crate) async fn adopt_inner(pool: &Pool<Sqlite>, input: Adoption, review_id: Option<&str>) -> Result<runtime::CaptureResult,String> {
    let command = validate(&input.proposal)?;
    if !super::valid_lower_uuid(&input.operation_id)
        || !super::valid_lower_uuid(&input.version_id)
        || input.version_id == input.proposal.base_version_id
        || !valid_hash(&input.candidate_hash)
        || input
            .label
            .as_ref()
            .is_some_and(|l| l.encode_utf16().count() > 1000)
    {
        return Err("invalid_story_proposal_adoption".into());
    }
    let request = serde_json::to_string(&input).map_err(|_| "invalid_story_proposal_adoption")?;
    if request.len() > 24 * 1024 * 1024 {
        return Err("invalid_story_proposal_adoption".into());
    }
    let result = |revision, replayed| runtime::CaptureResult {
        workspace_id: command.graph_id.clone(),
        version_id: input.version_id.clone(),
        branch_id: input.proposal.branch_id.clone(),
        revision,
        replayed,
    };
    // Replay precedes fresh state reads. Lost responses remain recoverable even
    // after the working revision/head or local author changes.
    if let Some(revision) = replay(pool, &input.operation_id, &command.graph_id, &request).await? {
        return Ok(result(revision, true));
    }
    let checked = match preview(pool, &input.proposal).await {
        Ok(checked) => checked,
        Err(error) => {
            // Another copy of this exact request can win while preview awaits
            // the current state. Recover its receipt rather than reporting stale.
            if let Some(revision) =
                replay(pool, &input.operation_id, &command.graph_id, &request).await?
            {
                return Ok(result(revision, true));
            }
            return Err(error);
        }
    };
    if checked.candidate_hash != input.candidate_hash {
        return Err("story_proposal_review_mismatch".into());
    }
    let branch_name: String = sqlx::query_scalar(
        "SELECT name FROM story_workspace_branches WHERE workspace_id=? AND branch_id=?",
    )
    .bind(&command.graph_id)
    .bind(&input.proposal.branch_id)
    .fetch_one(pool)
    .await
    .map_err(|_| "missing_story_branch")?;
    let history = super::story_workspace_history::HistoryCommit {
        version_id: input.version_id.clone(),
        branch_id: input.proposal.branch_id.clone(),
        branch_name,
        expected_branch_id: Some(input.proposal.branch_id.clone()),
        expected_head_id: Some(input.proposal.base_version_id.clone()),
        parent_ids: vec![input.proposal.base_version_id.clone()],
        kind: "named".into(),
        source_branch_id: None,
        restored_from_id: None,
        metadata: None,
    };
    let receipt = if let Some(review_id)=review_id {
        super::story_workspace_store::adopt_review_candidate(pool,&command.graph_id,&input.operation_id,
            command.expected_revision,&request,&checked.snapshot_json,&history,&input.label,review_id).await?
    } else {
        super::story_workspace_store::adopt_owned_candidate(pool,&command.graph_id,&input.operation_id,
            command.expected_revision,&request,&checked.snapshot_json,&history,&input.label).await?
    };
    Ok(result(receipt.revision, receipt.replayed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};
    fn id(n: usize) -> String {
        format!("00000000-0000-4000-8000-{n:012x}")
    }
    async fn seed(db: &Pool<Sqlite>) -> Proposal {
        super::super::story_workspace_store::migrate(db)
            .await
            .unwrap();
        let workspace: Value = serde_json::from_str(include_str!(
            "../../../../packages/story-graph/test/fixtures/query-workspace.json"
        ))
        .unwrap();
        runtime::initialize(db,serde_json::from_value(json!({"operationId":id(300),"versionId":id(200),"branchId":id(400),"branchName":"Main","label":null,
            "document":workspace["document"],"graph":workspace["graph"]})).unwrap()).await.unwrap();
        let current = runtime::read(db, &id(3)).await.unwrap();
        let mut node = workspace["graph"]["nodes"][2].clone();
        node["effects"] =
            json!([{"entityId":id(10),"key":"knowledge","operation":"add","value":id(11)}]);
        Proposal {command_json:json!({"documentId":id(1),"graphId":id(3),"expectedRevision":1,"operations":[{"type":"put","collection":"nodes","value":node}]}).to_string(),
            base_version_id:id(200),branch_id:id(400),base_snapshot_hash:hash(&current.snapshot_json)}
    }
    async fn counts(db: &Pool<Sqlite>) -> (i64, i64, i64, i64) {
        sqlx::query_as("SELECT (SELECT revision FROM story_workspace_states),(SELECT count(*) FROM story_workspace_versions),
          (SELECT count(*) FROM story_workspace_receipts),(SELECT count(*) FROM story_workspace_version_parents)").fetch_one(db).await.unwrap()
    }
    #[tokio::test]
    async fn review_guards_atomic_adoption_rollback_and_restart_replay() {
        let path = std::env::temp_dir().join(format!(
            "komyaku-proposal-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(&path)
            .create_if_missing(true);
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options.clone())
            .await
            .unwrap();
        let proposal = seed(&db).await;
        let baseline = runtime::read(&db, &id(3)).await.unwrap().snapshot_json;
        let checked = preview(&db, &proposal).await.unwrap();
        assert_ne!(checked.candidate_hash, proposal.base_snapshot_hash);
        assert_eq!(counts(&db).await, (1, 1, 1, 0));
        let input = Adoption {
            proposal: proposal.clone(),
            operation_id: id(301),
            version_id: id(201),
            candidate_hash: checked.candidate_hash,
            label: Some("確認 / Review / 确认".into()),
        };
        let mut wrong = input.clone();
        wrong.candidate_hash = "0".repeat(64);
        assert_eq!(
            adopt(&db, wrong).await.unwrap_err(),
            "story_proposal_review_mismatch"
        );
        let mut wrong = proposal.clone();
        wrong.base_snapshot_hash = "0".repeat(64);
        assert_eq!(
            preview(&db, &wrong).await.unwrap_err(),
            "stale_story_proposal_base"
        );
        wrong = proposal.clone();
        wrong.branch_id = id(999);
        assert_eq!(
            preview(&db, &wrong).await.unwrap_err(),
            "stale_story_history_selection"
        );
        for field in ["authorId", "snapshotJson", "approved"] {
            let mut spoof = serde_json::to_value(&input).unwrap();
            spoof[field] = json!(true);
            assert!(serde_json::from_value::<Adoption>(spoof).is_err());
        }
        // Final receipt failure rolls back all earlier state/history/head changes.
        sqlx::query("CREATE TRIGGER reject_proposal BEFORE INSERT ON story_workspace_receipts WHEN NEW.operation_id='00000000-0000-4000-8000-00000000012d' BEGIN SELECT RAISE(ABORT,'injected'); END").execute(&db).await.unwrap();
        assert!(adopt(&db, input.clone()).await.is_err());
        assert_eq!(counts(&db).await, (1, 1, 1, 0));
        assert_eq!(
            runtime::read(&db, &id(3)).await.unwrap().snapshot_json,
            baseline
        );
        sqlx::query("DROP TRIGGER reject_proposal")
            .execute(&db)
            .await
            .unwrap();
        let (left, right) = tokio::join!(adopt(&db, input.clone()), adopt(&db, input.clone()));
        let mut replayed = [left.unwrap().replayed, right.unwrap().replayed];
        replayed.sort();
        assert_eq!(replayed, [false, true]);
        assert_eq!(counts(&db).await, (2, 2, 2, 1));
        let state = runtime::read(&db, &id(3)).await.unwrap();
        assert_eq!(state.current_version_id, Some(id(201)));
        assert_eq!(hash(&state.snapshot_json), input.candidate_hash);
        let metadata: (String, String, String) = sqlx::query_as(
            "SELECT author_id,label,created_at FROM story_workspace_versions WHERE version_id=?",
        )
        .bind(id(201))
        .fetch_one(&db)
        .await
        .unwrap();
        assert!(super::super::valid_lower_uuid(&metadata.0));
        assert_eq!(metadata.1, input.label.clone().unwrap());
        assert!(metadata.2.ends_with('Z'));
        // Later draft editing survives retry; the adopted version remains stable.
        let edit=json!({"documentId":id(1),"graphId":id(3),"expectedRevision":2,"operations":[{"type":"put","collection":"entities","value":{"id":id(700),"type":"fact","name":"Later"}}]}).to_string();
        super::super::story_workspace_commands::execute(&db, &id(302), &edit)
            .await
            .unwrap();
        db.close().await;
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        assert!(adopt(&db, input.clone()).await.unwrap().replayed);
        assert_eq!(counts(&db).await, (3, 2, 3, 1));
        let mut collision = input.clone();
        collision.label = None;
        assert_eq!(
            adopt(&db, collision).await.unwrap_err(),
            "story_operation_collision"
        );
        let mut stale = input;
        stale.operation_id = id(303);
        stale.version_id = id(202);
        assert_eq!(
            adopt(&db, stale).await.unwrap_err(),
            "stale_story_workspace_revision"
        );
        assert_eq!(counts(&db).await, (3, 2, 3, 1));
        db.close().await;
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn dirty_draft_cannot_be_presented_as_the_queried_version() {
        let db = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        let mut proposal = seed(&db).await;
        super::super::story_workspace_commands::execute(&db, &id(900), &proposal.command_json)
            .await
            .unwrap();
        let mut command: Value = serde_json::from_str(&proposal.command_json).unwrap();
        command["expectedRevision"] = json!(2);
        proposal.command_json = command.to_string();
        assert_eq!(
            preview(&db, &proposal).await.unwrap_err(),
            "story_agent_checkpoint_required"
        );
        assert_eq!(counts(&db).await, (2, 1, 2, 0));
    }
}
