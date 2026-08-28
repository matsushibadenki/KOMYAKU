use serde::Deserialize;
use sqlx::{Pool, Sqlite};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

const LOCAL_DATABASE_URL: &str = "sqlite:komyaku.db";
const MAX_LOCAL_DRAFT_BYTES: usize = 12 * 1024 * 1024;
const SECURE_SESSION_SERVICE: &str = "app.komyaku.desktop";
const SECURE_SESSION_ACCOUNT: &str = "cloud-session-v1";

#[derive(Debug, PartialEq)]
enum SecureSessionError {
    InvalidToken,
    Unavailable,
}

impl SecureSessionError {
    fn code(&self) -> &'static str {
        match self {
            Self::InvalidToken => "invalid_session_token",
            Self::Unavailable => "secure_session_unavailable",
        }
    }
}

fn validate_session_token(token: &str) -> Result<(), SecureSessionError> {
    if token.len() != 43
        || !token
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || matches!(value, b'-' | b'_'))
    {
        return Err(SecureSessionError::InvalidToken);
    }
    Ok(())
}

fn secure_session_entry() -> Result<keyring::v1::Entry, SecureSessionError> {
    keyring::v1::Entry::new(SECURE_SESSION_SERVICE, SECURE_SESSION_ACCOUNT)
        .map_err(|_| SecureSessionError::Unavailable)
}

fn store_cloud_session_sync(token: &str) -> Result<(), SecureSessionError> {
    validate_session_token(token)?;
    secure_session_entry()?
        .set_password(token)
        .map_err(|_| SecureSessionError::Unavailable)
}

fn load_cloud_session_sync() -> Result<Option<String>, SecureSessionError> {
    match secure_session_entry()?.get_password() {
        Ok(token) => {
            validate_session_token(&token)?;
            Ok(Some(token))
        }
        Err(keyring::v1::Error::NoEntry) => Ok(None),
        Err(_) => Err(SecureSessionError::Unavailable),
    }
}

fn delete_cloud_session_sync() -> Result<(), SecureSessionError> {
    match secure_session_entry()?.delete_credential() {
        Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
        Err(_) => Err(SecureSessionError::Unavailable),
    }
}

#[tauri::command]
async fn store_cloud_session(token: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || store_cloud_session_sync(&token))
        .await
        .map_err(|_| SecureSessionError::Unavailable.code().to_string())?
        .map_err(|error| error.code().to_string())
}

#[tauri::command]
async fn load_cloud_session() -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(load_cloud_session_sync)
        .await
        .map_err(|_| SecureSessionError::Unavailable.code().to_string())?
        .map_err(|error| error.code().to_string())
}

#[tauri::command]
async fn delete_cloud_session() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(delete_cloud_session_sync)
        .await
        .map_err(|_| SecureSessionError::Unavailable.code().to_string())?
        .map_err(|error| error.code().to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalDraftInput {
    document_id: String,
    schema_version: i64,
    content_json: String,
    local_revision: i64,
    updated_at: String,
    title: String,
    language: String,
    direction: String,
    writing_mode: String,
}

#[derive(Debug, PartialEq)]
enum LocalDraftSaveError {
    DatabaseUnavailable,
    InvalidInput,
    StaleRevision,
    StorageFailure,
}

impl LocalDraftSaveError {
    fn code(&self) -> &'static str {
        match self {
            Self::DatabaseUnavailable => "tauri_database_unavailable",
            Self::InvalidInput => "invalid_local_draft",
            Self::StaleRevision => "stale_local_revision",
            Self::StorageFailure => "local_draft_storage_failure",
        }
    }
}

fn validate_local_draft_input(input: &LocalDraftInput) -> Result<(), LocalDraftSaveError> {
    if input.document_id.is_empty()
        || input.document_id.len() > 128
        || input.schema_version < 1
        || input.local_revision < 0
        || input.updated_at.is_empty()
        || input.updated_at.len() > 64
        || input.content_json.len() > MAX_LOCAL_DRAFT_BYTES
        || !matches!(input.direction.as_str(), "auto" | "ltr" | "rtl")
        || !matches!(
            input.writing_mode.as_str(),
            "horizontal-tb" | "vertical-rl" | "vertical-lr"
        )
        || input.language.len() > 64
    {
        return Err(LocalDraftSaveError::InvalidInput);
    }

    let content: serde_json::Value =
        serde_json::from_str(&input.content_json).map_err(|_| LocalDraftSaveError::InvalidInput)?;
    let title = content
        .pointer("/metadata/title")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("");
    let matches_record = content.get("id").and_then(serde_json::Value::as_str)
        == Some(input.document_id.as_str())
        && content
            .get("schemaVersion")
            .and_then(serde_json::Value::as_i64)
            == Some(input.schema_version)
        && content
            .pointer("/attrs/language")
            .and_then(serde_json::Value::as_str)
            == Some(input.language.as_str())
        && content
            .pointer("/attrs/direction")
            .and_then(serde_json::Value::as_str)
            == Some(input.direction.as_str())
        && content
            .pointer("/attrs/writingMode")
            .and_then(serde_json::Value::as_str)
            == Some(input.writing_mode.as_str())
        && title == input.title;

    if !matches_record {
        return Err(LocalDraftSaveError::InvalidInput);
    }
    Ok(())
}

