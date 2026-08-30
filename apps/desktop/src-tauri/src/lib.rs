use serde::{Deserialize, Serialize};
use sqlx::{Pool, Sqlite};
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

const LOCAL_DATABASE_URL: &str = "sqlite:komyaku.db";
const MAX_LOCAL_DRAFT_BYTES: usize = 12 * 1024 * 1024;
const SECURE_SESSION_SERVICE: &str = "app.komyaku.desktop";
const SECURE_SESSION_ACCOUNT: &str = "cloud-session-v1";
const MAX_PROVIDER_SECRET_BYTES: usize = 16 * 1024;
const MAX_LOCAL_CONVERSATION_BYTES: usize = 12 * 1024 * 1024;
const MAX_LOCAL_CONVERSATION_LIST_ITEMS: i64 = 100;

#[derive(Debug, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
struct LocalConversationSummary {
    id: String,
    title: String,
    message_count: i64,
    updated_at: String,
}

#[derive(Debug, PartialEq)]
enum SecureSessionError {
    InvalidToken,
    InvalidProviderReference,
    InvalidProviderSecret,
    Unavailable,
}

impl SecureSessionError {
    fn code(&self) -> &'static str {
        match self {
            Self::InvalidToken => "invalid_session_token",
            Self::InvalidProviderReference => "invalid_provider_reference",
            Self::InvalidProviderSecret => "invalid_provider_secret",
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

fn validate_provider_reference(reference: &str) -> Result<(), SecureSessionError> {
    let bytes = reference.as_bytes();
    if bytes.len() != 36
        || bytes.iter().enumerate().any(|(index, value)| match index {
            8 | 13 | 18 | 23 => *value != b'-',
            _ => !value.is_ascii_hexdigit(),
        })
    {
        return Err(SecureSessionError::InvalidProviderReference);
    }
    Ok(())
}

fn provider_credential_entry(reference: &str) -> Result<keyring::v1::Entry, SecureSessionError> {
    validate_provider_reference(reference)?;
    keyring::v1::Entry::new(SECURE_SESSION_SERVICE, &format!("ai-provider-{reference}"))
        .map_err(|_| SecureSessionError::Unavailable)
}

fn store_provider_credential_sync(reference: &str, secret: &str) -> Result<(), SecureSessionError> {
    if secret.is_empty() || secret.len() > MAX_PROVIDER_SECRET_BYTES {
        return Err(SecureSessionError::InvalidProviderSecret);
    }
    provider_credential_entry(reference)?
        .set_password(secret)
        .map_err(|_| SecureSessionError::Unavailable)
}

fn load_provider_credential_sync(reference: &str) -> Result<Option<String>, SecureSessionError> {
    match provider_credential_entry(reference)?.get_password() {
        Ok(secret) if !secret.is_empty() && secret.len() <= MAX_PROVIDER_SECRET_BYTES => {
            Ok(Some(secret))
        }
        Ok(_) => Err(SecureSessionError::InvalidProviderSecret),
        Err(keyring::v1::Error::NoEntry) => Ok(None),
        Err(_) => Err(SecureSessionError::Unavailable),
    }
}

fn delete_provider_credential_sync(reference: &str) -> Result<(), SecureSessionError> {
    match provider_credential_entry(reference)?.delete_credential() {
        Ok(()) | Err(keyring::v1::Error::NoEntry) => Ok(()),
        Err(_) => Err(SecureSessionError::Unavailable),
    }
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

#[tauri::command]
async fn store_provider_credential(reference: String, secret: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        store_provider_credential_sync(&reference, &secret)
    })
    .await
    .map_err(|_| SecureSessionError::Unavailable.code().to_string())?
    .map_err(|error| error.code().to_string())
}

#[tauri::command]
async fn load_provider_credential(reference: String) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || load_provider_credential_sync(&reference))
        .await
        .map_err(|_| SecureSessionError::Unavailable.code().to_string())?
        .map_err(|error| error.code().to_string())
}

