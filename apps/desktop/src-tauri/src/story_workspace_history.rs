//! Composite history primitives. Owned named/alternative capture is connected
//! through the bounded runtime IPC; candidate/restore/merge helpers stay internal.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use sqlx::{Pool, Sqlite, Transaction};

fn snapshot_hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryMetadata {
    pub author_id: String,
    pub label: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct HistoryCommit {
    pub version_id: String,
    pub branch_id: String,
    pub branch_name: String,
    pub expected_branch_id: Option<String>,
    pub expected_head_id: Option<String>,
    pub parent_ids: Vec<String>,
    pub kind: String,
    pub source_branch_id: Option<String>,
    pub restored_from_id: Option<String>,
    // Omitted for legacy requests, preserving their exact receipt identity.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<HistoryMetadata>,
}

pub(crate) async fn migrate(tx: &mut Transaction<'_, Sqlite>) -> Result<(), sqlx::Error> {
    for sql in [
        "CREATE TABLE IF NOT EXISTS story_workspace_versions (
            workspace_id TEXT NOT NULL REFERENCES story_workspace_states(workspace_id),
            version_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
            revision INTEGER NOT NULL, kind TEXT NOT NULL, restored_from_id TEXT,
            PRIMARY KEY(workspace_id,version_id))",
        "CREATE TABLE IF NOT EXISTS story_workspace_version_parents (
            workspace_id TEXT NOT NULL, version_id TEXT NOT NULL, parent_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL CHECK(ordinal IN (0,1)),
            PRIMARY KEY(workspace_id,version_id,ordinal),
            UNIQUE(workspace_id,version_id,parent_id),
            FOREIGN KEY(workspace_id,version_id) REFERENCES story_workspace_versions(workspace_id,version_id),
            FOREIGN KEY(workspace_id,parent_id) REFERENCES story_workspace_versions(workspace_id,version_id))",
        "CREATE TABLE IF NOT EXISTS story_workspace_branches (
            workspace_id TEXT NOT NULL, branch_id TEXT NOT NULL, name TEXT NOT NULL, head_id TEXT NOT NULL,
            PRIMARY KEY(workspace_id,branch_id), UNIQUE(workspace_id,name),
            FOREIGN KEY(workspace_id,head_id) REFERENCES story_workspace_versions(workspace_id,version_id))",
        "CREATE TABLE IF NOT EXISTS story_workspace_selection (
            workspace_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, version_id TEXT NOT NULL,
            FOREIGN KEY(workspace_id,branch_id) REFERENCES story_workspace_branches(workspace_id,branch_id),
            FOREIGN KEY(workspace_id,version_id) REFERENCES story_workspace_versions(workspace_id,version_id))",
        "CREATE TABLE IF NOT EXISTS story_workspace_version_assets (
            workspace_id TEXT NOT NULL, version_id TEXT NOT NULL, asset_id TEXT NOT NULL,
            PRIMARY KEY(workspace_id,version_id,asset_id),
            FOREIGN KEY(workspace_id,version_id) REFERENCES story_workspace_versions(workspace_id,version_id))",
        "CREATE INDEX IF NOT EXISTS story_workspace_version_assets_asset_idx
            ON story_workspace_version_assets(asset_id)",
    ] {
        sqlx::query(sql).execute(&mut **tx).await?;
    }
    // Upgrade old internal databases without fabricating historical metadata.
    for (table, columns) in [
        (
            "story_workspace_versions",
            &["author_id", "label", "created_at"][..],
        ),
        (
            "story_workspace_branches",
            &["created_at", "updated_at"][..],
        ),
    ] {
        let existing: Vec<(i64, String, String, i64, Option<String>, i64)> =
            sqlx::query_as(&format!("PRAGMA table_info({table})"))
                .fetch_all(&mut **tx)
                .await?;
        for column in columns {
            if !existing.iter().any(|row| row.1 == *column) {
                sqlx::query(&format!("ALTER TABLE {table} ADD COLUMN {column} TEXT"))
                    .execute(&mut **tx)
                    .await?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn id(n: u32) -> String {
        format!("00000000-0000-4000-8000-{n:012}")
    }
    fn graph() -> Value {
        json!({"schemaId":"https://komyaku.example/schemas/story-graph/v1","schemaVersion":1,
            "id":id(10),"documentId":id(1),"entities":[],"edges":[],
            "nodes":[{"id":id(11),"kind":"content","subtype":"scene","title":"日本語 English 简体中文",
                "documentRefs":[{"nodeId":id(2)}],"preconditions":[],"effects":[]}],
            "paths":[{"id":id(12),"name":"A route","nodeIds":[id(11)]}]})
    }
    fn initial() -> HistoryCommit {
        HistoryCommit {
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
        }
    }
    fn next(previous: &HistoryCommit, n: u32, kind: &str) -> HistoryCommit {
        HistoryCommit {
            version_id: id(n),
            expected_branch_id: Some(previous.branch_id.clone()),
            expected_head_id: Some(previous.version_id.clone()),
            parent_ids: vec![previous.version_id.clone()],
            kind: kind.into(),
            source_branch_id: None,
            restored_from_id: None,
            ..previous.clone()
        }
    }
    async fn pool(url: &str) -> Pool<Sqlite> {
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect(url)
            .await
            .unwrap();
        super::super::story_workspace_store::migrate(&pool)
            .await
            .unwrap();
        pool
    }
    async fn state(pool: &Pool<Sqlite>) -> (i64, String) {
        sqlx::query_as(
            "SELECT revision,snapshot_json FROM story_workspace_states WHERE workspace_id=?",
        )
        .bind(id(10))
        .fetch_one(pool)
        .await
        .unwrap()
    }
    #[tokio::test]
    async fn owned_attribution_is_atomic_stable_and_replayed_before_author_lookup() {
        let path = std::env::temp_dir().join(format!(
            "komyaku-local-author-{}-{}.db",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::File::create(&path).unwrap();
        let url = format!("sqlite:{}", path.display());
        let db = pool(&url).await;
        let document = super::super::story_document_validation::tests::document();
        let first = initial();
        save_candidate(&db, &id(50), 0, &document, &graph(), &first)
            .await
            .unwrap();
        let named = next(&first, 21, "named");
        let label = Some("節目 / Milestone / 里程碑".to_string());
        sqlx::query("CREATE TRIGGER reject_owned_receipt BEFORE INSERT ON story_workspace_receipts BEGIN SELECT RAISE(ABORT,'owner rollback'); END")
            .execute(&db).await.unwrap();
        assert!(
            capture_owned_current(&db, &id(10), &id(51), 1, &named, label.clone())
                .await
                .is_err()
        );
        let authors: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_local_author")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(authors, 0);
        assert_eq!(state(&db).await.0, 1);
        sqlx::query("DROP TRIGGER reject_owned_receipt")
            .execute(&db)
            .await
            .unwrap();
        let saved = capture_owned_current(&db, &id(10), &id(51), 1, &named, label.clone())
            .await
            .unwrap();
        let metadata: (String, String, String) = sqlx::query_as(
            "SELECT author_id,label,created_at FROM story_workspace_versions WHERE version_id=?",
        )
        .bind(id(21))
        .fetch_one(&db)
        .await
        .unwrap();
        assert!(super::super::valid_lower_uuid(&metadata.0));
        assert_eq!(metadata.1, label.clone().unwrap());
        assert!(metadata.2.ends_with('Z'));
        let mut alternative = next(&named, 22, "alternative");
        alternative.branch_id = id(31);
        alternative.branch_name = "Alternative".into();
        capture_owned_current(&db, &id(10), &id(52), 2, &alternative, None)
            .await
            .unwrap();
        let author: String =
            sqlx::query_scalar("SELECT author_id FROM story_workspace_versions WHERE version_id=?")
                .bind(id(22))
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(author, metadata.0);
        let current = state(&db).await;
        db.close().await;
        let db = pool(&url).await;
        // Receipt replay does not consult or rewrite a later changed author row.
        sqlx::query("UPDATE story_workspace_local_author SET author_id='00000000-0000-0000-0000-000000000000'")
            .execute(&db).await.unwrap();
        let replay = capture_owned_current(&db, &id(10), &id(51), 1, &named, label.clone())
            .await
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.snapshot_json, saved.snapshot_json);
        assert_eq!(state(&db).await, current);
        let recovered: (String, String, String) = sqlx::query_as(
            "SELECT author_id,label,created_at FROM story_workspace_versions WHERE version_id=?",
        )
        .bind(id(21))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(recovered, metadata);
        assert_eq!(
            capture_owned_current(&db, &id(10), &id(51), 1, &named, Some("different".into()))
                .await
                .unwrap_err(),
            "story_operation_collision"
        );
        let next = next(&alternative, 23, "named");
        assert_eq!(
            capture_owned_current(&db, &id(10), &id(53), 3, &next, None)
                .await
                .unwrap_err(),
            "invalid_story_local_author"
        );
        let mut spoofed = named.clone();
        spoofed.metadata = Some(HistoryMetadata {
            author_id: id(70),
            label: None,
            created_at: "2026-10-09T00:00:00Z".into(),
        });
        assert_eq!(
            capture_owned_current(&db, &id(10), &id(54), 3, &spoofed, None)
                .await
                .unwrap_err(),
            "invalid_story_owned_capture"
        );
        assert_eq!(state(&db).await, current);
        let receipts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_receipts")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(receipts, 3);
        db.close().await;
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn metadata_upgrade_preserves_legacy_receipts_and_atomic_history() {
        let db = pool("sqlite::memory:").await;
        let document = super::super::story_document_validation::tests::document();
        let graph = graph();
        let legacy = initial();
        let receipt = save_candidate(&db, &id(50), 0, &document, &graph, &legacy)
            .await
            .unwrap();
        let request: String =
            sqlx::query_scalar("SELECT request_json FROM story_workspace_receipts")
                .fetch_one(&db)
                .await
                .unwrap();
        let request_value: Value = serde_json::from_str(&request).unwrap();
        assert!(request_value["history"].get("metadata").is_none());
        for (table, columns) in [
            (
                "story_workspace_versions",
                &["author_id", "label", "created_at"][..],
            ),
            (
                "story_workspace_branches",
                &["created_at", "updated_at"][..],
            ),
        ] {
            for column in columns {
                sqlx::query(&format!("ALTER TABLE {table} DROP COLUMN {column}"))
                    .execute(&db)
                    .await
                    .unwrap();
            }
        }
        super::super::story_workspace_store::migrate(&db)
            .await
            .unwrap();
        super::super::story_workspace_store::migrate(&db)
            .await
            .unwrap();
        let replay = save_candidate(&db, &id(50), 0, &document, &graph, &legacy)
            .await
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.snapshot_json, receipt.snapshot_json);
        let old: (Option<String>, Option<String>, Option<String>) = sqlx::query_as(
            "SELECT author_id,label,created_at FROM story_workspace_versions WHERE version_id=?",
        )
        .bind(id(20))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(old, (None, None, None));
        let mut named = next(&legacy, 21, "named");
        named.metadata = Some(HistoryMetadata {
            author_id: id(70),
            label: Some("節目 / Milestone / 里程碑".into()),
            created_at: "2026-10-09T00:00:01.123Z".into(),
        });
        sqlx::query("CREATE TRIGGER reject_metadata_receipt BEFORE INSERT ON story_workspace_receipts BEGIN SELECT RAISE(ABORT,'metadata rollback'); END")
            .execute(&db).await.unwrap();
        assert!(capture_current(&db, &id(10), &id(51), 1, &named)
            .await
            .is_err());
        assert_eq!(state(&db).await, (1, receipt.snapshot_json));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_versions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 1);
        sqlx::query("DROP TRIGGER reject_metadata_receipt")
            .execute(&db)
            .await
            .unwrap();
        capture_current(&db, &id(10), &id(51), 1, &named)
            .await
            .unwrap();
        let saved: (String, String, String) = sqlx::query_as(
            "SELECT author_id,label,created_at FROM story_workspace_versions WHERE version_id=?",
        )
        .bind(id(21))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(
            saved,
            (
                id(70),
                "節目 / Milestone / 里程碑".into(),
                "2026-10-09T00:00:01.123Z".into()
            )
        );
        let branch: (Option<String>, Option<String>) = sqlx::query_as(
            "SELECT created_at,updated_at FROM story_workspace_branches WHERE branch_id=?",
        )
        .bind(id(30))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(branch, (None, Some("2026-10-09T00:00:01.123Z".into())));
        let mut changed = named.clone();
        changed.metadata.as_mut().unwrap().label = Some("changed".into());
        assert_eq!(
            capture_current(&db, &id(10), &id(51), 1, &changed)
                .await
                .unwrap_err(),
            "story_operation_collision"
        );
        let mut alternative = next(&named, 22, "alternative");
        alternative.branch_id = id(31);
        alternative.branch_name = "Alternative".into();
        alternative.metadata.as_mut().unwrap().created_at = "2026-10-09T00:00:02Z".into();
        capture_current(&db, &id(10), &id(52), 2, &alternative)
            .await
            .unwrap();
        let timestamps: (String, String) = sqlx::query_as(
            "SELECT created_at,updated_at FROM story_workspace_branches WHERE branch_id=?",
        )
        .bind(id(31))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(
            timestamps,
            ("2026-10-09T00:00:02Z".into(), "2026-10-09T00:00:02Z".into())
        );
    }

    #[test]
    fn metadata_validation_rejects_invalid_identity_timestamp_and_utf16_overflow() {
        let mut value = initial();
        let valid = HistoryMetadata {
            author_id: id(70),
            label: Some("😀".repeat(500)),
            created_at: "2024-02-29T12:34Z".into(),
        };
        value.metadata = Some(valid.clone());
        assert!(validate(&value).is_ok());
        for metadata in [
            HistoryMetadata {
                author_id: "unknown".into(),
                ..valid.clone()
            },
            HistoryMetadata {
                label: Some("😀".repeat(501)),
                ..valid.clone()
            },
            HistoryMetadata {
                created_at: "2023-02-29T12:34Z".into(),
                ..valid.clone()
            },
            HistoryMetadata {
                created_at: "2024-02-29T12:34+09:00".into(),
                ..valid.clone()
            },
        ] {
            value.metadata = Some(metadata);
            assert_eq!(
                validate(&value).unwrap_err(),
                "invalid_story_history_metadata"
            );
        }
    }

    #[tokio::test]
    async fn authoritative_capture_replays_original_state_and_rejects_stale_or_corrupt_state() {
        let db = pool("sqlite::memory:").await;
        let document = super::super::story_document_validation::tests::document();
        let graph = graph();
        let first = initial();
        let initial_receipt = save_candidate(&db, &id(50), 0, &document, &graph, &first)
            .await
            .unwrap();
        let named = next(&first, 21, "named");
        let saved = capture_current(&db, &id(10), &id(51), 1, &named)
            .await
            .unwrap();
        assert_eq!(saved.snapshot_json, initial_receipt.snapshot_json);
        let mut changed = graph.clone();
        changed["paths"][0]["name"] = json!("changed working path");
        let mut alternative = next(&named, 22, "alternative");
        alternative.branch_id = id(31);
        alternative.branch_name = "別案 / Alternative / 备选".into();
        // Simulate an authoritative working edit without changing the selected history head.
        let snapshot = serde_json::to_string(
            &json!({"schemaId":"https://komyaku.example/schemas/story-workspace/v1",
            "schemaVersion":1,"document":document,"graph":changed}),
        )
        .unwrap();
        super::super::story_workspace_store::commit(&db, &id(10), &id(52), 2, "{}", &snapshot)
            .await
            .unwrap();
        let fork = capture_current(&db, &id(10), &id(53), 3, &alternative)
            .await
            .unwrap();
        assert_eq!(fork.snapshot_json, snapshot);
        let replay = capture_current(&db, &id(10), &id(51), 1, &named)
            .await
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.snapshot_json, saved.snapshot_json);
        assert_eq!(state(&db).await, (4, snapshot.clone()));
        assert_eq!(
            capture_current(&db, &id(10), &id(51), 2, &named)
                .await
                .unwrap_err(),
            "story_operation_collision"
        );
        let after = next(&alternative, 23, "named");
        assert_eq!(
            capture_current(&db, &id(10), &id(54), 3, &after)
                .await
                .unwrap_err(),
            "stale_story_workspace_revision"
        );
        sqlx::query("UPDATE story_workspace_states SET snapshot_json='{}' WHERE workspace_id=?")
            .bind(id(10))
            .execute(&db)
            .await
            .unwrap();
        assert_eq!(
            capture_current(&db, &id(10), &id(54), 4, &after)
                .await
                .unwrap_err(),
            "invalid_stored_story_workspace"
        );
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_versions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 3);
        let receipts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_receipts")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(receipts, 4);
    }

    #[tokio::test]
    async fn composite_versions_restore_and_merge_survive_reopen_with_exact_paths_and_assets() {
        let path = std::env::temp_dir().join(format!(
            "komyaku-story-history-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::File::create(&path).unwrap();
        let url = format!("sqlite:{}", path.display());
        let db = pool(&url).await;
        sqlx::query("CREATE TABLE local_archive_assets(asset_id TEXT,bytes BLOB,byte_size INTEGER,content_hash TEXT,media_type TEXT)")
            .execute(&db).await.unwrap();
        let bytes = "歴史だけの資料 / historical source / 历史资料".as_bytes();
        sqlx::query("INSERT INTO local_archive_assets VALUES(?,?,?,?,?)")
            .bind(id(40))
            .bind(bytes)
            .bind(bytes.len() as i64)
            .bind(snapshot_hash(bytes))
            .bind("text/plain")
            .execute(&db)
            .await
            .unwrap();
        let mut document = super::super::story_document_validation::tests::document();
        document["content"][0]["renderArtifacts"] =
            json!([{"assetId":id(40),"role":"render-cache","mediaType":"text/plain"}]);
        let a_document = document.clone();
        let a_graph = graph();
        let mut a = initial();
        a.metadata = Some(HistoryMetadata {
            author_id: id(70),
            label: Some("日本語 English 简体中文".into()),
            created_at: "2026-10-09T00:00:00Z".into(),
        });
        let first = save_candidate(&db, &id(50), 0, &document, &a_graph, &a)
            .await
            .unwrap();
        document["content"][0]["renderArtifacts"] = json!([]);
        document["content"][0]["content"] = json!([{"type":"text","text":"B 日本語 简体中文","marks":[],"metadata":{},"extensions":{}}]);
        let mut b_graph = a_graph.clone();
        b_graph["paths"][0]["name"] = json!("B route");
        let b = next(&a, 21, "named");
        save_candidate(&db, &id(51), 1, &document, &b_graph, &b)
            .await
            .unwrap();
        let mut c = next(&b, 22, "alternative");
        c.branch_id = id(31);
        c.branch_name = "Alternative".into();
        let mut c_graph = b_graph.clone();
        c_graph["paths"][0]["name"] = json!("C route");
        save_candidate(&db, &id(52), 2, &document, &c_graph, &c)
            .await
            .unwrap();
        let mut restored = next(&c, 23, "restore");
        restored.restored_from_id = Some(a.version_id.clone());
        let restore = save_candidate(&db, &id(53), 3, &a_document, &a_graph, &restored)
            .await
            .unwrap();
        assert_eq!(restore.snapshot_json, first.snapshot_json);
        let mut merged = next(&restored, 24, "merge");
        merged.parent_ids.push(b.version_id.clone());
        merged.source_branch_id = Some(b.branch_id.clone());
        let mut m_graph = c_graph.clone();
        m_graph["paths"][0]["name"] = json!("Reviewed merged route");
        let saved = save_candidate(&db, &id(54), 4, &document, &m_graph, &merged)
            .await
            .unwrap();
        let expected:Vec<(String,String,String)>=sqlx::query_as("SELECT version_id,snapshot_json,snapshot_hash FROM story_workspace_versions ORDER BY version_id")
            .fetch_all(&db).await.unwrap();
        let expected_branches: Vec<(String, String)> = sqlx::query_as(
            "SELECT branch_id,head_id FROM story_workspace_branches ORDER BY branch_id",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(expected_branches, vec![(id(30), id(21)), (id(31), id(24))]);
        let retained: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM story_workspace_version_assets WHERE asset_id=?",
        )
        .bind(id(40))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(retained, 2); // initial + restored, even though merge omits it
        let metadata: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT version_id,author_id,label,created_at FROM story_workspace_versions ORDER BY version_id")
            .fetch_all(&db).await.unwrap();
        assert_eq!(metadata.len(), 5);
        assert!(metadata.iter().all(|row| row.1 == id(70)
            && row.2 == "日本語 English 简体中文"
            && row.3 == "2026-10-09T00:00:00Z"));
        db.close().await;
        let db = pool(&url).await;
        let recovered_metadata: Vec<(String, String, String, String)> = sqlx::query_as(
            "SELECT version_id,author_id,label,created_at FROM story_workspace_versions ORDER BY version_id")
            .fetch_all(&db).await.unwrap();
        assert_eq!(recovered_metadata, metadata);
        assert_eq!(state(&db).await, (5, saved.snapshot_json.clone()));
        let actual:Vec<(String,String,String)>=sqlx::query_as("SELECT version_id,snapshot_json,snapshot_hash FROM story_workspace_versions ORDER BY version_id")
            .fetch_all(&db).await.unwrap();
        assert_eq!(actual, expected);
        let recovered_branches: Vec<(String, String)> = sqlx::query_as(
            "SELECT branch_id,head_id FROM story_workspace_branches ORDER BY branch_id",
        )
        .fetch_all(&db)
        .await
        .unwrap();
        assert_eq!(recovered_branches, expected_branches);
        let recovered_references: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM story_workspace_version_assets WHERE asset_id=?",
        )
        .bind(id(40))
        .fetch_one(&db)
        .await
        .unwrap();
        assert_eq!(recovered_references, 2);
        for (_, snapshot, hash) in actual {
            assert_eq!(hash, snapshot_hash(snapshot.as_bytes()));
        }
        let parents:Vec<String>=sqlx::query_scalar("SELECT parent_id FROM story_workspace_version_parents WHERE version_id=? ORDER BY ordinal")
            .bind(id(24)).fetch_all(&db).await.unwrap();
        assert_eq!(parents, vec![id(23), id(21)]);
        let recovered: Vec<u8> =
            sqlx::query_scalar("SELECT bytes FROM local_archive_assets WHERE asset_id=?")
                .bind(id(40))
                .fetch_one(&db)
                .await
                .unwrap();
        assert_eq!(recovered, bytes);
        let replay = save_candidate(&db, &id(53), 3, &a_document, &a_graph, &restored)
            .await
            .unwrap();
        assert!(replay.replayed);
        assert_eq!(replay.snapshot_json, first.snapshot_json);
        assert_eq!(state(&db).await, (5, saved.snapshot_json));
        assert_eq!(
            save_candidate(&db, &id(53), 3, &document, &m_graph, &merged)
                .await
                .unwrap_err(),
            "story_operation_collision"
        );
        db.close().await;
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn concurrent_history_writers_cannot_silently_replace_a_branch_head() {
        let path = std::env::temp_dir().join(format!(
            "komyaku-story-head-race-{}.db",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::File::create(&path).unwrap();
        let url = format!("sqlite:{}", path.display());
        let left = pool(&url).await;
        let right = pool(&url).await;
        let document = super::super::story_document_validation::tests::document();
        let graph = graph();
        let a = initial();
        save_candidate(&left, &id(50), 0, &document, &graph, &a)
            .await
            .unwrap();
        let b = next(&a, 21, "named");
        let c = next(&a, 22, "named");
        let mut b_graph = graph.clone();
        b_graph["paths"][0]["name"] = json!("Writer B");
        let mut c_graph = graph.clone();
        c_graph["paths"][0]["name"] = json!("Writer C");
        let b_operation = id(51);
        let c_operation = id(52);
        let (b_result, c_result) = tokio::join!(
            save_candidate(&left, &b_operation, 1, &document, &b_graph, &b),
            save_candidate(&right, &c_operation, 1, &document, &c_graph, &c)
        );
        let (winner, operation, graph, result) = match (b_result, c_result) {
            (Ok(receipt), Err(error)) => {
                assert_eq!(error, "stale_story_workspace_revision");
                (b, b_operation, b_graph, receipt)
            }
            (Err(error), Ok(receipt)) => {
                assert_eq!(error, "stale_story_workspace_revision");
                (c, c_operation, c_graph, receipt)
            }
            _ => panic!("exactly one writer must adopt the shared expected head"),
        };
        assert_eq!(state(&left).await, (2, result.snapshot_json.clone()));
        let head: String = sqlx::query_scalar("SELECT head_id FROM story_workspace_branches")
            .fetch_one(&left)
            .await
            .unwrap();
        assert_eq!(head, winner.version_id);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_versions")
            .fetch_one(&left)
            .await
            .unwrap();
        assert_eq!(count, 2);
        assert!(
            save_candidate(&right, &operation, 1, &document, &graph, &winner)
                .await
                .unwrap()
                .replayed
        );
        left.close().await;
        right.close().await;
        std::fs::remove_file(path).unwrap();
    }
    #[tokio::test]
    async fn history_and_receipt_failures_roll_back_composite_state_and_all_heads() {
        let db = pool("sqlite::memory:").await;
        let document = super::super::story_document_validation::tests::document();
        let graph = graph();
        let a = initial();
        save_candidate(&db, &id(50), 0, &document, &graph, &a)
            .await
            .unwrap();
        let baseline = state(&db).await;
        let b = next(&a, 21, "named");
        sqlx::query("CREATE TRIGGER reject_story_receipt BEFORE INSERT ON story_workspace_receipts BEGIN SELECT RAISE(ABORT,'injected final-stage failure'); END")
            .execute(&db).await.unwrap();
        let mut changed = graph.clone();
        changed["paths"][0]["name"] = json!("Must roll back");
        assert!(save_candidate(&db, &id(51), 1, &document, &changed, &b)
            .await
            .is_err());
        assert_eq!(state(&db).await, baseline);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_versions")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(count, 1);
        let head: String = sqlx::query_scalar("SELECT head_id FROM story_workspace_branches")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(head, a.version_id);
        sqlx::query("DROP TRIGGER reject_story_receipt")
            .execute(&db)
            .await
            .unwrap();
        assert!(
            !save_candidate(&db, &id(51), 1, &document, &changed, &b)
                .await
                .unwrap()
                .replayed
        );
        let mut c = next(&b, 22, "alternative");
        c.branch_id = id(31);
        c.branch_name = "Alternative".into();
        save_candidate(&db, &id(52), 2, &document, &changed, &c)
            .await
            .unwrap();
        let mut merge = next(&c, 23, "merge");
        merge.parent_ids.push(a.version_id.clone());
        merge.source_branch_id = Some(a.branch_id.clone());
        let baseline = state(&db).await;
        assert_eq!(
            save_candidate(&db, &id(53), 3, &document, &changed, &merge)
                .await
                .unwrap_err(),
            "stale_story_source_head"
        );
        assert_eq!(state(&db).await, baseline);
        let mut restore = next(&c, 24, "restore");
        restore.restored_from_id = Some(a.version_id.clone());
        assert_eq!(
            save_candidate(&db, &id(54), 3, &document, &changed, &restore)
                .await
                .unwrap_err(),
            "story_restore_snapshot_mismatch"
        );
        assert_eq!(state(&db).await, baseline);
        let receipts: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM story_workspace_receipts")
            .fetch_one(&db)
            .await
            .unwrap();
        assert_eq!(receipts, 3);
        let mut other = document.clone();
        other["id"] = json!(id(99));
        let mut other_graph = changed.clone();
        other_graph["documentId"] = other["id"].clone();
        assert_eq!(
            save_candidate(
                &db,
                &id(55),
                3,
                &other,
                &other_graph,
                &next(&c, 25, "named")
            )
            .await
            .unwrap_err(),
            "story_workspace_document_mismatch"
        );
        assert_eq!(state(&db).await, baseline);
    }
}

pub(crate) fn validate(input: &HistoryCommit) -> Result<(), String> {
    if let Some(metadata) = &input.metadata {
        if !super::valid_lower_uuid(&metadata.author_id)
            || metadata
                .label
                .as_ref()
                .is_some_and(|label| label.encode_utf16().count() > 1000)
            || !metadata.created_at.ends_with('Z')
            || !super::story_document_validation::provenance_datetime(&metadata.created_at)
        {
            return Err("invalid_story_history_metadata".into());
        }
    }
    if !super::valid_lower_uuid(&input.version_id)
        || !super::valid_lower_uuid(&input.branch_id)
        || input.branch_name.trim().is_empty()
        || input.branch_name.encode_utf16().count() > 200
        || input.parent_ids.len() > 2
        || input
            .parent_ids
            .iter()
            .any(|id| !super::valid_lower_uuid(id) || id == &input.version_id)
        || input.parent_ids.len() == 2 && input.parent_ids[0] == input.parent_ids[1]
        || [
            &input.expected_branch_id,
            &input.expected_head_id,
            &input.source_branch_id,
            &input.restored_from_id,
        ]
        .iter()
        .any(|id| id.as_ref().is_some_and(|id| !super::valid_lower_uuid(id)))
    {
        return Err("invalid_story_history_request".into());
    }
    match input.kind.as_str() {
        "initial"
            if input.parent_ids.is_empty()
                && input.expected_branch_id.is_none()
                && input.expected_head_id.is_none()
                && input.source_branch_id.is_none()
                && input.restored_from_id.is_none() => {}
        "named" | "alternative" | "restore" | "merge" => {
            let head = input
                .expected_head_id
                .as_ref()
                .ok_or("invalid_story_history_request")?;
            let branch = input
                .expected_branch_id
                .as_ref()
                .ok_or("invalid_story_history_request")?;
            if input.parent_ids.first() != Some(head)
                || input.parent_ids.len() != if input.kind == "merge" { 2 } else { 1 }
                || (input.kind == "alternative") != (&input.branch_id != branch)
                || (input.kind == "restore") != input.restored_from_id.is_some()
                || (input.kind == "merge") != input.source_branch_id.is_some()
                || input.source_branch_id.as_ref() == Some(branch)
            {
                return Err("invalid_story_history_request".into());
            }
        }
        _ => return Err("invalid_story_history_request".into()),
    }
    Ok(())
}

// Only validated native callers reach this API. Every immutable version owns
// the exact Document+Graph snapshot, including Paths, and its Asset closure.
pub(crate) async fn capture_current(
    pool: &Pool<Sqlite>,
    workspace_id: &str,
    operation_id: &str,
    expected_revision: i64,
    history: &HistoryCommit,
) -> Result<super::story_workspace_store::Receipt, String> {
    validate(history)?;
    if !super::valid_lower_uuid(workspace_id)
        || !super::valid_lower_uuid(operation_id)
        || !["named", "alternative"].contains(&history.kind.as_str())
    {
        return Err("invalid_story_history_capture".into());
    }
    let request = serde_json::to_string(&serde_json::json!({
        "kind":"capture-current-v1", "workspaceId":workspace_id,
        "operationId":operation_id, "expectedRevision":expected_revision, "history":history
    }))
    .map_err(|e| e.to_string())?;
    super::story_workspace_store::capture_history(
        pool,
        workspace_id,
        operation_id,
        expected_revision,
        &request,
        history,
    )
    .await
}

pub(crate) async fn capture_owned_current(
    pool: &Pool<Sqlite>,
    workspace_id: &str,
    operation_id: &str,
    expected_revision: i64,
    history: &HistoryCommit,
    label: Option<String>,
) -> Result<super::story_workspace_store::Receipt, String> {
    validate(history)?;
    if history.metadata.is_some()
        || !super::valid_lower_uuid(workspace_id)
        || !super::valid_lower_uuid(operation_id)
        || !["named", "alternative"].contains(&history.kind.as_str())
        || label
            .as_ref()
            .is_some_and(|value| value.encode_utf16().count() > 1000)
    {
        return Err("invalid_story_owned_capture".into());
    }
    // Generated author/time are deliberately outside request identity. Replays
    // are checked before attribution is read or generated in the writer transaction.
    let request = serde_json::to_string(&serde_json::json!({
        "kind":"capture-owned-v1","workspaceId":workspace_id,"operationId":operation_id,
        "expectedRevision":expected_revision,"history":history,"label":label
    }))
    .map_err(|e| e.to_string())?;
    super::story_workspace_store::capture_owned_history(
        pool,
        workspace_id,
        operation_id,
        expected_revision,
        &request,
        history,
        &label,
    )
    .await
}

pub(crate) async fn save_candidate(
    pool: &Pool<Sqlite>,
    operation_id: &str,
    expected_revision: i64,
    document: &Value,
    graph: &Value,
    history: &HistoryCommit,
) -> Result<super::story_workspace_store::Receipt, String> {
    validate(history)?;
    if !super::valid_lower_uuid(operation_id) {
        return Err("invalid_story_operation_id".into());
    }
    let ids = super::story_document_validation::validate_document_subset(document)?;
    if graph["documentId"] != document["id"] {
        return Err("story_workspace_document_mismatch".into());
    }
    super::story_graph_validation::validate_graph_schema(graph, &ids).map_err(str::to_string)?;
    let workspace_id = graph["id"].as_str().ok_or("invalid_story_graph")?;
    let snapshot = serde_json::to_string(&serde_json::json!({
        "schemaId":"https://komyaku.example/schemas/story-workspace/v1",
        "schemaVersion":1,"document":document,"graph":graph}))
    .map_err(|e| e.to_string())?;
    let request = serde_json::to_string(&serde_json::json!({
        "operationId":operation_id,"expectedRevision":expected_revision,
        "snapshot":snapshot,"history":history}))
    .map_err(|e| e.to_string())?;
    super::story_workspace_store::commit_with_history(
        pool,
        workspace_id,
        operation_id,
        expected_revision,
        &request,
        &snapshot,
        Some(history),
    )
    .await
}

pub(crate) async fn adopt(
    tx: &mut Transaction<'_, Sqlite>,
    workspace_id: &str,
    revision: i64,
    snapshot: &str,
    assets: &[String],
    input: &HistoryCommit,
) -> Result<(), String> {
    validate(input)?;
    let selection: Option<(String, String)> = sqlx::query_as(
        "SELECT branch_id,version_id FROM story_workspace_selection WHERE workspace_id=?",
    )
    .bind(workspace_id)
    .fetch_optional(&mut **tx)
    .await
    .map_err(|e| e.to_string())?;
    if selection.as_ref().map(|x| &x.0) != input.expected_branch_id.as_ref()
        || selection.as_ref().map(|x| &x.1) != input.expected_head_id.as_ref()
    {
        return Err("stale_story_history_selection".into());
    }
    if input.kind == "initial" {
        let count: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM story_workspace_versions WHERE workspace_id=?",
        )
        .bind(workspace_id)
        .fetch_one(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
        if count != 0 {
            return Err("story_history_already_initialized".into());
        }
    }
    if let Some(branch) = &input.expected_branch_id {
        let head: Option<String> = sqlx::query_scalar(
            "SELECT head_id FROM story_workspace_branches WHERE workspace_id=? AND branch_id=?",
        )
        .bind(workspace_id)
        .bind(branch)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
        if head.as_ref() != input.expected_head_id.as_ref() {
            return Err("stale_story_branch_head".into());
        }
    }
    if let Some(branch) = &input.source_branch_id {
        let head: Option<String> = sqlx::query_scalar(
            "SELECT head_id FROM story_workspace_branches WHERE workspace_id=? AND branch_id=?",
        )
        .bind(workspace_id)
        .bind(branch)
        .fetch_optional(&mut **tx)
        .await
        .map_err(|e| e.to_string())?;
        if head.as_ref() != input.parent_ids.get(1) {
            return Err("stale_story_source_head".into());
        }
    }
    if let Some(target) = &input.restored_from_id {
        let restored: Option<(String,String)> = sqlx::query_as("SELECT snapshot_json,snapshot_hash FROM story_workspace_versions WHERE workspace_id=? AND version_id=?")
            .bind(workspace_id).bind(target).fetch_optional(&mut **tx).await.map_err(|e|e.to_string())?;
        let (restored, hash) = restored.ok_or("missing_story_version")?;
        if snapshot_hash(restored.as_bytes()) != hash {
            return Err("story_version_hash_mismatch".into());
        }
        if restored != snapshot {
            return Err("story_restore_snapshot_mismatch".into());
        }
    }
    // Immutable rows are insert-only. Duplicate identities fail and roll back
    // the working state/references already prepared in this same transaction.
    let hash = snapshot_hash(snapshot.as_bytes());
    let author = input
        .metadata
        .as_ref()
        .map(|metadata| metadata.author_id.as_str());
    let label = input
        .metadata
        .as_ref()
        .and_then(|metadata| metadata.label.as_deref());
    let created_at = input
        .metadata
        .as_ref()
        .map(|metadata| metadata.created_at.as_str());
    sqlx::query("INSERT INTO story_workspace_versions(workspace_id,version_id,snapshot_json,snapshot_hash,revision,kind,restored_from_id,author_id,label,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .bind(workspace_id).bind(&input.version_id).bind(snapshot).bind(hash).bind(revision)
        .bind(&input.kind).bind(&input.restored_from_id).bind(author).bind(label).bind(created_at)
        .execute(&mut **tx).await.map_err(|e|e.to_string())?;
    for (ordinal, parent) in input.parent_ids.iter().enumerate() {
        sqlx::query("INSERT INTO story_workspace_version_parents(workspace_id,version_id,parent_id,ordinal) VALUES(?,?,?,?)")
            .bind(workspace_id).bind(&input.version_id).bind(parent).bind(ordinal as i64)
            .execute(&mut **tx).await.map_err(|e|e.to_string())?;
    }
    if input.kind == "initial" || input.kind == "alternative" {
        sqlx::query("INSERT INTO story_workspace_branches(workspace_id,branch_id,name,head_id,created_at,updated_at) VALUES(?,?,?,?,?,?)")
            .bind(workspace_id).bind(&input.branch_id).bind(&input.branch_name).bind(&input.version_id)
            .bind(created_at).bind(created_at).execute(&mut **tx).await.map_err(|e|e.to_string())?;
    } else {
        // Name is part of request identity; saving a Version cannot rename a Branch.
        let result = sqlx::query("UPDATE story_workspace_branches SET head_id=?,updated_at=? WHERE workspace_id=? AND branch_id=? AND head_id=? AND name=?")
            .bind(&input.version_id).bind(created_at).bind(workspace_id).bind(&input.branch_id)
            .bind(&input.expected_head_id).bind(&input.branch_name).execute(&mut **tx).await.map_err(|e|e.to_string())?;
        if result.rows_affected() != 1 {
            return Err("stale_story_branch_head".into());
        }
    }
    sqlx::query("INSERT INTO story_workspace_selection(workspace_id,branch_id,version_id) VALUES(?,?,?) ON CONFLICT(workspace_id) DO UPDATE SET branch_id=excluded.branch_id,version_id=excluded.version_id")
        .bind(workspace_id).bind(&input.branch_id).bind(&input.version_id)
        .execute(&mut **tx).await.map_err(|e|e.to_string())?;
    for asset in assets {
        sqlx::query("INSERT INTO story_workspace_version_assets(workspace_id,version_id,asset_id) VALUES(?,?,?)")
            .bind(workspace_id).bind(&input.version_id).bind(asset)
            .execute(&mut **tx).await.map_err(|e|e.to_string())?;
    }
    Ok(())
}
