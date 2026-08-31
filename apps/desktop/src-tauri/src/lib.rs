use image::{ImageFormat, ImageReader, Limits};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use sqlx::{Pool, Sqlite};
use std::collections::BTreeSet;
use std::collections::BTreeMap;
use std::io::Cursor;
use tauri::State;
use tauri_plugin_sql::{DbInstances, DbPool, Migration, MigrationKind};

const LOCAL_DATABASE_URL: &str = "sqlite:komyaku.db";
const MAX_LOCAL_DRAFT_BYTES: usize = 12 * 1024 * 1024;
const SECURE_SESSION_SERVICE: &str = "app.komyaku.desktop";
const SECURE_SESSION_ACCOUNT: &str = "cloud-session-v1";
const MAX_PROVIDER_SECRET_BYTES: usize = 16 * 1024;
const MAX_LOCAL_CONVERSATION_BYTES: usize = 12 * 1024 * 1024;
const MAX_LOCAL_CONVERSATION_LIST_ITEMS: i64 = 100;
const MAX_LOCAL_PNG_PREVIEW_BYTES: usize = 256 * 1024;
const MAX_LOCAL_PNG_PREVIEW_PIXELS: u64 = 16_000_000;
const MAX_LOCAL_ARCHIVE_ASSET_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalArchiveAssetInput {
    asset_id: String,
    media_type: String,
    content_hash: String,
    bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalArchiveImportInput {
    archive_digest: String,
    document: LocalDraftInput,
    assets: Vec<LocalArchiveAssetInput>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LocalArchiveImportResult {
    archive_digest: String,
    document_id: String,
    content_json: String,
    asset_count: usize,
    replayed: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LocalDocumentSummary {
    document_id: String,
    title: String,
    default_language: String,
    local_revision: i64,
    updated_at: String,
    archived_at: Option<String>,
    archive_digest: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalDocumentMutationInput {
    document_id: String,
    title: Option<String>,
    archived: Option<bool>,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalPngPreviewInput {
    asset_id: String,
    bytes: Vec<u8>,
    updated_at: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LocalPngPreviewResult {
    asset_id: String,
    byte_size: usize,
    content_hash: String,
    width: u32,
    height: u32,
}

#[derive(Debug, Serialize, sqlx::FromRow, PartialEq)]
#[serde(rename_all = "camelCase")]
struct QuarantinedLocalAssetSummary {
    asset_id: String,
    byte_size: i64,
    width: i64,
    height: i64,
    quarantined_at: String,
}

async fn list_quarantined_local_assets_transaction(
    pool: &Pool<Sqlite>,
) -> Result<Vec<QuarantinedLocalAssetSummary>, &'static str> {
    sqlx::query_as(
        "SELECT asset_id, byte_size, inspected_width AS width, inspected_height AS height,
                quarantined_at
         FROM local_asset_previews
         WHERE lifecycle_status = 'quarantined'
           AND inspection_status = 'accepted'
           AND detected_media_type = 'image/png'
           AND quarantined_at IS NOT NULL
         ORDER BY quarantined_at DESC, asset_id ASC
         LIMIT 100",
    )
    .fetch_all(pool)
    .await
    .map_err(|_| "local_asset_quarantine_unavailable")
}

fn inspect_local_png_preview(
    input: &LocalPngPreviewInput,
) -> Result<LocalPngPreviewResult, &'static str> {
    if input.bytes.is_empty()
        || input.bytes.len() > MAX_LOCAL_PNG_PREVIEW_BYTES
        || input.updated_at.is_empty()
        || input.updated_at.len() > 64
        || validate_provider_reference(&input.asset_id).is_err()
        || input
            .asset_id
            .bytes()
            .any(|value| value.is_ascii_uppercase())
    {
        return Err("invalid_local_png_preview");
    }
    let mut reader = ImageReader::with_format(Cursor::new(&input.bytes), ImageFormat::Png);
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_LOCAL_PNG_PREVIEW_PIXELS as u32);
    limits.max_image_height = Some(MAX_LOCAL_PNG_PREVIEW_PIXELS as u32);
    limits.max_alloc = Some(MAX_LOCAL_PNG_PREVIEW_PIXELS * 4);
    reader.limits(limits);
    let image = reader.decode().map_err(|_| "invalid_local_png_preview")?;
    let width = image.width();
    let height = image.height();
    if width == 0
        || height == 0
        || u64::from(width) * u64::from(height) > MAX_LOCAL_PNG_PREVIEW_PIXELS
    {
        return Err("local_png_preview_dimensions_exceeded");
    }
    let content_hash = Sha256::digest(&input.bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(LocalPngPreviewResult {
        asset_id: input.asset_id.clone(),
        byte_size: input.bytes.len(),
        content_hash,
        width,
        height,
    })
}

async fn store_local_png_preview_transaction(
    pool: &Pool<Sqlite>,
    input: &LocalPngPreviewInput,
) -> Result<LocalPngPreviewResult, &'static str> {
    let result = inspect_local_png_preview(input)?;
    let mut transaction = pool
        .begin()
        .await
        .map_err(|_| "local_png_preview_storage_failure")?;
    sqlx::query(
        "INSERT INTO local_asset_previews
         (asset_id, bytes, byte_size, content_hash, detected_media_type,
          inspection_status, inspection_policy_version, inspected_width,
          inspected_height, updated_at, lifecycle_status)
         VALUES (?, ?, ?, ?, 'image/png', 'accepted', 'decoder-backed-png-v1', ?, ?, ?, 'pending')
         ON CONFLICT(asset_id) DO NOTHING",
    )
    .bind(&result.asset_id)
    .bind(&input.bytes)
    .bind(result.byte_size as i64)
    .bind(&result.content_hash)
    .bind(i64::from(result.width))
    .bind(i64::from(result.height))
    .bind(&input.updated_at)
    .execute(&mut *transaction)
    .await
    .map_err(|_| "local_png_preview_storage_failure")?;
    let stored: (i64, String, i64, i64) = sqlx::query_as(
        "SELECT byte_size, content_hash, inspected_width, inspected_height
         FROM local_asset_previews WHERE asset_id = ? LIMIT 1",
    )
    .bind(&result.asset_id)
    .fetch_one(&mut *transaction)
    .await
    .map_err(|_| "local_png_preview_storage_failure")?;
    if stored.0 != result.byte_size as i64
        || stored.1 != result.content_hash
        || stored.2 != i64::from(result.width)
        || stored.3 != i64::from(result.height)
    {
        return Err("local_png_preview_conflict");
    }
    transaction
        .commit()
        .await
        .map_err(|_| "local_png_preview_storage_failure")?;
    Ok(result)
}

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

/// Harmless command used by the isolated renderer to prove that application
/// command ACL enforcement is active. It is deliberately granted only to main.
#[tauri::command]
fn acl_boundary_canary() -> &'static str {
    "main-command-accessible"
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

fn collect_local_asset_ids(content_json: &str) -> Result<BTreeSet<String>, LocalDraftSaveError> {
    fn visit_nodes(value: &serde_json::Value, assets: &mut BTreeSet<String>) {
        let Some(nodes) = value.as_array() else {
            return;
        };
        for node in nodes {
            let Some(object) = node.as_object() else {
                continue;
            };
            if let Some(asset_id) = object.get("assetId").and_then(serde_json::Value::as_str) {
                if validate_provider_reference(asset_id).is_ok()
                    && !asset_id.bytes().any(|value| value.is_ascii_uppercase())
                {
                    assets.insert(asset_id.to_string());
                }
            }
            if let Some(artifacts) = object.get("renderArtifacts").and_then(serde_json::Value::as_array) {
                for artifact in artifacts {
                    if let Some(asset_id) = artifact.get("assetId").and_then(serde_json::Value::as_str) {
                        if validate_provider_reference(asset_id).is_ok()
                            && !asset_id.bytes().any(|value| value.is_ascii_uppercase())
                        {
                            assets.insert(asset_id.to_string());
                        }
                    }
                }
            }
            if let Some(content) = object.get("content") {
                visit_nodes(content, assets);
            }
        }
    }

    let content: serde_json::Value =
        serde_json::from_str(content_json).map_err(|_| LocalDraftSaveError::InvalidInput)?;
    let mut assets = BTreeSet::new();
    if let Some(nodes) = content.get("content") {
        visit_nodes(nodes, &mut assets);
    }
    Ok(assets)
}

async fn save_local_draft_transaction(
    pool: &Pool<Sqlite>,
    input: &LocalDraftInput,
) -> Result<(), LocalDraftSaveError> {
    validate_local_draft_input(input)?;
    let asset_ids = collect_local_asset_ids(&input.content_json)?;
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

    let previous_asset_ids: Vec<String> = sqlx::query_scalar(
        "SELECT asset_id FROM local_document_asset_references WHERE document_id = ?",
    )
    .bind(&input.document_id)
    .fetch_all(&mut *transaction)
    .await
    .map_err(|_| LocalDraftSaveError::StorageFailure)?;

    sqlx::query("DELETE FROM local_document_asset_references WHERE document_id = ?")
        .bind(&input.document_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LocalDraftSaveError::StorageFailure)?;

    for asset_id in &asset_ids {
        sqlx::query(
            "INSERT INTO local_document_asset_references (document_id, asset_id, updated_at)
             SELECT ?, asset_id, ? FROM local_asset_previews WHERE asset_id = ?",
        )
        .bind(&input.document_id)
        .bind(&input.updated_at)
        .bind(asset_id)
        .execute(&mut *transaction)
        .await
            .map_err(|_| LocalDraftSaveError::StorageFailure)?;
        sqlx::query(
            "INSERT INTO local_archive_asset_references (document_id, asset_id, updated_at)
             SELECT ?, asset_id, ? FROM local_archive_assets WHERE asset_id = ?
             ON CONFLICT(document_id, asset_id) DO UPDATE SET updated_at = excluded.updated_at",
        )
        .bind(&input.document_id)
        .bind(&input.updated_at)
        .bind(asset_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LocalDraftSaveError::StorageFailure)?;
    }

    sqlx::query(
        "DELETE FROM local_archive_asset_references
         WHERE document_id = ? AND asset_id NOT IN (SELECT value FROM json_each(?))",
    )
    .bind(&input.document_id)
    .bind(serde_json::to_string(&asset_ids).map_err(|_| LocalDraftSaveError::InvalidInput)?)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LocalDraftSaveError::StorageFailure)?;

    sqlx::query(
        "UPDATE local_archive_assets SET lifecycle_status = CASE
           WHEN EXISTS (SELECT 1 FROM local_archive_asset_references reference
                        WHERE reference.asset_id = local_archive_assets.asset_id)
           THEN 'active' ELSE 'quarantined' END, updated_at = ?",
    )
    .bind(&input.updated_at)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LocalDraftSaveError::StorageFailure)?;

    sqlx::query(
        "UPDATE local_asset_previews
         SET lifecycle_status = 'active', last_referenced_at = ?, quarantined_at = NULL
         WHERE asset_id IN (
           SELECT asset_id FROM local_document_asset_references WHERE document_id = ?
         )",
    )
    .bind(&input.updated_at)
    .bind(&input.document_id)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LocalDraftSaveError::StorageFailure)?;

    for asset_id in previous_asset_ids {
        sqlx::query(
            "UPDATE local_asset_previews
             SET lifecycle_status = 'quarantined', quarantined_at = ?
             WHERE asset_id = ? AND lifecycle_status = 'active'
               AND NOT EXISTS (
                 SELECT 1 FROM local_document_asset_references WHERE asset_id = ?
               )",
        )
        .bind(&input.updated_at)
        .bind(&asset_id)
        .bind(&asset_id)
        .execute(&mut *transaction)
        .await
        .map_err(|_| LocalDraftSaveError::StorageFailure)?;
    }

    sqlx::query(
        "UPDATE local_asset_previews
         SET lifecycle_status = 'quarantined', quarantined_at = ?
         WHERE lifecycle_status = 'pending'
           AND datetime(updated_at) <= datetime(?, '-1 day')
           AND NOT EXISTS (
             SELECT 1 FROM local_document_asset_references
             WHERE asset_id = local_asset_previews.asset_id
           )",
    )
    .bind(&input.updated_at)
    .bind(&input.updated_at)
    .execute(&mut *transaction)
    .await
    .map_err(|_| LocalDraftSaveError::StorageFailure)?;

    transaction
        .commit()
        .await
        .map_err(|_| LocalDraftSaveError::StorageFailure)
}