#[tauri::command]
async fn delete_provider_credential(reference: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_provider_credential_sync(&reference))
        .await
        .map_err(|_| SecureSessionError::Unavailable.code().to_string())?
        .map_err(|error| error.code().to_string())
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalAiHandoffInput {
    conversation_json: String,
    handoff_json: String,
    result_message_id: String,
    provider_response_id: Option<String>,
    completed_at: String,
}

#[derive(Debug, PartialEq)]
enum LocalAiHandoffError {
    DatabaseUnavailable,
    InvalidInput,
    Conflict,
    StorageFailure,
}

impl LocalAiHandoffError {
    fn code(&self) -> &'static str {
        match self {
            Self::DatabaseUnavailable => "tauri_database_unavailable",
            Self::InvalidInput => "invalid_local_ai_handoff",
            Self::Conflict => "local_ai_handoff_conflict",
            Self::StorageFailure => "local_ai_handoff_storage_failure",
        }
    }
}

fn json_string<'a>(value: &'a serde_json::Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer).and_then(serde_json::Value::as_str)
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|character| character.is_ascii_hexdigit() && !character.is_ascii_uppercase())
}

fn validate_local_ai_handoff(
    input: &LocalAiHandoffInput,
) -> Result<(serde_json::Value, serde_json::Value), LocalAiHandoffError> {
    if input.conversation_json.len() > MAX_LOCAL_CONVERSATION_BYTES
        || input.handoff_json.len() > 256 * 1024
        || input.completed_at.is_empty()
        || input.completed_at.len() > 64
        || input
            .provider_response_id
            .as_ref()
            .is_some_and(|value| value.len() > 500)
    {
        return Err(LocalAiHandoffError::InvalidInput);
    }
    validate_provider_reference(&input.result_message_id)
        .map_err(|_| LocalAiHandoffError::InvalidInput)?;
    let conversation: serde_json::Value = serde_json::from_str(&input.conversation_json)
        .map_err(|_| LocalAiHandoffError::InvalidInput)?;
    let handoff: serde_json::Value =
        serde_json::from_str(&input.handoff_json).map_err(|_| LocalAiHandoffError::InvalidInput)?;
    let conversation_id =
        json_string(&conversation, "/id").ok_or(LocalAiHandoffError::InvalidInput)?;
    let handoff_id = json_string(&handoff, "/id").ok_or(LocalAiHandoffError::InvalidInput)?;
    let source_message_id =
        json_string(&handoff, "/sourceMessageId").ok_or(LocalAiHandoffError::InvalidInput)?;
    let provider_connection_id =
        json_string(&handoff, "/providerConnectionId").ok_or(LocalAiHandoffError::InvalidInput)?;
    let consented_by =
        json_string(&handoff, "/consentedBy").ok_or(LocalAiHandoffError::InvalidInput)?;
    for value in [
        conversation_id,
        handoff_id,
        source_message_id,
        provider_connection_id,
        consented_by,
    ] {
        validate_provider_reference(value).map_err(|_| LocalAiHandoffError::InvalidInput)?;
    }
    if json_string(&handoff, "/conversationId") != Some(conversation_id)
        || conversation
            .get("schemaVersion")
            .and_then(serde_json::Value::as_i64)
            != Some(1)
        || !valid_hash(json_string(&handoff, "/payloadHash").unwrap_or(""))
        || !valid_hash(json_string(&handoff, "/outboundPayloadHash").unwrap_or(""))
        || json_string(&handoff, "/providerType").is_none_or(str::is_empty)
        || json_string(&handoff, "/modelId").is_none_or(str::is_empty)
        || json_string(&handoff, "/consentedAt").is_none_or(str::is_empty)
        || handoff
            .get("estimatedInputUnits")
            .and_then(serde_json::Value::as_i64)
            .is_none_or(|value| value < 0)
    {
        return Err(LocalAiHandoffError::InvalidInput);
    }
    let selected_message_ids = handoff
        .get("selectedMessageIds")
        .and_then(serde_json::Value::as_array)
        .ok_or(LocalAiHandoffError::InvalidInput)?;
    if selected_message_ids.is_empty()
        || !selected_message_ids
            .iter()
            .any(|value| value.as_str() == Some(source_message_id))
        || handoff
            .get("selectedAssetIds")
            .and_then(serde_json::Value::as_array)
            .is_none()
        || handoff
            .get("conversionWarnings")
            .and_then(serde_json::Value::as_array)
            .is_none()
    {
        return Err(LocalAiHandoffError::InvalidInput);
    }
    let messages = conversation
        .get("messages")
        .and_then(serde_json::Value::as_array)
        .ok_or(LocalAiHandoffError::InvalidInput)?;
    let message_ids: std::collections::HashSet<&str> = messages
        .iter()
        .filter_map(|message| json_string(message, "/id"))
        .collect();
    if message_ids.len() != messages.len()
        || !message_ids.contains(source_message_id)
        || !message_ids.contains(input.result_message_id.as_str())
        || messages.iter().any(|message| {
            json_string(message, "/conversationId") != Some(conversation_id)
                || json_string(message, "/id")
                    .is_none_or(|id| validate_provider_reference(id).is_err())
        })
    {
        return Err(LocalAiHandoffError::InvalidInput);
    }
    let edges = conversation
        .get("edges")
        .and_then(serde_json::Value::as_array)
        .ok_or(LocalAiHandoffError::InvalidInput)?;
    let continuation_exists = edges.iter().any(|edge| {
        json_string(edge, "/parentMessageId") == Some(source_message_id)
            && json_string(edge, "/childMessageId") == Some(input.result_message_id.as_str())
            && json_string(edge, "/kind") == Some("ai_continuation")
    });
    if !continuation_exists
        || edges.iter().any(|edge| {
            let parent = json_string(edge, "/parentMessageId");
            let child = json_string(edge, "/childMessageId");
            parent.is_none_or(|id| !message_ids.contains(id))
                || child.is_none_or(|id| !message_ids.contains(id))
                || parent == child
        })
    {
        return Err(LocalAiHandoffError::InvalidInput);
    }
    Ok((conversation, handoff))
}