async fn save_local_draft_transaction(
    pool: &Pool<Sqlite>,
    input: &LocalDraftInput,
) -> Result<(), LocalDraftSaveError> {
    validate_local_draft_input(input)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| LocalDraftSaveError::StorageFailure)?;

    sqlx::query(
        r#"INSERT INTO local_documents (
          id, title, default_language, default_direction, default_writing_mode, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          default_language = excluded.default_language,
          default_direction = excluded.default_direction,
          default_writing_mode = excluded.default_writing_mode,
          updated_at = excluded.updated_at"#,
    )
    .bind(&input.document_id)
    .bind(&input.title)
    .bind(&input.language)
    .bind(&input.direction)
    .bind(&input.writing_mode)
    .bind(&input.updated_at)
    .bind(&input.updated_at)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LocalDraftSaveError::StorageFailure)?;

    let result = sqlx::query(
        r#"INSERT INTO local_drafts (
          document_id, schema_version, content_json, local_revision, is_composing, updated_at
        ) VALUES (?, ?, ?, ?, 0, ?)
        ON CONFLICT(document_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          content_json = excluded.content_json,
          local_revision = excluded.local_revision,
          is_composing = 0,
          updated_at = excluded.updated_at
        WHERE excluded.local_revision > local_drafts.local_revision"#,
    )
    .bind(&input.document_id)
    .bind(input.schema_version)
    .bind(&input.content_json)
    .bind(input.local_revision)
    .bind(&input.updated_at)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LocalDraftSaveError::StorageFailure)?;

    if result.rows_affected() != 1 {
        return Err(LocalDraftSaveError::StaleRevision);
    }

    transaction
        .commit()
        .await
        .map_err(|_| LocalDraftSaveError::StorageFailure)
}

#[tauri::command]
async fn save_local_draft_atomic(
    db_instances: State<'_, DbInstances>,
    input: LocalDraftInput,
) -> Result<(), String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err(LocalDraftSaveError::DatabaseUnavailable.code().to_string()),
        }
    };

    save_local_draft_transaction(&pool, &input)
        .await
        .map_err(|error| error.code().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![Migration {
        version: 1,
        description: "create_local_first_foundation",
        sql: include_str!("../migrations/0001_local_foundation.sql"),
        kind: MigrationKind::Up,
    }];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_local_draft_atomic,
            store_cloud_session,
            load_cloud_session,
            delete_cloud_session
        ])
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:komyaku.db", migrations)
                .build(),
        )
        .run(tauri::generate_context!())
        .expect("error while running KOMYAKU");
}

#[cfg(test)]
mod tests {
    use super::*;
    use sqlx::sqlite::SqlitePoolOptions;

    fn input(revision: i64, title: &str) -> LocalDraftInput {
        let document_id = "00000000-0000-4000-8000-000000000001";
        LocalDraftInput {
            document_id: document_id.into(),
            schema_version: 1,
            content_json: serde_json::json!({
                "id": document_id,
                "schemaVersion": 1,
                "attrs": {
                    "language": "ja",
                    "direction": "auto",
                    "writingMode": "horizontal-tb"
                },
                "metadata": { "title": title }
            })
            .to_string(),
            local_revision: revision,
            updated_at: "2026-08-24T00:00:00.000Z".into(),
            title: title.into(),
            language: "ja".into(),
            direction: "auto".into(),
            writing_mode: "horizontal-tb".into(),
        }
    }

    async fn pool() -> Pool<Sqlite> {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .expect("create in-memory database");
        sqlx::raw_sql(include_str!("../migrations/0001_local_foundation.sql"))
            .execute(&pool)
            .await
            .expect("apply local schema");
        pool
    }

    #[tokio::test]
    async fn saves_document_and_draft_atomically() {
        let pool = pool().await;
        save_local_draft_transaction(&pool, &input(1, "Initial"))
            .await
            .expect("save local draft");

        let row: (String, i64) = sqlx::query_as(
            "SELECT d.title, r.local_revision FROM local_documents d JOIN local_drafts r ON r.document_id = d.id",
        )
        .fetch_one(&pool)
        .await
        .expect("read saved document and draft");
        assert_eq!(row, ("Initial".into(), 1));
    }

    #[tokio::test]
    async fn stale_revision_rolls_back_document_metadata() {
        let pool = pool().await;
        save_local_draft_transaction(&pool, &input(2, "Current"))
            .await
            .expect("save current draft");

        let error = save_local_draft_transaction(&pool, &input(1, "Must roll back"))
            .await
            .expect_err("reject stale revision");
        assert_eq!(error, LocalDraftSaveError::StaleRevision);

        let title: String = sqlx::query_scalar("SELECT title FROM local_documents")
            .fetch_one(&pool)
            .await
            .expect("read document title");
        assert_eq!(title, "Current");
    }

    #[tokio::test]
    async fn mismatched_canonical_identity_creates_no_document_shell() {
        let pool = pool().await;
        let mut invalid = input(1, "Invalid");
        invalid.document_id = "00000000-0000-4000-8000-000000000099".into();

        let error = save_local_draft_transaction(&pool, &invalid)
            .await
            .expect_err("reject mismatched content identity");
        assert_eq!(error, LocalDraftSaveError::InvalidInput);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_documents")
            .fetch_one(&pool)
            .await
            .expect("count local documents");
        assert_eq!(count, 0);
    }

    #[test]
    fn accepts_only_server_session_token_shape() {
        assert_eq!(validate_session_token(&"a".repeat(43)), Ok(()));
        assert_eq!(
            validate_session_token(&format!("{}-_", "a".repeat(41))),
            Ok(())
        );
        assert_eq!(
            validate_session_token(&"a".repeat(42)),
            Err(SecureSessionError::InvalidToken)
        );
        assert_eq!(
            validate_session_token(&format!("{}+", "a".repeat(42))),
            Err(SecureSessionError::InvalidToken)
        );
    }
}