fn remap_archive_asset_ids(value: &mut serde_json::Value, mapping: &BTreeMap<String, String>) {
    match value {
        serde_json::Value::Array(items) => {
            for item in items { remap_archive_asset_ids(item, mapping); }
        }
        serde_json::Value::Object(object) => {
            if let Some(serde_json::Value::String(asset_id)) = object.get_mut("assetId") {
                if let Some(mapped) = mapping.get(asset_id) { *asset_id = mapped.clone(); }
            }
            for child in object.values_mut() { remap_archive_asset_ids(child, mapping); }
        }
        _ => {}
    }
}

fn inspect_local_archive_asset(
    asset: &LocalArchiveAssetInput,
    updated_at: &str,
) -> Result<(String, Option<i64>, Option<i64>), &'static str> {
    if asset.bytes.is_empty() || asset.bytes.len() > MAX_LOCAL_ARCHIVE_ASSET_BYTES
        || validate_provider_reference(&asset.asset_id).is_err()
        || asset.asset_id.bytes().any(|value| value.is_ascii_uppercase())
        || asset.content_hash.len() != 64
        || asset.content_hash.bytes().any(|value| !value.is_ascii_hexdigit() || value.is_ascii_uppercase())
    {
        return Err("invalid_local_archive_asset");
    }
    let digest: String = Sha256::digest(&asset.bytes).iter().map(|byte| format!("{byte:02x}")).collect();
    if digest != asset.content_hash { return Err("local_archive_asset_integrity_mismatch"); }
    if asset.media_type == "image/png" {
        let inspected = inspect_local_png_preview(&LocalPngPreviewInput {
            asset_id: asset.asset_id.clone(), bytes: asset.bytes.clone(), updated_at: updated_at.into()
        })?;
        return Ok(("decoder-backed-png-v1".into(), Some(i64::from(inspected.width)), Some(i64::from(inspected.height))));
    }
    let text = std::str::from_utf8(&asset.bytes).map_err(|_| "invalid_local_archive_asset")?;
    if text.contains('\0') { return Err("invalid_local_archive_asset"); }
    let trimmed = text.trim_start();
    if trimmed.starts_with("<svg") || (trimmed.starts_with("<?xml") && trimmed.contains("<svg")) {
        return Err("invalid_local_archive_asset");
    }
    match asset.media_type.as_str() {
        "text/plain" | "text/markdown" | "text/csv" | "text/vnd.mermaid" => {}
        "application/json" => {
            serde_json::from_str::<serde_json::Value>(text).map_err(|_| "invalid_local_archive_asset")?;
        }
        _ => return Err("unsupported_local_archive_asset"),
    }
    Ok(("baseline-signature-v1".into(), None, None))
}

