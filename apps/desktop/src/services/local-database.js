import Database from "@tauri-apps/plugin-sql";

const LOCAL_DATABASE_URL = "sqlite:komyaku.db";
let databasePromise;

export function loadLocalDatabase() {
  databasePromise ??= Database.load(LOCAL_DATABASE_URL);
  return databasePromise;
}

export async function saveLocalDraft({
  documentId,
  schemaVersion,
  content,
  localRevision,
  isComposing = false
}) {
  const database = await loadLocalDatabase();
  const updatedAt = new Date().toISOString();

  await database.execute(
    `INSERT INTO local_drafts (
      document_id, schema_version, content_json, local_revision, is_composing, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT(document_id) DO UPDATE SET
      schema_version = excluded.schema_version,
      content_json = excluded.content_json,
      local_revision = excluded.local_revision,
      is_composing = excluded.is_composing,
      updated_at = excluded.updated_at`,
    [
      documentId,
      schemaVersion,
      JSON.stringify(content),
      localRevision,
      isComposing ? 1 : 0,
      updatedAt
    ]
  );
}

export async function enqueueSyncOperation(operation) {
  const database = await loadLocalDatabase();
  const now = new Date().toISOString();

  await database.execute(
    `INSERT INTO sync_queue (
      id, operation_type, resource_type, resource_id, base_version_id,
      local_revision, payload_reference, idempotency_key, status,
      available_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $9, $9)`,
    [
      operation.id,
      operation.operationType,
      operation.resourceType,
      operation.resourceId,
      operation.baseVersionId ?? null,
      operation.localRevision ?? null,
      operation.payloadReference,
      operation.idempotencyKey,
      now
    ]
  );
}