async fn save_local_ai_handoff_transaction(
    pool: &Pool<Sqlite>,
    input: &LocalAiHandoffInput,
) -> Result<(), LocalAiHandoffError> {
    let (conversation, handoff) = validate_local_ai_handoff(input)?;
    let conversation_id = json_string(&conversation, "/id").unwrap();
    let handoff_id = json_string(&handoff, "/id").unwrap();
    let source_message_id = json_string(&handoff, "/sourceMessageId").unwrap();
    let now = &input.completed_at;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| LocalAiHandoffError::StorageFailure)?;

    sqlx::query(
        r#"INSERT INTO local_conversations
        (id, schema_version, title, default_language, canonical_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET canonical_json = excluded.canonical_json,
          title = excluded.title, default_language = excluded.default_language,
          schema_version = excluded.schema_version, updated_at = excluded.updated_at"#,
    )
    .bind(conversation_id)
    .bind(
        conversation
            .get("schemaVersion")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(1),
    )
    .bind(json_string(&conversation, "/title").unwrap_or(""))
    .bind(json_string(&conversation, "/defaultLanguage").unwrap_or("und"))
    .bind(&input.conversation_json)
    .bind(now)
    .bind(now)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LocalAiHandoffError::StorageFailure)?;

    for message in conversation
        .get("messages")
        .and_then(serde_json::Value::as_array)
        .unwrap()
    {
        let stored = sqlx::query(
            r#"INSERT INTO local_conversation_messages (id, conversation_id, message_json, created_at)
            VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET message_json = excluded.message_json
            WHERE local_conversation_messages.conversation_id = excluded.conversation_id
              AND local_conversation_messages.message_json = excluded.message_json"#,
        )
        .bind(json_string(message, "/id").unwrap())
        .bind(conversation_id)
        .bind(message.to_string())
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LocalAiHandoffError::StorageFailure)?;
        if stored.rows_affected() != 1 {
            return Err(LocalAiHandoffError::Conflict);
        }
    }
    for edge in conversation
        .get("edges")
        .and_then(serde_json::Value::as_array)
        .unwrap()
    {
        sqlx::query(
            r#"INSERT INTO local_conversation_edges
            (conversation_id, parent_message_id, child_message_id, edge_kind, created_at)
            VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING"#,
        )
        .bind(conversation_id)
        .bind(json_string(edge, "/parentMessageId").unwrap())
        .bind(json_string(edge, "/childMessageId").unwrap())
        .bind(json_string(edge, "/kind").unwrap_or("reply"))
        .bind(now)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LocalAiHandoffError::StorageFailure)?;
    }

    let inserted = sqlx::query(
        r#"INSERT INTO local_ai_handoffs (
          id, conversation_id, source_message_id, provider_connection_id, provider_type,
          model_id, selected_message_ids_json, selected_asset_ids_json, conversion_warnings_json,
          payload_hash, outbound_payload_hash, estimated_input_units, consented_by, consented_at,
          provider_response_id, result_message_id, status, created_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)
        ON CONFLICT(id) DO NOTHING"#,
    )
    .bind(handoff_id)
    .bind(conversation_id)
    .bind(source_message_id)
    .bind(json_string(&handoff, "/providerConnectionId").unwrap_or(""))
    .bind(json_string(&handoff, "/providerType").unwrap_or(""))
    .bind(json_string(&handoff, "/modelId").unwrap_or(""))
    .bind(
        handoff
            .get("selectedMessageIds")
            .unwrap_or(&serde_json::Value::Null)
            .to_string(),
    )
    .bind(
        handoff
            .get("selectedAssetIds")
            .unwrap_or(&serde_json::Value::Null)
            .to_string(),
    )
    .bind(
        handoff
            .get("conversionWarnings")
            .unwrap_or(&serde_json::Value::Null)
            .to_string(),
    )
    .bind(json_string(&handoff, "/payloadHash").unwrap())
    .bind(json_string(&handoff, "/outboundPayloadHash").unwrap())
    .bind(
        handoff
            .get("estimatedInputUnits")
            .and_then(serde_json::Value::as_i64)
            .unwrap_or(0),
    )
    .bind(json_string(&handoff, "/consentedBy").unwrap_or(""))
    .bind(json_string(&handoff, "/consentedAt").unwrap_or(""))
    .bind(&input.provider_response_id)
    .bind(&input.result_message_id)
    .bind(json_string(&handoff, "/createdAt").unwrap_or(now))
    .bind(now)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LocalAiHandoffError::StorageFailure)?;

    if inserted.rows_affected() == 0 {
        let existing: Option<(String, Option<String>)> = sqlx::query_as(
            "SELECT result_message_id, provider_response_id FROM local_ai_handoffs WHERE id = ?",
        )
        .bind(handoff_id)
        .fetch_optional(&mut *transaction)
        .await
        .map_err(|_| LocalAiHandoffError::StorageFailure)?;
        if existing
            != Some((
                input.result_message_id.clone(),
                input.provider_response_id.clone(),
            ))
        {
            return Err(LocalAiHandoffError::Conflict);
        }
    }
    transaction
        .commit()
        .await
        .map_err(|_| LocalAiHandoffError::StorageFailure)
}