async fn import_local_archive_transaction(
    pool: &Pool<Sqlite>, input: &LocalArchiveImportInput,
) -> Result<LocalArchiveImportResult, &'static str> {
    if input.archive_digest.len() != 64
        || input.archive_digest.bytes().any(|value| !value.is_ascii_hexdigit() || value.is_ascii_uppercase())
        || input.assets.len() > 5000
    { return Err("invalid_local_archive_import"); }
    validate_local_draft_input(&input.document).map_err(|_| "invalid_local_archive_import")?;
    let expected = collect_local_asset_ids(&input.document.content_json)
        .map_err(|_| "invalid_local_archive_import")?;
    let supplied: BTreeSet<String> = input.assets.iter().map(|asset| asset.asset_id.clone()).collect();
    if expected != supplied || supplied.len() != input.assets.len() {
        return Err("local_archive_asset_set_mismatch");
    }
    let inspections: Vec<(String, Option<i64>, Option<i64>)> = input.assets.iter()
        .map(|asset| inspect_local_archive_asset(asset, &input.document.updated_at))
        .collect::<Result<_, _>>()?;
    let mut transaction = pool.begin().await.map_err(|_| "local_archive_storage_failure")?;
    let replay: Option<(String, String)> = sqlx::query_as(
        "SELECT imported.document_id, draft.content_json FROM local_archive_imports imported
         JOIN local_drafts draft ON draft.document_id = imported.document_id
         WHERE imported.archive_digest = ? AND imported.document_id = ? LIMIT 1")
        .bind(&input.archive_digest).bind(&input.document.document_id)
        .fetch_optional(&mut *transaction).await
        .map_err(|_| "local_archive_storage_failure")?;
    if let Some((document_id, content_json)) = replay {
        return Ok(LocalArchiveImportResult { archive_digest: input.archive_digest.clone(), document_id,
            content_json, asset_count: input.assets.len(), replayed: true });
    }
    let document_conflict: Option<String> = sqlx::query_scalar(
        "SELECT id FROM local_documents WHERE id = ? LIMIT 1")
        .bind(&input.document.document_id).fetch_optional(&mut *transaction).await
        .map_err(|_| "local_archive_storage_failure")?;
    if document_conflict.is_some() { return Err("local_archive_document_identity_conflict"); }

    let mut mapping = BTreeMap::new();
    for (asset, (policy, width, height)) in input.assets.iter().zip(inspections.iter()) {
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT asset_id FROM local_archive_assets WHERE content_hash = ? LIMIT 1")
            .bind(&asset.content_hash).fetch_optional(&mut *transaction).await
            .map_err(|_| "local_archive_storage_failure")?;
        let materialized_id = existing.unwrap_or_else(|| asset.asset_id.clone());
        sqlx::query(
            "INSERT INTO local_archive_assets
             (asset_id, bytes, byte_size, content_hash, media_type, inspection_policy_version,
              inspected_width, inspected_height, lifecycle_status, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
             ON CONFLICT(content_hash) DO UPDATE SET lifecycle_status = 'active', updated_at = excluded.updated_at")
            .bind(&materialized_id).bind(&asset.bytes).bind(asset.bytes.len() as i64)
            .bind(&asset.content_hash).bind(&asset.media_type).bind(policy)
            .bind(width).bind(height).bind(&input.document.updated_at).bind(&input.document.updated_at)
            .execute(&mut *transaction).await.map_err(|_| "local_archive_asset_conflict")?;
        if asset.media_type == "image/png" {
            sqlx::query(
                "INSERT INTO local_asset_previews
                 (asset_id, bytes, byte_size, content_hash, detected_media_type, inspection_status,
                  inspection_policy_version, inspected_width, inspected_height, updated_at, lifecycle_status)
                 VALUES (?, ?, ?, ?, 'image/png', 'accepted', 'decoder-backed-png-v1', ?, ?, ?, 'active')
                 ON CONFLICT(asset_id) DO NOTHING")
                .bind(&materialized_id).bind(&asset.bytes).bind(asset.bytes.len() as i64)
                .bind(&asset.content_hash).bind(width).bind(height).bind(&input.document.updated_at)
                .execute(&mut *transaction).await.map_err(|_| "local_archive_asset_conflict")?;
        }
        mapping.insert(asset.asset_id.clone(), materialized_id);
    }
    let mut document_value: serde_json::Value = serde_json::from_str(&input.document.content_json)
        .map_err(|_| "invalid_local_archive_import")?;
    remap_archive_asset_ids(&mut document_value, &mapping);
    let content_json = serde_json::to_string(&document_value).map_err(|_| "invalid_local_archive_import")?;
    let document_id = input.document.document_id.clone();
    sqlx::query(
        "INSERT INTO local_documents
         (id, title, default_language, default_direction, default_writing_mode, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)")
        .bind(&document_id).bind(&input.document.title).bind(&input.document.language)
        .bind(&input.document.direction).bind(&input.document.writing_mode)
        .bind(&input.document.updated_at).bind(&input.document.updated_at)
        .execute(&mut *transaction).await.map_err(|_| "local_archive_storage_failure")?;
    sqlx::query(
        "INSERT INTO local_drafts
         (document_id, schema_version, content_json, local_revision, is_composing, updated_at)
         VALUES (?, ?, ?, 1, 0, ?)")
        .bind(&document_id).bind(input.document.schema_version).bind(&content_json)
        .bind(&input.document.updated_at).execute(&mut *transaction).await
        .map_err(|_| "local_archive_storage_failure")?;
    for asset_id in mapping.values().collect::<BTreeSet<_>>() {
        sqlx::query(
            "INSERT INTO local_archive_asset_references (document_id, asset_id, updated_at) VALUES (?, ?, ?)")
            .bind(&document_id).bind(asset_id).bind(&input.document.updated_at)
            .execute(&mut *transaction).await.map_err(|_| "local_archive_storage_failure")?;
        sqlx::query(
            "INSERT INTO local_document_asset_references (document_id, asset_id, updated_at)
             SELECT ?, asset_id, ? FROM local_asset_previews WHERE asset_id = ?")
            .bind(&document_id).bind(&input.document.updated_at).bind(asset_id)
            .execute(&mut *transaction).await.map_err(|_| "local_archive_storage_failure")?;
    }
    sqlx::query(
        "INSERT INTO local_archive_imports (archive_digest, document_id, asset_count, imported_at)
         VALUES (?, ?, ?, ?)")
        .bind(&input.archive_digest).bind(&document_id).bind(input.assets.len() as i64)
        .bind(&input.document.updated_at).execute(&mut *transaction).await
        .map_err(|_| "local_archive_storage_failure")?;
    transaction.commit().await.map_err(|_| "local_archive_storage_failure")?;
    Ok(LocalArchiveImportResult { archive_digest: input.archive_digest.clone(), document_id,
        content_json, asset_count: input.assets.len(), replayed: false })
}

#[tauri::command]
async fn import_local_komyaku_archive_atomic(
    db_instances: State<'_, DbInstances>, input: LocalArchiveImportInput,
) -> Result<LocalArchiveImportResult, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("tauri_database_unavailable".to_string()),
        }
    };
    import_local_archive_transaction(&pool, &input).await.map_err(str::to_string)
}

async fn list_local_documents_transaction(
    pool: &Pool<Sqlite>,
) -> Result<Vec<LocalDocumentSummary>, &'static str> {
    sqlx::query_as(
        "SELECT document.id AS document_id, document.title, document.default_language,
                draft.local_revision, document.updated_at, document.archived_at, imported.archive_digest
         FROM local_documents document JOIN local_drafts draft ON draft.document_id = document.id
         LEFT JOIN local_archive_imports imported ON imported.document_id = document.id
         ORDER BY document.archived_at IS NOT NULL, document.updated_at DESC, document.id
         LIMIT 200")
        .fetch_all(pool).await.map_err(|_| "local_document_library_unavailable")
}

async fn mutate_local_document_transaction(
    pool: &Pool<Sqlite>, input: &LocalDocumentMutationInput,
) -> Result<LocalDocumentSummary, &'static str> {
    if validate_provider_reference(&input.document_id).is_err()
        || input.updated_at.is_empty() || input.updated_at.len() > 64
        || input.title.is_none() && input.archived.is_none()
        || input.title.as_ref().is_some_and(|title| title.len() > 1000)
    { return Err("invalid_local_document_mutation"); }
    let mut transaction = pool.begin().await.map_err(|_| "local_document_library_failure")?;
    if let Some(title) = &input.title {
        let content_json: String = sqlx::query_scalar(
            "SELECT content_json FROM local_drafts WHERE document_id = ? LIMIT 1")
            .bind(&input.document_id).fetch_optional(&mut *transaction).await
            .map_err(|_| "local_document_library_failure")?
            .ok_or("local_document_not_found")?;
        let mut content: serde_json::Value = serde_json::from_str(&content_json)
            .map_err(|_| "local_document_corrupt")?;
        let metadata = content.get_mut("metadata").and_then(serde_json::Value::as_object_mut)
            .ok_or("local_document_corrupt")?;
        metadata.insert("title".into(), serde_json::Value::String(title.clone()));
        let next_json = serde_json::to_string(&content).map_err(|_| "local_document_corrupt")?;
        sqlx::query("UPDATE local_drafts SET content_json = ?, local_revision = local_revision + 1, updated_at = ? WHERE document_id = ?")
            .bind(next_json).bind(&input.updated_at).bind(&input.document_id)
            .execute(&mut *transaction).await.map_err(|_| "local_document_library_failure")?;
        sqlx::query("UPDATE local_documents SET title = ?, updated_at = ? WHERE id = ?")
            .bind(title).bind(&input.updated_at).bind(&input.document_id)
            .execute(&mut *transaction).await.map_err(|_| "local_document_library_failure")?;
    }
    if let Some(archived) = input.archived {
        sqlx::query("UPDATE local_documents SET archived_at = ?, updated_at = ? WHERE id = ?")
            .bind(if archived { Some(input.updated_at.as_str()) } else { None })
            .bind(&input.updated_at).bind(&input.document_id)
            .execute(&mut *transaction).await.map_err(|_| "local_document_library_failure")?;
    }
    let summary = sqlx::query_as(
        "SELECT document.id AS document_id, document.title, document.default_language,
                draft.local_revision, document.updated_at, document.archived_at, imported.archive_digest
         FROM local_documents document JOIN local_drafts draft ON draft.document_id = document.id
         LEFT JOIN local_archive_imports imported ON imported.document_id = document.id
         WHERE document.id = ? LIMIT 1")
        .bind(&input.document_id).fetch_optional(&mut *transaction).await
        .map_err(|_| "local_document_library_failure")?.ok_or("local_document_not_found")?;
    transaction.commit().await.map_err(|_| "local_document_library_failure")?;
    Ok(summary)
}

#[tauri::command]
async fn list_local_documents(db_instances: State<'_, DbInstances>) -> Result<Vec<LocalDocumentSummary>, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) { Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("tauri_database_unavailable".into()) }
    };
    list_local_documents_transaction(&pool).await.map_err(str::to_string)
}

#[tauri::command]
async fn mutate_local_document_atomic(
    db_instances: State<'_, DbInstances>, input: LocalDocumentMutationInput,
) -> Result<LocalDocumentSummary, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) { Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("tauri_database_unavailable".into()) }
    };
    mutate_local_document_transaction(&pool, &input).await.map_err(str::to_string)
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

#[tauri::command]
async fn store_local_png_preview_atomic(
    db_instances: State<'_, DbInstances>,
    input: LocalPngPreviewInput,
) -> Result<LocalPngPreviewResult, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("tauri_database_unavailable".to_string()),
        }
    };
    store_local_png_preview_transaction(&pool, &input)
        .await
        .map_err(str::to_string)
}

