//! Local profile attribution, not proof of a remote authenticated identity.
use sqlx::{Sqlite, Transaction};
pub(crate) const SCHEMA: &str = include_str!("../migrations/0011_story_workspace_local_author.sql");
pub(crate) async fn metadata(
    tx: &mut Transaction<'_, Sqlite>,
    label: &Option<String>,
) -> Result<super::story_workspace_history::HistoryMetadata, String> {
    sqlx::query("INSERT INTO story_workspace_local_author(singleton,author_id)
        SELECT 1,lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2)
                    || '-8' || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))
        ON CONFLICT(singleton) DO NOTHING")
        .execute(&mut **tx).await.map_err(|_| "story_author_storage_failure")?;
    let (author_id, created_at): (String,String) = sqlx::query_as(
        "SELECT author_id,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM story_workspace_local_author WHERE singleton=1")
        .fetch_one(&mut **tx).await.map_err(|_| "story_author_storage_failure")?;
    if !super::valid_lower_uuid(&author_id)
        || !super::story_document_validation::provenance_datetime(&created_at)
    {
        return Err("invalid_story_local_author".into());
    }
    Ok(super::story_workspace_history::HistoryMetadata {
        author_id,
        label: label.clone(),
        created_at,
    })
}