#[tauri::command]
async fn save_local_ai_handoff_atomic(
    db_instances: State<'_, DbInstances>,
    input: LocalAiHandoffInput,
) -> Result<(), String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err(LocalAiHandoffError::DatabaseUnavailable.code().to_string()),
        }
    };
    save_local_ai_handoff_transaction(&pool, &input)
        .await
        .map_err(|error| error.code().to_string())
}

#[tauri::command]
async fn load_local_conversation(
    db_instances: State<'_, DbInstances>,
    conversation_id: String,
) -> Result<Option<String>, String> {
    validate_provider_reference(&conversation_id)
        .map_err(|_| LocalAiHandoffError::InvalidInput.code().to_string())?;
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err(LocalAiHandoffError::DatabaseUnavailable.code().to_string()),
        }
    };
    sqlx::query_scalar("SELECT canonical_json FROM local_conversations WHERE id = ? LIMIT 1")
        .bind(conversation_id)
        .fetch_optional(&pool)
        .await
        .map_err(|_| LocalAiHandoffError::StorageFailure.code().to_string())
}

#[tauri::command]
async fn list_local_conversations(
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<LocalConversationSummary>, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err(LocalAiHandoffError::DatabaseUnavailable.code().to_string()),
        }
    };
    list_local_conversation_summaries(&pool)
        .await
        .map_err(|error| error.code().to_string())
}