#[tauri::command]
async fn list_quarantined_local_assets(
    db_instances: State<'_, DbInstances>,
) -> Result<Vec<QuarantinedLocalAssetSummary>, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) {
            Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("tauri_database_unavailable".to_string()),
        }
    };
    list_quarantined_local_assets_transaction(&pool)
        .await
        .map_err(str::to_string)
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
        Migration {
            version: 3,
            description: "create_local_asset_previews",
            sql: include_str!("../migrations/0003_local_asset_previews.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "create_local_asset_reference_lifecycle",
            sql: include_str!("../migrations/0004_local_asset_reference_lifecycle.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "create_local_archive_materialization",
            sql: include_str!("../migrations/0005_local_archive_materialization.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "create_local_document_library",
            sql: include_str!("../migrations/0006_local_document_library.sql"),
            kind: MigrationKind::Up,
        },
    ];

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            save_local_draft_atomic,
            store_local_png_preview_atomic,
            list_quarantined_local_assets,
            import_local_komyaku_archive_atomic,
            list_local_documents,
            mutate_local_document_atomic,
            store_cloud_session,
            load_cloud_session,
            delete_cloud_session,
            store_provider_credential,
            load_provider_credential,
            delete_provider_credential,
            save_local_ai_handoff_atomic,
            load_local_conversation,
            list_local_conversations,
            acl_boundary_canary
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
        sqlx::raw_sql(include_str!("../migrations/0003_local_asset_previews.sql"))
            .execute(&pool)
            .await
            .expect("apply local asset preview schema");
        sqlx::raw_sql(include_str!(
            "../migrations/0004_local_asset_reference_lifecycle.sql"
        ))
        .execute(&pool)
        .await
        .expect("apply local asset reference lifecycle schema");
        sqlx::raw_sql(include_str!("../migrations/0005_local_archive_materialization.sql"))
            .execute(&pool)
            .await
            .expect("apply local Archive materialization schema");
        sqlx::raw_sql(include_str!("../migrations/0006_local_document_library.sql"))
            .execute(&pool).await.expect("apply local Document library schema");
        pool
    }

    fn local_png_preview_input(asset_id: &str) -> LocalPngPreviewInput {
        LocalPngPreviewInput {
            asset_id: asset_id.into(),
            bytes: vec![
                137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0,
                1, 8, 4, 0, 0, 0, 181, 28, 12, 2, 0, 0, 0, 11, 73, 68, 65, 84, 120, 218, 99, 100,
                248, 15, 0, 1, 5, 1, 1, 39, 24, 227, 102, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96,
                130,
            ],
            updated_at: "2026-08-30T00:00:00.000Z".into(),
        }
    }

    fn local_archive_input(document_id: &str, asset_id: &str) -> LocalArchiveImportInput {
        let bytes = b"# Imported\n".to_vec();
        let content_hash: String = Sha256::digest(&bytes).iter()
            .map(|byte| format!("{byte:02x}")).collect();
        let content = serde_json::json!({
            "id": document_id,
            "schemaVersion": 1,
            "attrs": { "language": "ja", "direction": "auto", "writingMode": "horizontal-tb" },
            "metadata": { "title": "Imported" },
            "content": [{
                "id": "00000000-0000-4000-8000-000000000099", "schemaVersion": 1,
                "metadata": {}, "extensions": {}, "renderArtifacts": [], "type": "file",
                "assetId": asset_id, "mediaType": "text/markdown", "fileName": "draft.md",
                "title": null, "description": null
            }]
        });
        LocalArchiveImportInput {
            archive_digest: "a".repeat(64),
            document: LocalDraftInput {
                document_id: document_id.into(), schema_version: 1, content_json: content.to_string(),
                local_revision: 1, updated_at: "2026-08-31T00:00:00.000Z".into(),
                title: "Imported".into(), language: "ja".into(), direction: "auto".into(),
                writing_mode: "horizontal-tb".into()
            },
            assets: vec![LocalArchiveAssetInput {
                asset_id: asset_id.into(), media_type: "text/markdown".into(), content_hash, bytes
            }]
        }
    }

    #[tokio::test]
    async fn atomically_materializes_and_replays_local_archive_assets() {
        let pool = pool().await;
        let document_id = "00000000-0000-4000-8000-000000000088";
        let asset_id = "00000000-0000-4000-8000-000000000077";
        let input = local_archive_input(document_id, asset_id);
        let result = import_local_archive_transaction(&pool, &input).await.expect("materialize Archive");
        assert!(!result.replayed);
        assert_eq!(result.asset_count, 1);
        let state: (i64, i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM local_archive_assets),
                    (SELECT COUNT(*) FROM local_archive_asset_references),
                    (SELECT COUNT(*) FROM local_drafts WHERE document_id = ?)")
            .bind(document_id).fetch_one(&pool).await.expect("read materialized state");
        assert_eq!(state, (1, 1, 1));
        let replay = import_local_archive_transaction(&pool, &input).await.expect("replay Archive");
        assert!(replay.replayed);
        assert_eq!(replay.content_json, result.content_json);
    }

    #[tokio::test]
    async fn rejected_local_archive_leaves_no_document_or_asset() {
        let pool = pool().await;
        let mut input = local_archive_input(
            "00000000-0000-4000-8000-000000000066",
            "00000000-0000-4000-8000-000000000055",
        );
        input.assets[0].content_hash = "b".repeat(64);
        assert_eq!(import_local_archive_transaction(&pool, &input).await,
            Err("local_archive_asset_integrity_mismatch"));
        let state: (i64, i64) = sqlx::query_as(
            "SELECT (SELECT COUNT(*) FROM local_archive_assets), (SELECT COUNT(*) FROM local_documents)")
            .fetch_one(&pool).await.expect("read empty state");
        assert_eq!(state, (0, 0));
    }

    #[tokio::test]
    async fn local_document_library_lists_renames_and_archives_atomically() {
        let pool = pool().await;
        let draft = input(1, "Original");
        save_local_draft_transaction(&pool, &draft).await.expect("save library Document");
        let listed = list_local_documents_transaction(&pool).await.expect("list Documents");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].title, "Original");
        let renamed = mutate_local_document_transaction(&pool, &LocalDocumentMutationInput {
            document_id: draft.document_id.clone(), title: Some("Renamed".into()), archived: Some(true),
            updated_at: "2026-09-01T00:00:00.000Z".into()
        }).await.expect("rename and archive");
        assert_eq!(renamed.title, "Renamed");
        assert!(renamed.archived_at.is_some());
        assert_eq!(renamed.local_revision, 2);
        let content_json: String = sqlx::query_scalar("SELECT content_json FROM local_drafts WHERE document_id = ?")
            .bind(&draft.document_id).fetch_one(&pool).await.expect("read renamed Canonical JSON");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&content_json).unwrap()
            .pointer("/metadata/title").and_then(serde_json::Value::as_str), Some("Renamed"));
    }

    fn draft_with_image(revision: i64, asset_id: &str) -> LocalDraftInput {
        let mut draft = input(revision, "Image lifecycle");
        draft.updated_at = "2026-08-30T00:05:00.000Z".into();
        let mut content: serde_json::Value =
            serde_json::from_str(&draft.content_json).expect("parse draft fixture");
        content["content"] = serde_json::json!([{
            "type": "image",
            "assetId": asset_id,
            "mediaType": "image/png",
            "altText": "Lifecycle fixture"
        }]);
        draft.content_json = content.to_string();
        draft
    }

    #[tokio::test]
    async fn decoder_verified_png_is_stored_idempotently() {
        let pool = pool().await;
        let input = local_png_preview_input("00000000-0000-4000-8000-000000000201");
        let first = store_local_png_preview_transaction(&pool, &input)
            .await
            .expect("store decoded PNG");
        let replay = store_local_png_preview_transaction(&pool, &input)
            .await
            .expect("replay identical PNG");
        assert_eq!(first, replay);
        assert_eq!((first.width, first.height), (1, 1));

        let inspection: (String, String, i64) = sqlx::query_as(
            "SELECT detected_media_type, inspection_status, byte_size
             FROM local_asset_previews WHERE asset_id = ?",
        )
        .bind(&input.asset_id)
        .fetch_one(&pool)
        .await
        .expect("read stored preview");
        assert_eq!(inspection.0, "image/png");
        assert_eq!(inspection.1, "accepted");
        assert_eq!(inspection.2, input.bytes.len() as i64);
    }

    #[tokio::test]
    async fn corrupt_png_and_asset_identity_conflict_are_rejected() {
        let pool = pool().await;
        let asset_id = "00000000-0000-4000-8000-000000000202";
        let input = local_png_preview_input(asset_id);
        store_local_png_preview_transaction(&pool, &input)
            .await
            .expect("store original PNG");

        let mut conflict = input;
        conflict.bytes.push(0);
        assert_eq!(
            store_local_png_preview_transaction(&pool, &conflict).await,
            Err("local_png_preview_conflict")
        );

        let mut corrupt = local_png_preview_input("00000000-0000-4000-8000-000000000203");
        corrupt.bytes[0] = 0;
        assert_eq!(
            inspect_local_png_preview(&corrupt),
            Err("invalid_local_png_preview")
        );
    }

    #[tokio::test]
    async fn canonical_checkpoint_activates_then_quarantines_removed_local_asset() {
        let pool = pool().await;
        let asset_id = "00000000-0000-4000-8000-000000000204";
        store_local_png_preview_transaction(&pool, &local_png_preview_input(asset_id))
            .await
            .expect("store pending preview");

        save_local_draft_transaction(&pool, &draft_with_image(1, asset_id))
            .await
            .expect("save referencing draft");
        let active: (String, i64) = sqlx::query_as(
            "SELECT lifecycle_status,
                    (SELECT COUNT(*) FROM local_document_asset_references WHERE asset_id = ?)
             FROM local_asset_previews WHERE asset_id = ?",
        )
        .bind(asset_id)
        .bind(asset_id)
        .fetch_one(&pool)
        .await
        .expect("read active lifecycle");
        assert_eq!(active, ("active".into(), 1));

        let mut removed = input(2, "Image lifecycle");
        removed.updated_at = "2026-08-30T00:10:00.000Z".into();
        save_local_draft_transaction(&pool, &removed)
            .await
            .expect("save draft without image");
        let quarantined: (String, Option<String>, i64, i64) = sqlx::query_as(
            "SELECT lifecycle_status, quarantined_at, length(bytes),
                    (SELECT COUNT(*) FROM local_document_asset_references WHERE asset_id = ?)
             FROM local_asset_previews WHERE asset_id = ?",
        )
        .bind(asset_id)
        .bind(asset_id)
        .fetch_one(&pool)
        .await
        .expect("read quarantined lifecycle");
        assert_eq!(quarantined.0, "quarantined");
        assert_eq!(quarantined.1.as_deref(), Some("2026-08-30T00:10:00.000Z"));
        assert!(
            quarantined.2 > 0,
            "quarantine must preserve recoverable bytes"
        );
        assert_eq!(quarantined.3, 0);
    }

    #[tokio::test]
    async fn lists_bounded_quarantined_metadata_and_reactivates_only_after_checkpoint() {
        let pool = pool().await;
        let asset_id = "00000000-0000-4000-8000-000000000208";
        store_local_png_preview_transaction(&pool, &local_png_preview_input(asset_id))
            .await
            .expect("store pending preview");
        save_local_draft_transaction(&pool, &draft_with_image(1, asset_id))
            .await
            .expect("activate preview");
        let mut removed = input(2, "Image lifecycle");
        removed.updated_at = "2026-08-30T00:10:00.000Z".into();
        save_local_draft_transaction(&pool, &removed)
            .await
            .expect("quarantine preview");

        let summaries = list_quarantined_local_assets_transaction(&pool)
            .await
            .expect("list quarantine");
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].asset_id, asset_id);
        assert_eq!((summaries[0].width, summaries[0].height), (1, 1));
        assert_eq!(summaries[0].quarantined_at, "2026-08-30T00:10:00.000Z");

        let mut restored = draft_with_image(3, asset_id);
        restored.updated_at = "2026-08-30T00:15:00.000Z".into();
        save_local_draft_transaction(&pool, &restored)
            .await
            .expect("reactivate through canonical checkpoint");
        assert!(list_quarantined_local_assets_transaction(&pool)
            .await
            .expect("list after restore")
            .is_empty());
        let state: String = sqlx::query_scalar(
            "SELECT lifecycle_status FROM local_asset_previews WHERE asset_id = ?",
        )
        .bind(asset_id)
        .fetch_one(&pool)
        .await
        .expect("read reactivated lifecycle");
        assert_eq!(state, "active");
    }

    #[tokio::test]
    async fn stale_checkpoint_cannot_change_asset_reference_lifecycle() {
        let pool = pool().await;
        let asset_id = "00000000-0000-4000-8000-000000000205";
        store_local_png_preview_transaction(&pool, &local_png_preview_input(asset_id))
            .await
            .expect("store pending preview");
        save_local_draft_transaction(&pool, &draft_with_image(2, asset_id))
            .await
            .expect("save current draft");

        let stale = input(1, "Image lifecycle");
        assert_eq!(
            save_local_draft_transaction(&pool, &stale).await,
            Err(LocalDraftSaveError::StaleRevision)
        );
        let state: String = sqlx::query_scalar(
            "SELECT lifecycle_status FROM local_asset_previews WHERE asset_id = ?",
        )
        .bind(asset_id)
        .fetch_one(&pool)
        .await
        .expect("read lifecycle after rollback");
        assert_eq!(state, "active");
    }

    #[tokio::test]
    async fn aged_pending_preview_is_quarantined_without_deleting_legacy_or_bytes() {
        let pool = pool().await;
        let pending_id = "00000000-0000-4000-8000-000000000206";
        let legacy_id = "00000000-0000-4000-8000-000000000207";
        store_local_png_preview_transaction(&pool, &local_png_preview_input(pending_id))
            .await
            .expect("store pending preview");
        store_local_png_preview_transaction(&pool, &local_png_preview_input(legacy_id))
            .await
            .expect("store legacy fixture");
        sqlx::query(
            "UPDATE local_asset_previews SET lifecycle_status = 'legacy' WHERE asset_id = ?",
        )
        .bind(legacy_id)
        .execute(&pool)
        .await
        .expect("mark migration-era fixture");

        let mut checkpoint = input(1, "Sweep pending");
        checkpoint.updated_at = "2026-09-01T00:00:00.000Z".into();
        save_local_draft_transaction(&pool, &checkpoint)
            .await
            .expect("save checkpoint and reconcile pending previews");

        let states: Vec<(String, String, i64)> = sqlx::query_as(
            "SELECT asset_id, lifecycle_status, length(bytes)
             FROM local_asset_previews ORDER BY asset_id",
        )
        .fetch_all(&pool)
        .await
        .expect("read protected lifecycle states");
        assert_eq!(states[0].1, "quarantined");
        assert_eq!(states[1].1, "legacy");
        assert!(states.iter().all(|row| row.2 > 0));
    }

    #[test]
    fn asset_reference_extraction_ignores_image_shaped_metadata() {
        let real_id = "00000000-0000-4000-8000-000000000208";
        let metadata_id = "00000000-0000-4000-8000-000000000209";
        let content = serde_json::json!({
            "metadata": { "type": "image", "assetId": metadata_id },
            "content": [{ "type": "image", "assetId": real_id }]
        });
        assert_eq!(
            collect_local_asset_ids(&content.to_string()).expect("extract canonical references"),
            BTreeSet::from([real_id.to_string()])
        );
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
