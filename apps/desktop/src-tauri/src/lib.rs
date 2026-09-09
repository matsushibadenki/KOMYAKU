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

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalVersionInput {
    id: String,
    document_id: String,
    schema_version: i64,
    snapshot_encoding: String,
    snapshot_json: String,
    snapshot_hash: String,
    parent_ids: Vec<String>,
    author_id: String,
    reason: String,
    restored_from_version_id: Option<String>,
    label: Option<String>,
    created_at: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SaveLocalVersionInput {
    operation_id: String,
    version: LocalVersionInput,
    branch_id: String,
    branch_name: String,
    expected_head_version_id: Option<String>,
    restore_draft_revision: Option<i64>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct SaveLocalVersionResult {
    operation_id: String,
    document_id: String,
    version_id: String,
    branch_id: String,
    snapshot_hash: String,
    replayed: bool,
}

#[derive(Debug, Serialize, sqlx::FromRow, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LocalVersionSummary {
    id: String,
    snapshot_hash: String,
    author_id: String,
    reason: String,
    restored_from_version_id: Option<String>,
    label: Option<String>,
    created_at: String,
}

#[derive(Debug, Serialize, sqlx::FromRow, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LocalVersionBranchSummary {
    id: String,
    name: String,
    head_version_id: String,
    created_at: String,
    updated_at: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LocalVersionHistoryResult {
    document_id: String,
    current_branch_id: Option<String>,
    current_version_id: Option<String>,
    branches: Vec<LocalVersionBranchSummary>,
    versions: Vec<LocalVersionSummary>,
}

#[derive(Debug, Serialize, sqlx::FromRow, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LocalVersionSnapshotResult {
    document_id: String,
    version_id: String,
    schema_version: i64,
    snapshot_encoding: String,
    snapshot_json: String,
    snapshot_hash: String,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
struct LocalVersionAssetResult {
    id: String,
    media_type: String,
    content_hash: String,
    bytes: Vec<u8>,
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
             OR EXISTS (SELECT 1 FROM local_version_asset_references reference
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
               )
               AND NOT EXISTS (
                 SELECT 1 FROM local_version_asset_references WHERE asset_id = ?
               )",
        )
        .bind(&input.updated_at)
        .bind(&asset_id)
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
           )
           AND NOT EXISTS (
             SELECT 1 FROM local_version_asset_references
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

fn valid_lower_uuid(value: &str) -> bool {
    validate_provider_reference(value).is_ok()
        && !value.bytes().any(|byte| byte.is_ascii_uppercase())
}

async fn save_local_version_transaction(
    pool: &Pool<Sqlite>, input: &SaveLocalVersionInput,
) -> Result<SaveLocalVersionResult, &'static str> {
    let version = &input.version;
    let asset_ids = collect_local_asset_ids(&version.snapshot_json)
        .map_err(|_| "invalid_local_version")?;
    if !valid_lower_uuid(&input.operation_id) || !valid_lower_uuid(&version.id)
        || !valid_lower_uuid(&version.document_id) || !valid_lower_uuid(&version.author_id)
        || !valid_lower_uuid(&input.branch_id) || version.snapshot_encoding != "canonical-json-v1"
        || version.snapshot_json.len() > MAX_LOCAL_DRAFT_BYTES || version.snapshot_hash.len() != 64
        || version.snapshot_hash.bytes().any(|byte| !byte.is_ascii_hexdigit() || byte.is_ascii_uppercase())
        || version.parent_ids.len() > 2 || version.parent_ids.iter().any(|id| !valid_lower_uuid(id))
        || version.parent_ids.iter().collect::<BTreeSet<_>>().len() != version.parent_ids.len()
        || version.parent_ids.iter().any(|id| id == &version.id)
        || input.branch_name.trim().is_empty() || input.branch_name.len() > 200
        || version.label.as_ref().is_some_and(|label| label.len() > 1000)
        || version.created_at.is_empty() || version.created_at.len() > 64
    { return Err("invalid_local_version"); }
    let parent_count = version.parent_ids.len();
    let reason_valid = match version.reason.as_str() {
        "initial" => parent_count == 0 && version.restored_from_version_id.is_none()
            && input.restore_draft_revision.is_none(),
        "merge" => parent_count == 2 && version.restored_from_version_id.is_none()
            && input.restore_draft_revision.is_none(),
        "restore" => parent_count == 1 && version.restored_from_version_id.as_deref().is_some_and(valid_lower_uuid)
            && input.restore_draft_revision.is_some_and(|revision| revision > 0),
        "named" | "import" => parent_count == 1 && version.restored_from_version_id.is_none()
            && input.restore_draft_revision.is_none(),
        _ => false,
    };
    if !reason_valid { return Err("invalid_local_version"); }
    let snapshot: serde_json::Value = serde_json::from_str(&version.snapshot_json)
        .map_err(|_| "invalid_local_version")?;
    if snapshot.get("id").and_then(serde_json::Value::as_str) != Some(&version.document_id)
        || snapshot.get("schemaVersion").and_then(serde_json::Value::as_i64) != Some(version.schema_version)
    { return Err("invalid_local_version"); }
    let actual_hash: String = Sha256::digest(version.snapshot_json.as_bytes()).iter()
        .map(|byte| format!("{byte:02x}")).collect();
    if actual_hash != version.snapshot_hash { return Err("local_version_hash_mismatch"); }
    let request_bytes = serde_json::to_vec(input).map_err(|_| "invalid_local_version")?;
    let request_hash: String = Sha256::digest(request_bytes).iter()
        .map(|byte| format!("{byte:02x}")).collect();
    let mut transaction = pool.begin().await.map_err(|_| "local_version_storage_failure")?;
    let replay: Option<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT operation.request_hash, operation.document_id, operation.version_id,
                operation.branch_id, version.snapshot_hash
         FROM local_version_operations operation
         JOIN local_document_versions version ON version.id = operation.version_id
         WHERE operation.operation_id = ? LIMIT 1")
        .bind(&input.operation_id).fetch_optional(&mut *transaction).await
        .map_err(|_| "local_version_storage_failure")?;
    if let Some((stored_hash, document_id, version_id, branch_id, snapshot_hash)) = replay {
        if stored_hash != request_hash { return Err("local_version_idempotency_conflict"); }
        return Ok(SaveLocalVersionResult { operation_id: input.operation_id.clone(), document_id,
            version_id, branch_id, snapshot_hash, replayed: true });
    }
    let document_exists: Option<String> = sqlx::query_scalar(
        "SELECT id FROM local_documents WHERE id = ? LIMIT 1")
        .bind(&version.document_id).fetch_optional(&mut *transaction).await
        .map_err(|_| "local_version_storage_failure")?;
    if document_exists.is_none() { return Err("local_version_document_not_found"); }
    for parent_id in &version.parent_ids {
        let parent_document: Option<String> = sqlx::query_scalar(
            "SELECT document_id FROM local_document_versions WHERE id = ? LIMIT 1")
            .bind(parent_id).fetch_optional(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
        if parent_document.as_deref() != Some(version.document_id.as_str()) {
            return Err("local_version_parent_not_found");
        }
    }
    for asset_id in &asset_ids {
        let available: i64 = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM local_asset_previews WHERE asset_id = ?)
                  OR EXISTS(SELECT 1 FROM local_archive_assets WHERE asset_id = ?)")
            .bind(asset_id).bind(asset_id).fetch_one(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
        if available != 1 { return Err("local_version_asset_not_found"); }
    }
    if let Some(restored_id) = &version.restored_from_version_id {
        let restored_document: Option<String> = sqlx::query_scalar(
            "SELECT document_id FROM local_document_versions WHERE id = ? LIMIT 1")
            .bind(restored_id).fetch_optional(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
        if restored_document.as_deref() != Some(version.document_id.as_str()) {
            return Err("local_restored_version_not_found");
        }
    }
    let current_head: Option<String> = sqlx::query_scalar(
        "SELECT head_version_id FROM local_document_branches WHERE id = ? AND document_id = ? LIMIT 1")
        .bind(&input.branch_id).bind(&version.document_id)
        .fetch_optional(&mut *transaction).await.map_err(|_| "local_version_storage_failure")?;
    match (&current_head, &input.expected_head_version_id) {
        (Some(current), Some(expected)) if current == expected && version.parent_ids.contains(expected) => {}
        (None, None) if version.reason == "initial" => {}
        (None, Some(expected)) if version.parent_ids.contains(expected) => {}
        (Some(_), _) => return Err("stale_local_branch_head"),
        _ => return Err("invalid_local_branch_base"),
    }
    sqlx::query(
        "INSERT INTO local_document_versions
         (id, document_id, schema_version, snapshot_encoding, snapshot_json, snapshot_hash,
          author_id, reason, restored_from_version_id, label, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(&version.id).bind(&version.document_id).bind(version.schema_version)
        .bind(&version.snapshot_encoding).bind(&version.snapshot_json).bind(&version.snapshot_hash)
        .bind(&version.author_id).bind(&version.reason).bind(&version.restored_from_version_id)
        .bind(&version.label).bind(&version.created_at).execute(&mut *transaction).await
        .map_err(|_| "local_version_conflict")?;
    for (position, parent_id) in version.parent_ids.iter().enumerate() {
        sqlx::query("INSERT INTO local_document_version_parents (version_id, parent_version_id, parent_order) VALUES (?, ?, ?)")
            .bind(&version.id).bind(parent_id).bind(position as i64).execute(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
    }
    for asset_id in &asset_ids {
        sqlx::query("INSERT INTO local_version_asset_references (version_id, asset_id) VALUES (?, ?)")
            .bind(&version.id).bind(asset_id).execute(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
    }
    if current_head.is_some() {
        let updated = sqlx::query(
            "UPDATE local_document_branches SET head_version_id = ?, updated_at = ?
             WHERE id = ? AND document_id = ? AND head_version_id = ?")
            .bind(&version.id).bind(&version.created_at).bind(&input.branch_id)
            .bind(&version.document_id).bind(&input.expected_head_version_id)
            .execute(&mut *transaction).await.map_err(|_| "local_version_storage_failure")?;
        if updated.rows_affected() != 1 { return Err("stale_local_branch_head"); }
    } else {
        sqlx::query(
            "INSERT INTO local_document_branches (id, document_id, name, head_version_id, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&input.branch_id).bind(&version.document_id).bind(input.branch_name.trim())
            .bind(&version.id).bind(&version.created_at).bind(&version.created_at)
            .execute(&mut *transaction).await.map_err(|_| "local_branch_conflict")?;
    }
    sqlx::query("UPDATE local_documents SET current_branch_id = ?, current_version_id = ?, updated_at = ? WHERE id = ?")
        .bind(&input.branch_id).bind(&version.id).bind(&version.created_at).bind(&version.document_id)
        .execute(&mut *transaction).await.map_err(|_| "local_version_storage_failure")?;
    if let Some(restore_revision) = input.restore_draft_revision {
        let previous_asset_ids: Vec<String> = sqlx::query_scalar(
            "SELECT asset_id FROM local_document_asset_references WHERE document_id = ?")
            .bind(&version.document_id).fetch_all(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
        let restored = sqlx::query(
            "UPDATE local_drafts SET schema_version = ?, content_json = ?, local_revision = ?,
                    is_composing = 0, updated_at = ?
             WHERE document_id = ? AND local_revision = ?")
            .bind(version.schema_version).bind(&version.snapshot_json).bind(restore_revision)
            .bind(&version.created_at).bind(&version.document_id).bind(restore_revision - 1)
            .execute(&mut *transaction).await.map_err(|_| "local_version_storage_failure")?;
        if restored.rows_affected() != 1 { return Err("stale_local_draft_revision"); }
        let title = snapshot.pointer("/metadata/title").and_then(serde_json::Value::as_str).unwrap_or("");
        let language = snapshot.pointer("/attrs/language").and_then(serde_json::Value::as_str).unwrap_or("und");
        let direction = snapshot.pointer("/attrs/direction").and_then(serde_json::Value::as_str).unwrap_or("auto");
        let writing_mode = snapshot.pointer("/attrs/writingMode").and_then(serde_json::Value::as_str)
            .unwrap_or("horizontal-tb");
        sqlx::query(
            "UPDATE local_documents SET title = ?, default_language = ?, default_direction = ?,
                    default_writing_mode = ?, updated_at = ? WHERE id = ?")
            .bind(title).bind(language).bind(direction).bind(writing_mode)
            .bind(&version.created_at).bind(&version.document_id)
            .execute(&mut *transaction).await.map_err(|_| "local_version_storage_failure")?;
        sqlx::query("DELETE FROM local_document_asset_references WHERE document_id = ?")
            .bind(&version.document_id).execute(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
        for asset_id in &asset_ids {
            sqlx::query(
                "INSERT INTO local_document_asset_references (document_id, asset_id, updated_at)
                 SELECT ?, asset_id, ? FROM local_asset_previews WHERE asset_id = ?")
                .bind(&version.document_id).bind(&version.created_at).bind(asset_id)
                .execute(&mut *transaction).await.map_err(|_| "local_version_storage_failure")?;
            sqlx::query(
                "INSERT INTO local_archive_asset_references (document_id, asset_id, updated_at)
                 SELECT ?, asset_id, ? FROM local_archive_assets WHERE asset_id = ?
                 ON CONFLICT(document_id, asset_id) DO UPDATE SET updated_at = excluded.updated_at")
                .bind(&version.document_id).bind(&version.created_at).bind(asset_id)
                .execute(&mut *transaction).await.map_err(|_| "local_version_storage_failure")?;
        }
        let asset_ids_json = serde_json::to_string(&asset_ids).map_err(|_| "invalid_local_version")?;
        sqlx::query(
            "DELETE FROM local_archive_asset_references
             WHERE document_id = ? AND asset_id NOT IN (SELECT value FROM json_each(?))")
            .bind(&version.document_id).bind(asset_ids_json).execute(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
        sqlx::query(
            "UPDATE local_asset_previews SET lifecycle_status = 'active', last_referenced_at = ?,
                    quarantined_at = NULL
             WHERE asset_id IN (SELECT asset_id FROM local_document_asset_references WHERE document_id = ?)")
            .bind(&version.created_at).bind(&version.document_id).execute(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
        for asset_id in previous_asset_ids {
            sqlx::query(
                "UPDATE local_asset_previews SET lifecycle_status = 'quarantined', quarantined_at = ?
                 WHERE asset_id = ? AND lifecycle_status = 'active'
                   AND NOT EXISTS (SELECT 1 FROM local_document_asset_references WHERE asset_id = ?)
                   AND NOT EXISTS (SELECT 1 FROM local_version_asset_references WHERE asset_id = ?)")
                .bind(&version.created_at).bind(&asset_id).bind(&asset_id).bind(&asset_id)
                .execute(&mut *transaction).await.map_err(|_| "local_version_storage_failure")?;
        }
        sqlx::query(
            "UPDATE local_archive_assets SET lifecycle_status = CASE
               WHEN EXISTS (SELECT 1 FROM local_archive_asset_references reference
                            WHERE reference.asset_id = local_archive_assets.asset_id)
                 OR EXISTS (SELECT 1 FROM local_version_asset_references reference
                            WHERE reference.asset_id = local_archive_assets.asset_id)
               THEN 'active' ELSE 'quarantined' END, updated_at = ?")
            .bind(&version.created_at).execute(&mut *transaction).await
            .map_err(|_| "local_version_storage_failure")?;
    }
    let persisted_snapshot: (String, String) = sqlx::query_as(
        "SELECT snapshot_json, snapshot_hash FROM local_document_versions WHERE id = ? LIMIT 1")
        .bind(&version.id).fetch_one(&mut *transaction).await
        .map_err(|_| "local_version_storage_failure")?;
    let persisted_hash: String = Sha256::digest(persisted_snapshot.0.as_bytes()).iter()
        .map(|byte| format!("{byte:02x}")).collect();
    if persisted_snapshot.1 != version.snapshot_hash || persisted_hash != version.snapshot_hash {
        return Err("local_version_persisted_hash_mismatch");
    }
    sqlx::query(
        "INSERT INTO local_version_operations
         (operation_id, request_hash, document_id, version_id, branch_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)")
        .bind(&input.operation_id).bind(request_hash).bind(&version.document_id)
        .bind(&version.id).bind(&input.branch_id).bind(&version.created_at)
        .execute(&mut *transaction).await.map_err(|_| "local_version_storage_failure")?;
    transaction.commit().await.map_err(|_| "local_version_storage_failure")?;
    Ok(SaveLocalVersionResult { operation_id: input.operation_id.clone(),
        document_id: version.document_id.clone(), version_id: version.id.clone(),
        branch_id: input.branch_id.clone(), snapshot_hash: persisted_snapshot.1, replayed: false })
}

#[tauri::command]
async fn save_local_version_atomic(
    db_instances: State<'_, DbInstances>, input: SaveLocalVersionInput,
) -> Result<SaveLocalVersionResult, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) { Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("tauri_database_unavailable".into()) }
    };
    save_local_version_transaction(&pool, &input).await.map_err(str::to_string)
}

async fn list_local_version_history_transaction(
    pool: &Pool<Sqlite>, document_id: &str,
) -> Result<LocalVersionHistoryResult, &'static str> {
    if !valid_lower_uuid(document_id) { return Err("invalid_local_document_id"); }
    let current: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT current_branch_id, current_version_id FROM local_documents WHERE id = ? LIMIT 1")
        .bind(document_id).fetch_optional(pool).await
        .map_err(|_| "local_version_storage_failure")?;
    let Some((current_branch_id, current_version_id)) = current else {
        return Err("local_version_document_not_found");
    };
    let branches = sqlx::query_as::<_, LocalVersionBranchSummary>(
        "SELECT id, name, head_version_id, created_at, updated_at
         FROM local_document_branches WHERE document_id = ?
         ORDER BY updated_at DESC, id LIMIT 200")
        .bind(document_id).fetch_all(pool).await
        .map_err(|_| "local_version_storage_failure")?;
    let versions = sqlx::query_as::<_, LocalVersionSummary>(
        "SELECT id, snapshot_hash, author_id, reason, restored_from_version_id, label, created_at
         FROM local_document_versions WHERE document_id = ?
         ORDER BY created_at DESC, id DESC LIMIT 500")
        .bind(document_id).fetch_all(pool).await
        .map_err(|_| "local_version_storage_failure")?;
    Ok(LocalVersionHistoryResult {
        document_id: document_id.to_string(), current_branch_id, current_version_id,
        branches, versions,
    })
}

async fn load_local_version_snapshot_transaction(
    pool: &Pool<Sqlite>, document_id: &str, version_id: &str,
) -> Result<LocalVersionSnapshotResult, &'static str> {
    if !valid_lower_uuid(document_id) || !valid_lower_uuid(version_id) {
        return Err("invalid_local_version_reference");
    }
    let snapshot = sqlx::query_as::<_, LocalVersionSnapshotResult>(
        "SELECT document_id, id AS version_id, schema_version, snapshot_encoding,
                snapshot_json, snapshot_hash
         FROM local_document_versions WHERE document_id = ? AND id = ? LIMIT 1")
        .bind(document_id).bind(version_id).fetch_optional(pool).await
        .map_err(|_| "local_version_storage_failure")?
        .ok_or("local_version_not_found")?;
    let actual_hash: String = Sha256::digest(snapshot.snapshot_json.as_bytes()).iter()
        .map(|byte| format!("{byte:02x}")).collect();
    if snapshot.snapshot_encoding != "canonical-json-v1" || actual_hash != snapshot.snapshot_hash {
        return Err("local_version_persisted_hash_mismatch");
    }
    Ok(snapshot)
}

async fn load_local_version_assets_transaction(
    pool: &Pool<Sqlite>, document_id: &str, version_id: &str,
) -> Result<Vec<LocalVersionAssetResult>, &'static str> {
    if !valid_lower_uuid(document_id) || !valid_lower_uuid(version_id) {
        return Err("invalid_local_version_reference");
    }
    let belongs: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM local_document_versions WHERE document_id = ? AND id = ?)")
        .bind(document_id).bind(version_id).fetch_one(pool).await
        .map_err(|_| "local_version_storage_failure")?;
    if belongs != 1 { return Err("local_version_not_found"); }
    let asset_ids: Vec<String> = sqlx::query_scalar(
        "SELECT asset_id FROM local_version_asset_references WHERE version_id = ? ORDER BY asset_id LIMIT 5001")
        .bind(version_id).fetch_all(pool).await.map_err(|_| "local_version_storage_failure")?;
    if asset_ids.len() > 5000 { return Err("local_version_asset_limit"); }
    let mut results = Vec::with_capacity(asset_ids.len());
    let mut total_bytes = 0usize;
    for asset_id in asset_ids {
        let preview: Option<(Vec<u8>, String, String)> = sqlx::query_as(
            "SELECT bytes, detected_media_type, content_hash FROM local_asset_previews WHERE asset_id = ? LIMIT 1")
            .bind(&asset_id).fetch_optional(pool).await.map_err(|_| "local_version_storage_failure")?;
        let (bytes, media_type, content_hash) = match preview {
            Some(value) => value,
            None => sqlx::query_as(
                "SELECT bytes, media_type, content_hash FROM local_archive_assets WHERE asset_id = ? LIMIT 1")
                .bind(&asset_id).fetch_optional(pool).await
                .map_err(|_| "local_version_storage_failure")?
                .ok_or("local_version_asset_not_found")?,
        };
        total_bytes = total_bytes.checked_add(bytes.len()).ok_or("local_version_asset_limit")?;
        if total_bytes > 512 * 1024 * 1024 { return Err("local_version_asset_limit"); }
        let actual_hash: String = Sha256::digest(&bytes).iter()
            .map(|byte| format!("{byte:02x}")).collect();
        if actual_hash != content_hash { return Err("local_version_asset_integrity_mismatch"); }
        results.push(LocalVersionAssetResult { id: asset_id, media_type, content_hash, bytes });
    }
    Ok(results)
}

#[tauri::command]
async fn list_local_version_history(
    db_instances: State<'_, DbInstances>, document_id: String,
) -> Result<LocalVersionHistoryResult, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) { Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("tauri_database_unavailable".into()) }
    };
    list_local_version_history_transaction(&pool, &document_id).await.map_err(str::to_string)
}

#[tauri::command]
async fn load_local_version_snapshot(
    db_instances: State<'_, DbInstances>, document_id: String, version_id: String,
) -> Result<LocalVersionSnapshotResult, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) { Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("tauri_database_unavailable".into()) }
    };
    load_local_version_snapshot_transaction(&pool, &document_id, &version_id)
        .await.map_err(str::to_string)
}

#[tauri::command]
async fn load_local_version_assets(
    db_instances: State<'_, DbInstances>, document_id: String, version_id: String,
) -> Result<Vec<LocalVersionAssetResult>, String> {
    let pool = {
        let instances = db_instances.0.read().await;
        match instances.get(LOCAL_DATABASE_URL) { Some(DbPool::Sqlite(pool)) => pool.clone(),
            _ => return Err("tauri_database_unavailable".into()) }
    };
    load_local_version_assets_transaction(&pool, &document_id, &version_id)
        .await.map_err(str::to_string)
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
        Migration {
            version: 7,
            description: "create_local_document_versions",
            sql: include_str!("../migrations/0007_local_document_versions.sql"),
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
            save_local_version_atomic,
            list_local_version_history,
            load_local_version_snapshot,
            load_local_version_assets,
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

    #[tokio::test]
    #[ignore = "explicit 100k-character / 1000-Version / 20-Branch performance fixture"]
    async fn history_performance_fixture() {
        let path = std::env::temp_dir().join(format!("komyaku-perf-{}.db", SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        let url = format!("sqlite://{}?mode=rwc", path.display());
        let db = SqlitePoolOptions::new().max_connections(1).connect(&url).await.unwrap();
        migrate_test_pool(&db).await;
        let mut draft = input(1, "Performance fixture");
        let mut value: serde_json::Value = serde_json::from_str(&draft.content_json).unwrap();
        value["schemaId"] = serde_json::json!("https://komyaku.example/schemas/document/v1");
        value["type"] = serde_json::json!("document");
        value["extensions"] = serde_json::json!({});
        value["content"] = serde_json::json!([{
            "id": "00000000-0000-4000-8000-000000000002", "type": "paragraph", "schemaVersion": 1,
            "attrs": {"lang": "ja", "dir": "auto"}, "metadata": {}, "extensions": {}, "renderArtifacts": [],
            "content": [{"type": "text", "text": "a".repeat(100_000), "marks": [], "metadata": {}, "extensions": {}}]
        }]);
        draft.content_json = value.to_string();
        save_local_draft_transaction(&db, &draft).await.unwrap();
        let mut heads = vec![String::new(); 20];
        let mut timings = Vec::new();
        for index in 0..1000 {
            let branch = index % 20;
            let parent = if index == 0 { None } else if heads[branch].is_empty() {
                Some(heads[0].clone())
            } else { Some(heads[branch].clone()) };
            let id = format!("00000000-0000-4000-8000-{:012}", index + 1000);
            let mut request = local_version_input(
                &format!("00000000-0000-4000-8000-{:012}", index + 10000), &id,
                parent.clone().into_iter().collect(), parent, if index == 0 { "initial" } else { "named" });
            request.branch_id = format!("00000000-0000-4000-8000-{:012}", branch + 20000);
            request.branch_name = format!("Alternative {branch}");
            value["metadata"]["title"] = serde_json::json!(format!("Version {index}"));
            request.version.snapshot_json = value.to_string();
            request.version.snapshot_hash = Sha256::digest(request.version.snapshot_json.as_bytes()).iter()
                .map(|byte| format!("{byte:02x}")).collect();
            let started = std::time::Instant::now();
            save_local_version_transaction(&db, &request).await.unwrap();
            timings.push(started.elapsed().as_secs_f64() * 1000.0);
            heads[branch] = id;
        }
        let persisted_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_document_versions")
            .fetch_one(&db).await.unwrap();
        assert_eq!(persisted_count, 1000);
        timings.sort_by(f64::total_cmp);
        let mut reads = Vec::new();
        for _ in 0..20 {
            let started = std::time::Instant::now();
            let history = list_local_version_history_transaction(&db, &draft.document_id).await.unwrap();
            assert_eq!(history.versions.len(), 500);
            assert_eq!(history.branches.len(), 20);
            reads.push(started.elapsed().as_secs_f64() * 1000.0);
        }
        reads.sort_by(f64::total_cmp);
        db.close().await;
        let started = std::time::Instant::now();
        let reopened = SqlitePoolOptions::new().max_connections(1).connect(&url).await.unwrap();
        let history = list_local_version_history_transaction(&reopened, &draft.document_id).await.unwrap();
        assert_eq!(history.versions.len(), 500);
        let reopen_ms = started.elapsed().as_secs_f64() * 1000.0;
        for id in heads {
            let snapshot = load_local_version_snapshot_transaction(&reopened, &draft.document_id, &id).await.unwrap();
            let parsed: serde_json::Value = serde_json::from_str(&snapshot.snapshot_json).unwrap();
            assert_eq!(parsed["content"][0]["content"][0]["text"].as_str().unwrap().len(), 100_000);
        }
        reopened.close().await;
        println!("PERF_RESULT {}", serde_json::json!({"versions": 1000, "branches": 20, "graphemes": 100000,
            "listed_versions": 500, "save_p50_ms": timings[499], "save_p95_ms": timings[949], "list_p50_ms": reads[9],
            "list_p95_ms": reads[18], "reopen_and_list_ms": reopen_ms, "database_bytes": std::fs::metadata(&path).unwrap().len()}));
        std::fs::remove_file(path).unwrap();
    }

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
        migrate_test_pool(&pool).await;
        pool
    }

    async fn migrate_test_pool(pool: &Pool<Sqlite>) {
        sqlx::raw_sql(include_str!("../migrations/0001_local_foundation.sql"))
            .execute(pool)
            .await
            .expect("apply local schema");
        sqlx::raw_sql(include_str!("../migrations/0002_local_ai_handoffs.sql"))
            .execute(pool)
            .await
            .expect("apply local AI schema");
        sqlx::raw_sql(include_str!("../migrations/0003_local_asset_previews.sql"))
            .execute(pool)
            .await
            .expect("apply local asset preview schema");
        sqlx::raw_sql(include_str!(
            "../migrations/0004_local_asset_reference_lifecycle.sql"
        ))
        .execute(pool)
        .await
        .expect("apply local asset reference lifecycle schema");
        sqlx::raw_sql(include_str!("../migrations/0005_local_archive_materialization.sql"))
            .execute(pool)
            .await
            .expect("apply local Archive materialization schema");
        sqlx::raw_sql(include_str!("../migrations/0006_local_document_library.sql"))
            .execute(pool).await.expect("apply local Document library schema");
        sqlx::raw_sql(include_str!("../migrations/0007_local_document_versions.sql"))
            .execute(pool).await.expect("apply local Document Version schema");
    }

    fn local_version_input(
        operation_id: &str, version_id: &str, parent_ids: Vec<String>,
        expected_head_version_id: Option<String>, reason: &str,
    ) -> SaveLocalVersionInput {
        let draft = input(1, "Versioned");
        let snapshot_hash: String = Sha256::digest(draft.content_json.as_bytes()).iter()
            .map(|byte| format!("{byte:02x}")).collect();
        SaveLocalVersionInput {
            operation_id: operation_id.into(),
            version: LocalVersionInput {
                id: version_id.into(), document_id: draft.document_id,
                schema_version: 1, snapshot_encoding: "canonical-json-v1".into(),
                snapshot_json: draft.content_json, snapshot_hash, parent_ids,
                author_id: "00000000-0000-4000-8000-000000000090".into(),
                reason: reason.into(), restored_from_version_id: None,
                label: Some("保存した版".into()), created_at: "2026-09-08T00:00:00.000Z".into(),
            },
            branch_id: "00000000-0000-4000-8000-000000000091".into(),
            branch_name: "本文".into(), expected_head_version_id, restore_draft_revision: None,
        }
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
    async fn archive_write_failures_roll_back_every_stage_and_allow_exact_retry() {
        for table in ["local_drafts", "local_archive_asset_references", "local_archive_imports"] {
            let pool = pool().await;
            let original = input(1, "Keep existing document / 既存 / 保留");
            save_local_draft_transaction(&pool, &original).await.unwrap();
            let archive = local_archive_input(
                "00000000-0000-4000-8000-000000000088",
                "00000000-0000-4000-8000-000000000077",
            );
            // Fail progressively later writes, including the final replay receipt.
            sqlx::raw_sql(&format!(
                "CREATE TRIGGER fail_archive_write BEFORE INSERT ON {table}
                 BEGIN SELECT RAISE(ABORT, 'injected archive failure'); END;"
            )).execute(&pool).await.unwrap();
            assert_eq!(import_local_archive_transaction(&pool, &archive).await,
                Err("local_archive_storage_failure"), "failure at {table}");
            let state: (i64, i64, i64, i64, i64) = sqlx::query_as(
                "SELECT (SELECT COUNT(*) FROM local_documents),
                        (SELECT COUNT(*) FROM local_drafts),
                        (SELECT COUNT(*) FROM local_archive_assets),
                        (SELECT COUNT(*) FROM local_archive_asset_references),
                        (SELECT COUNT(*) FROM local_archive_imports)")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(state, (1, 1, 0, 0, 0), "rollback at {table}");
            let preserved: (String, i64) = sqlx::query_as(
                "SELECT content_json, local_revision FROM local_drafts WHERE document_id = ?")
                .bind(&original.document_id).fetch_one(&pool).await.unwrap();
            assert_eq!(preserved, (original.content_json.clone(), 1));

            sqlx::raw_sql("DROP TRIGGER fail_archive_write").execute(&pool).await.unwrap();
            let retried = import_local_archive_transaction(&pool, &archive).await.unwrap();
            assert!(!retried.replayed, "failed attempt must not leave a receipt");
            let stored: Vec<u8> = sqlx::query_scalar(
                "SELECT bytes FROM local_archive_assets WHERE asset_id = ?")
                .bind(&archive.assets[0].asset_id).fetch_one(&pool).await.unwrap();
            assert_eq!(stored, archive.assets[0].bytes);
            let replay = import_local_archive_transaction(&pool, &archive).await.unwrap();
            assert!(replay.replayed);
            assert_eq!(replay.content_json, retried.content_json);
            pool.close().await;
        }
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

        let continued = input(3, "Renamed");
        save_local_draft_transaction(&pool, &continued)
            .await
            .expect("continue editing from the revision returned by rename");
        let revision: i64 =
            sqlx::query_scalar("SELECT local_revision FROM local_drafts WHERE document_id = ?")
                .bind(&draft.document_id)
                .fetch_one(&pool)
                .await
                .expect("read continued revision");
        assert_eq!(revision, 3);
    }

    #[tokio::test]
    async fn saves_versions_parents_and_branch_head_atomically_with_idempotent_replay() {
        let pool = pool().await;
        save_local_draft_transaction(&pool, &input(1, "Versioned")).await.expect("save draft");
        let first_id = "00000000-0000-4000-8000-000000000092";
        let second_id = "00000000-0000-4000-8000-000000000093";
        let first = local_version_input(
            "00000000-0000-4000-8000-000000000094", first_id, vec![], None, "initial");
        let created = save_local_version_transaction(&pool, &first).await.expect("save initial Version");
        assert!(!created.replayed);
        let replayed = save_local_version_transaction(&pool, &first).await.expect("replay initial Version");
        assert!(replayed.replayed);

        let mut second = local_version_input(
            "00000000-0000-4000-8000-000000000095", second_id, vec![first_id.into()],
            Some(first_id.into()), "named");
        let changed = input(1, "Changed after initial Version");
        second.version.snapshot_json = changed.content_json;
        second.version.snapshot_hash = Sha256::digest(second.version.snapshot_json.as_bytes()).iter()
            .map(|byte| format!("{byte:02x}")).collect();
        save_local_version_transaction(&pool, &second).await.expect("advance Branch");
        let history = list_local_version_history_transaction(&pool, &second.version.document_id)
            .await.expect("list Version history");
        assert_eq!(history.current_branch_id.as_deref(), Some(second.branch_id.as_str()));
        assert_eq!(history.current_version_id.as_deref(), Some(second_id));
        assert_eq!(history.branches.len(), 1);
        assert_eq!(history.versions.len(), 2);
        assert_eq!(history.versions[0].id, second_id);
        let loaded = load_local_version_snapshot_transaction(
            &pool, &second.version.document_id, first_id,
        ).await.expect("load immutable Version snapshot");
        assert_eq!(loaded.version_id, first_id);
        assert_eq!(loaded.snapshot_hash, first.version.snapshot_hash);
        assert_eq!(loaded.snapshot_json, first.version.snapshot_json);
        let state: (String, String, i64, i64) = sqlx::query_as(
            "SELECT branch.head_version_id, document.current_version_id,
                    (SELECT COUNT(*) FROM local_document_versions),
                    (SELECT COUNT(*) FROM local_document_version_parents)
             FROM local_document_branches branch
             JOIN local_documents document ON document.id = branch.document_id LIMIT 1")
            .fetch_one(&pool).await.expect("read Version state");
        assert_eq!(state, (second_id.into(), second_id.into(), 2, 1));

        let stale = local_version_input(
            "00000000-0000-4000-8000-000000000096",
            "00000000-0000-4000-8000-000000000097", vec![first_id.into()],
            Some(first_id.into()), "named");
        assert_eq!(save_local_version_transaction(&pool, &stale).await, Err("stale_local_branch_head"));
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM local_document_versions")
            .fetch_one(&pool).await.expect("read Version count after stale update");
        assert_eq!(count, 2);

        let mut conflict = first;
        conflict.version.label = Some("異なる内容".into());
        assert_eq!(save_local_version_transaction(&pool, &conflict).await,
            Err("local_version_idempotency_conflict"));

        let restore_id = "00000000-0000-4000-8000-000000000098";
        let mut restore = local_version_input(
            "00000000-0000-4000-8000-000000000099", restore_id, vec![second_id.into()],
            Some(second_id.into()), "restore");
        restore.version.snapshot_json = conflict.version.snapshot_json.clone();
        restore.version.snapshot_hash = conflict.version.snapshot_hash.clone();
        restore.version.restored_from_version_id = Some(first_id.into());
        restore.restore_draft_revision = Some(2);
        save_local_version_transaction(&pool, &restore).await.expect("restore Version and draft");
        let restored: (String, i64, String) = sqlx::query_as(
            "SELECT draft.content_json, draft.local_revision, document.current_version_id
             FROM local_drafts draft JOIN local_documents document ON document.id = draft.document_id")
            .fetch_one(&pool).await.expect("read atomically restored draft");
        assert_eq!(restored, (conflict.version.snapshot_json, 2, restore_id.into()));
    }

    #[tokio::test]
    async fn failed_restore_preserves_draft_history_and_image_then_retries() {
        for failure in ["BEFORE UPDATE ON local_drafts", "BEFORE INSERT ON local_version_operations"] {
            let pool = pool().await;
            let original = input(1, "Versioned");
            save_local_draft_transaction(&pool, &original).await.unwrap();
            let first_id = "00000000-0000-4000-8000-000000000301";
            let first = local_version_input(
                "00000000-0000-4000-8000-000000000302", first_id, vec![], None, "initial");
            save_local_version_transaction(&pool, &first).await.unwrap();
            let asset_id = "00000000-0000-4000-8000-000000000303";
            let preview = local_png_preview_input(asset_id);
            store_local_png_preview_transaction(&pool, &preview).await.unwrap();
            let current = draft_with_image(2, asset_id);
            save_local_draft_transaction(&pool, &current).await.unwrap();
            let mut restore = local_version_input(
                "00000000-0000-4000-8000-000000000304",
                "00000000-0000-4000-8000-000000000305", vec![first_id.into()],
                Some(first_id.into()), "restore");
            restore.version.restored_from_version_id = Some(first_id.into());
            restore.restore_draft_revision = Some(3);
            sqlx::raw_sql(&format!("CREATE TRIGGER fail_restore {failure}
                BEGIN SELECT RAISE(ABORT, 'injected restore failure'); END;"))
                .execute(&pool).await.unwrap();
            assert_eq!(save_local_version_transaction(&pool, &restore).await,
                Err("local_version_storage_failure"));
            let draft: (String, i64) = sqlx::query_as(
                "SELECT content_json, local_revision FROM local_drafts")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(draft, (current.content_json.clone(), 2));
            let graph: (String, String, i64, i64, i64) = sqlx::query_as(
                "SELECT d.current_version_id, b.head_version_id,
                 (SELECT COUNT(*) FROM local_document_versions),
                 (SELECT COUNT(*) FROM local_document_version_parents),
                 (SELECT COUNT(*) FROM local_version_operations)
                 FROM local_documents d JOIN local_document_branches b ON b.id = d.current_branch_id")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(graph, (first_id.into(), first_id.into(), 1, 0, 1));
            let image: (String, Vec<u8>, i64) = sqlx::query_as(
                "SELECT lifecycle_status, bytes,
                 (SELECT COUNT(*) FROM local_document_asset_references) FROM local_asset_previews")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(image, ("active".into(), preview.bytes.clone(), 1));
            sqlx::raw_sql("DROP TRIGGER fail_restore").execute(&pool).await.unwrap();
            assert!(!save_local_version_transaction(&pool, &restore).await.unwrap().replayed);
            assert!(save_local_version_transaction(&pool, &restore).await.unwrap().replayed);
            let restored: (String, i64) = sqlx::query_as(
                "SELECT content_json, local_revision FROM local_drafts")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(restored, (first.version.snapshot_json, 3));
            let image: (String, Vec<u8>, i64) = sqlx::query_as(
                "SELECT lifecycle_status, bytes,
                 (SELECT COUNT(*) FROM local_document_asset_references) FROM local_asset_previews")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(image, ("quarantined".into(), preview.bytes, 0));
            pool.close().await;
        }
    }

    #[tokio::test]
    async fn immutable_version_reference_keeps_an_asset_after_the_draft_removes_it() {
        let pool = pool().await;
        let asset_id = "00000000-0000-4000-8000-000000000201";
        store_local_png_preview_transaction(&pool, &local_png_preview_input(asset_id))
            .await.expect("store Version Asset");
        let draft = draft_with_image(1, asset_id);
        save_local_draft_transaction(&pool, &draft).await.expect("save draft with Asset");
        let mut version = local_version_input(
            "00000000-0000-4000-8000-000000000202",
            "00000000-0000-4000-8000-000000000203", vec![], None, "initial");
        version.version.snapshot_json = draft.content_json.clone();
        version.version.snapshot_hash = Sha256::digest(draft.content_json.as_bytes()).iter()
            .map(|byte| format!("{byte:02x}")).collect();
        save_local_version_transaction(&pool, &version).await.expect("save Version Asset reference");
        let exported_assets = load_local_version_assets_transaction(
            &pool, &version.version.document_id, &version.version.id,
        ).await.expect("load hash-verified historical Asset");
        assert_eq!(exported_assets.len(), 1);
        assert_eq!(exported_assets[0].id, asset_id);
        assert_eq!(exported_assets[0].media_type, "image/png");

        let without_asset = input(2, "Image lifecycle");
        save_local_draft_transaction(&pool, &without_asset).await.expect("remove Asset from draft");
        let state: (String, i64, i64) = sqlx::query_as(
            "SELECT lifecycle_status,
                    (SELECT COUNT(*) FROM local_document_asset_references WHERE asset_id = ?),
                    (SELECT COUNT(*) FROM local_version_asset_references WHERE asset_id = ?)
             FROM local_asset_previews WHERE asset_id = ?")
            .bind(asset_id).bind(asset_id).bind(asset_id).fetch_one(&pool).await
            .expect("read retained Version Asset");
        assert_eq!(state, ("active".into(), 0, 1));
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
    async fn abandoned_png_preserves_exact_bytes_through_grace_restart_and_recovery() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!("komyaku-abandoned-asset-{}-{nonce}.db", std::process::id()));
        let url = format!("sqlite://{}?mode=rwc", path.display());
        let first = SqlitePoolOptions::new().max_connections(1).connect(&url).await.unwrap();
        migrate_test_pool(&first).await;
        let asset_id = "00000000-0000-4000-8000-000000000210";
        let png = local_png_preview_input(asset_id);
        store_local_png_preview_transaction(&first, &png).await.unwrap();
        // Upload succeeded, but no editor transaction ever referenced the PNG.
        let mut checkpoint = input(1, "Unrelated draft");
        checkpoint.updated_at = "2026-08-30T23:59:59.000Z".into();
        save_local_draft_transaction(&first, &checkpoint).await.unwrap();
        let state: (String, Vec<u8>) = sqlx::query_as(
            "SELECT lifecycle_status, bytes FROM local_asset_previews WHERE asset_id = ?"
        ).bind(asset_id).fetch_one(&first).await.unwrap();
        assert_eq!(state, ("pending".into(), png.bytes.clone()));
        checkpoint.local_revision = 2;
        checkpoint.updated_at = "2026-08-31T00:00:00.000Z".into();
        save_local_draft_transaction(&first, &checkpoint).await.unwrap();
        first.close().await;

        let reopened = SqlitePoolOptions::new().max_connections(1).connect(&url).await.unwrap();
        let state: (String, Vec<u8>, i64) = sqlx::query_as(
            "SELECT lifecycle_status, bytes, (SELECT COUNT(*) FROM local_document_asset_references WHERE asset_id = ?) FROM local_asset_previews WHERE asset_id = ?"
        ).bind(asset_id).bind(asset_id).fetch_one(&reopened).await.unwrap();
        assert_eq!(state, ("quarantined".into(), png.bytes.clone(), 0));
        let listed = list_quarantined_local_assets_transaction(&reopened).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].asset_id, asset_id);
        // Recover through the same durable checkpoint path used by reinsertion.
        let mut restored = draft_with_image(3, asset_id);
        restored.updated_at = "2026-08-31T00:01:00.000Z".into();
        save_local_draft_transaction(&reopened, &restored).await.unwrap();
        let state: (String, Vec<u8>, i64) = sqlx::query_as(
            "SELECT lifecycle_status, bytes, (SELECT COUNT(*) FROM local_document_asset_references WHERE asset_id = ?) FROM local_asset_previews WHERE asset_id = ?"
        ).bind(asset_id).bind(asset_id).fetch_one(&reopened).await.unwrap();
        assert_eq!(state, ("active".into(), png.bytes, 1));
        assert!(list_quarantined_local_assets_transaction(&reopened).await.unwrap().is_empty());
        reopened.close().await;
        std::fs::remove_file(path).unwrap();
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
    async fn renamed_document_edits_survive_file_database_reopen() {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let path = std::env::temp_dir().join(format!(
            "komyaku-document-restart-{}-{nonce}.db", std::process::id()
        ));
        let url = format!("sqlite://{}?mode=rwc", path.display());
        let first = SqlitePoolOptions::new().max_connections(1).connect(&url).await.unwrap();
        migrate_test_pool(&first).await;
        let original = input(1, "Original");
        save_local_draft_transaction(&first, &original).await.unwrap();
        let renamed = mutate_local_document_transaction(&first, &LocalDocumentMutationInput {
            document_id: original.document_id.clone(), title: Some("改題 / Renamed / 新标题".into()),
            archived: None, updated_at: "2026-09-09T00:00:00.000Z".into(),
        }).await.unwrap();
        assert_eq!(renamed.local_revision, 2);
        // A delayed pre-rename checkpoint must not undo the atomic rename.
        assert_eq!(save_local_draft_transaction(&first, &input(2, "Original")).await,
            Err(LocalDraftSaveError::StaleRevision));
        let mut edited = input(renamed.local_revision + 1, &renamed.title);
        let mut content: serde_json::Value = serde_json::from_str(&edited.content_json).unwrap();
        content["content"] = serde_json::json!([{
            "type": "paragraph", "content": [{ "type": "text", "text": "日本語 / 中文 / e\u{301} / 👩‍👩‍👧‍👦" }]
        }]);
        edited.content_json = content.to_string();
        save_local_draft_transaction(&first, &edited).await.unwrap();
        first.close().await;

        let reopened = SqlitePoolOptions::new().max_connections(1).connect(&url).await.unwrap();
        let saved: (String, String, i64) = sqlx::query_as(
            "SELECT d.title, r.content_json, r.local_revision FROM local_documents d JOIN local_drafts r ON r.document_id = d.id WHERE d.id = ?"
        ).bind(&edited.document_id).fetch_one(&reopened).await.unwrap();
        assert_eq!(saved, (edited.title.clone(), edited.content_json.clone(), 3));
        let mut after_restart = edited;
        after_restart.local_revision = 4;
        save_local_draft_transaction(&reopened, &after_restart).await.unwrap();
        reopened.close().await;
        std::fs::remove_file(path).unwrap();
    }

    #[tokio::test]
    async fn failed_draft_write_rolls_back_metadata_and_retries_same_revision() {
        let pool = pool().await;
        let original = input(1, "Before failure");
        save_local_draft_transaction(&pool, &original).await.unwrap();
        // Fail after the document metadata UPDATE, inside the same transaction.
        sqlx::raw_sql("CREATE TRIGGER fail_draft_write BEFORE UPDATE ON local_drafts BEGIN SELECT RAISE(ABORT, 'injected write failure'); END;")
            .execute(&pool).await.unwrap();
        let next = input(2, "After retry / 再試行 / 重试");
        assert_eq!(save_local_draft_transaction(&pool, &next).await,
            Err(LocalDraftSaveError::StorageFailure));
        let saved: (String, String, i64) = sqlx::query_as(
            "SELECT d.title, r.content_json, r.local_revision FROM local_documents d JOIN local_drafts r ON r.document_id = d.id"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(saved, (original.title, original.content_json, 1));
        sqlx::raw_sql("DROP TRIGGER fail_draft_write").execute(&pool).await.unwrap();
        save_local_draft_transaction(&pool, &next).await.expect("retry revision 2 without a gap");
        let saved: (String, String, i64) = sqlx::query_as(
            "SELECT d.title, r.content_json, r.local_revision FROM local_documents d JOIN local_drafts r ON r.document_id = d.id"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(saved, (next.title, next.content_json, 2));
    }

    #[tokio::test]
    async fn failed_rename_rolls_back_canonical_title_and_revision() {
        let pool = pool().await;
        let original = input(1, "Original title");
        save_local_draft_transaction(&pool, &original).await.unwrap();
        // Rename writes the Canonical draft first; fail its second table update.
        sqlx::raw_sql("CREATE TRIGGER fail_rename BEFORE UPDATE ON local_documents BEGIN SELECT RAISE(ABORT, 'injected rename failure'); END;")
            .execute(&pool).await.unwrap();
        let mutation = LocalDocumentMutationInput {
            document_id: original.document_id.clone(), title: Some("Renamed title".into()),
            archived: Some(true), updated_at: "2026-09-09T00:00:00.000Z".into(),
        };
        assert!(matches!(mutate_local_document_transaction(&pool, &mutation).await,
            Err("local_document_library_failure")));
        let saved: (String, String, i64, Option<String>) = sqlx::query_as(
            "SELECT d.title, r.content_json, r.local_revision, d.archived_at FROM local_documents d JOIN local_drafts r ON r.document_id = d.id"
        ).fetch_one(&pool).await.unwrap();
        assert_eq!(saved, (original.title, original.content_json, 1, None));
        sqlx::raw_sql("DROP TRIGGER fail_rename").execute(&pool).await.unwrap();
        let retried = mutate_local_document_transaction(&pool, &mutation).await.unwrap();
        assert_eq!(retried.title, "Renamed title");
        assert_eq!(retried.local_revision, 2);
        assert!(retried.archived_at.is_some());
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