async fn list_local_conversation_summaries(
    pool: &Pool<Sqlite>,
) -> Result<Vec<LocalConversationSummary>, LocalAiHandoffError> {
    sqlx::query_as::<_, LocalConversationSummary>(
        r#"SELECT c.id, c.title, COUNT(m.id) AS message_count, c.updated_at
           FROM local_conversations c
           LEFT JOIN local_conversation_messages m ON m.conversation_id = c.id
           GROUP BY c.id, c.title, c.updated_at
           ORDER BY c.updated_at DESC, c.id ASC
           LIMIT ?"#,
    )
    .bind(MAX_LOCAL_CONVERSATION_LIST_ITEMS)
    .fetch_all(pool)
    .await
    .map_err(|_| LocalAiHandoffError::StorageFailure)
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
    let migrations = vec![
        Migration {
            version: 1,
            description: "create_local_first_foundation",
            sql: include_str!("../migrations/0001_local_foundation.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create_local_ai_handoffs",
            sql: include_str!("../migrations/0002_local_ai_handoffs.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_local_draft_atomic,
            store_cloud_session,
            load_cloud_session,
            delete_cloud_session,
            store_provider_credential,
            load_provider_credential,
            delete_provider_credential,
            save_local_ai_handoff_atomic,
            load_local_conversation,
            list_local_conversations
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
    use std::time::{SystemTime, UNIX_EPOCH};

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
        sqlx::raw_sql(include_str!("../migrations/0002_local_ai_handoffs.sql"))
            .execute(&pool)
            .await
            .expect("apply local AI schema");
        pool
    }

    fn ai_handoff_input(result_message_id: &str) -> LocalAiHandoffInput {
        let conversation_id = "00000000-0000-4000-8000-000000000101";
        let source_message_id = "00000000-0000-4000-8000-000000000102";
        let handoff_id = "00000000-0000-4000-8000-000000000103";
        let connection_id = "00000000-0000-4000-8000-000000000104";
        let actor_id = "00000000-0000-4000-8000-000000000105";
        LocalAiHandoffInput {
            conversation_json: serde_json::json!({
                "schemaVersion": 1,
                "id": conversation_id,
                "title": "Persisted handoff",
                "defaultLanguage": "ja",
                "providerMetadata": {},
                "messages": [
                    { "id": source_message_id, "conversationId": conversation_id, "role": "user", "contentParts": [{"type":"text","text":"Question"}] },
                    { "id": result_message_id, "conversationId": conversation_id, "role": "assistant", "contentParts": [{"type":"text","text":"Answer"}] }
                ],
                "edges": [{ "parentMessageId": source_message_id, "childMessageId": result_message_id, "kind": "ai_continuation" }]
            }).to_string(),
            handoff_json: serde_json::json!({
                "id": handoff_id,
                "conversationId": conversation_id,
                "sourceMessageId": source_message_id,
                "providerConnectionId": connection_id,
                "providerType": "openai-compatible",
                "modelId": "writer-model",
                "selectedMessageIds": [source_message_id],
                "selectedAssetIds": [],
                "conversionWarnings": [],
                "payloadHash": "a".repeat(64),
                "outboundPayloadHash": "b".repeat(64),
                "estimatedInputUnits": 10,
                "consentedBy": actor_id,
                "consentedAt": "2026-08-30T00:00:00.000Z",
                "createdAt": "2026-08-30T00:00:00.000Z"
            }).to_string(),
            result_message_id: result_message_id.into(),
            provider_response_id: Some("provider-response".into()),
            completed_at: "2026-08-30T00:00:01.000Z".into(),
        }
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

    #[tokio::test]
    async fn persists_completed_ai_handoff_message_and_edge_atomically() {
        let pool = pool().await;
        let result_message_id = "00000000-0000-4000-8000-000000000106";
        let input = ai_handoff_input(result_message_id);

        save_local_ai_handoff_transaction(&pool, &input)
            .await
            .expect("persist completed handoff");
        save_local_ai_handoff_transaction(&pool, &input)
            .await
            .expect("replay identical handoff");

        let counts: (i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM local_ai_handoffs), (SELECT COUNT(*) FROM local_conversation_messages), (SELECT COUNT(*) FROM local_conversation_edges)",
        )
        .fetch_one(&pool)
        .await
        .expect("read AI handoff records");
        assert_eq!(counts, (1, 2, 1));

        let summaries = list_local_conversation_summaries(&pool)
            .await
            .expect("list local conversations");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].message_count, 2);
        assert_eq!(summaries[0].title, "Persisted handoff");
    }

    #[tokio::test]
    async fn restores_completed_ai_handoff_after_database_reopen() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "komyaku-ai-handoff-restart-{}-{nonce}.db",
            std::process::id()
        ));
        let database_url = format!("sqlite://{}?mode=rwc", path.display());
        let first = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .expect("create restart database");
        sqlx::raw_sql(include_str!("../migrations/0001_local_foundation.sql"))
            .execute(&first)
            .await
            .expect("apply local schema");
        sqlx::raw_sql(include_str!("../migrations/0002_local_ai_handoffs.sql"))
            .execute(&first)
            .await
            .expect("apply local AI schema");

        let result_message_id = "00000000-0000-4000-8000-000000000106";
        save_local_ai_handoff_transaction(&first, &ai_handoff_input(result_message_id))
            .await
            .expect("persist before restart");
        first.close().await;

        let reopened = SqlitePoolOptions::new()
            .max_connections(1)
            .connect(&database_url)
            .await
            .expect("reopen restart database");
        let summaries = list_local_conversation_summaries(&reopened)
            .await
            .expect("list after restart");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].message_count, 2);
        let canonical: String = sqlx::query_scalar(
            "SELECT canonical_json FROM local_conversations WHERE id = ? LIMIT 1",
        )
        .bind("00000000-0000-4000-8000-000000000101")
        .fetch_one(&reopened)
        .await
        .expect("load conversation after restart");
        assert!(canonical.contains(result_message_id));
        assert!(canonical.contains("ai_continuation"));
        reopened.close().await;
        std::fs::remove_file(path).expect("remove restart database");
    }

    #[tokio::test]
    async fn conflicting_handoff_replay_rolls_back_conversation_update() {
        let pool = pool().await;
        let original_id = "00000000-0000-4000-8000-000000000106";
        save_local_ai_handoff_transaction(&pool, &ai_handoff_input(original_id))
            .await
            .expect("persist original handoff");
        let conflicting_id = "00000000-0000-4000-8000-000000000107";
        let error = save_local_ai_handoff_transaction(&pool, &ai_handoff_input(conflicting_id))
            .await
            .expect_err("reject conflicting replay");
        assert_eq!(error, LocalAiHandoffError::Conflict);

        let canonical: String =
            sqlx::query_scalar("SELECT canonical_json FROM local_conversations WHERE id = ?")
                .bind("00000000-0000-4000-8000-000000000101")
                .fetch_one(&pool)
                .await
                .expect("read original conversation");
        assert!(canonical.contains(original_id));
        assert!(!canonical.contains(conflicting_id));
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

    #[test]
    fn accepts_only_uuid_provider_references() {
        assert_eq!(
            validate_provider_reference("00000000-0000-4000-8000-000000000001"),
            Ok(())
        );
        assert_eq!(
            validate_provider_reference("../cloud-session-v1"),
            Err(SecureSessionError::InvalidProviderReference)
        );
    }
}
