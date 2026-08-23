import { parseCanonicalDocument } from "@komyaku/document-schema";

const LOCAL_DATABASE_URL = "sqlite:komyaku.db";
const BROWSER_DRAFT_PREFIX = "komyaku:local-draft:";
const MAX_LOCAL_DRAFT_BYTES = 12 * 1024 * 1024;
let databasePromise;

export class LocalDraftPersistenceError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = "LocalDraftPersistenceError";
    this.code = code;
  }
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function assertRevision(value) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new LocalDraftPersistenceError("invalid_local_revision");
  }
  return value;
}

function assertBoundedJson(value) {
  if (typeof value !== "string") throw new LocalDraftPersistenceError("invalid_local_draft_json");
  if (new TextEncoder().encode(value).byteLength > MAX_LOCAL_DRAFT_BYTES) {
    throw new LocalDraftPersistenceError("local_draft_too_large");
  }
  return value;
}

export function parseLocalDraftRecord(record, expectedDocumentId) {
  if (!record) return null;
  try {
    const contentJson = assertBoundedJson(record.contentJson ?? record.content_json);
    const content = parseCanonicalDocument(JSON.parse(contentJson));
    if (content.id !== expectedDocumentId) {
      throw new LocalDraftPersistenceError("local_draft_document_mismatch");
    }
    const schemaVersion = Number(record.schemaVersion ?? record.schema_version);
    if (schemaVersion !== content.schemaVersion) {
      throw new LocalDraftPersistenceError("local_draft_schema_mismatch");
    }
    return {
      documentId: expectedDocumentId,
      schemaVersion,
      content,
      contentJson,
      localRevision: assertRevision(Number(record.localRevision ?? record.local_revision)),
      updatedAt: String(record.updatedAt ?? record.updated_at ?? "")
    };
  } catch (error) {
    if (error instanceof LocalDraftPersistenceError) throw error;
    throw new LocalDraftPersistenceError("invalid_local_draft", undefined, { cause: error });
  }
}

export function createBrowserLocalDraftBackend(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.setItem !== "function") {
    throw new LocalDraftPersistenceError("local_storage_unavailable");
  }
  return {
    async load(documentId) {
      const value = storage.getItem(`${BROWSER_DRAFT_PREFIX}${documentId}`);
      if (value === null) return null;
      try {
        return JSON.parse(assertBoundedJson(value));
      } catch (error) {
        if (error instanceof LocalDraftPersistenceError) throw error;
        throw new LocalDraftPersistenceError("invalid_local_draft", undefined, { cause: error });
      }
    },
    async save(record) {
      const current = await this.load(record.documentId);
      if (current && Number(current.localRevision) >= record.localRevision) {
        throw new LocalDraftPersistenceError("stale_local_revision");
      }
      storage.setItem(`${BROWSER_DRAFT_PREFIX}${record.documentId}`, JSON.stringify(record));
    }
  };
}

async function loadLocalDatabase() {
  if (!isTauriRuntime()) throw new LocalDraftPersistenceError("tauri_database_unavailable");
  if (!databasePromise) {
    databasePromise = import("@tauri-apps/plugin-sql")
      .then(({ default: Database }) => Database.load(LOCAL_DATABASE_URL));
  }
  return databasePromise;
}

function createTauriLocalDraftBackend() {
  return {
    async load(documentId) {
      const database = await loadLocalDatabase();
      const rows = await database.select(
        `SELECT document_id, schema_version, content_json, local_revision, updated_at
         FROM local_drafts
         WHERE document_id = $1
         LIMIT 1`,
        [documentId]
      );
      return rows[0] ?? null;
    },
    async save(record) {
      const current = await this.load(record.documentId);
      if (current && Number(current.local_revision) >= record.localRevision) {
        throw new LocalDraftPersistenceError("stale_local_revision");
      }
      const database = await loadLocalDatabase();
      await database.execute(
        `INSERT INTO local_documents (
          id, title, default_language, default_direction, default_writing_mode, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $6)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          default_language = excluded.default_language,
          default_direction = excluded.default_direction,
          default_writing_mode = excluded.default_writing_mode,
          updated_at = excluded.updated_at`,
        [record.documentId, record.title, record.language, record.direction, record.writingMode, record.updatedAt]
      );
      const result = await database.execute(
        `INSERT INTO local_drafts (
          document_id, schema_version, content_json, local_revision, is_composing, updated_at
        ) VALUES ($1, $2, $3, $4, 0, $5)
        ON CONFLICT(document_id) DO UPDATE SET
          schema_version = excluded.schema_version,
          content_json = excluded.content_json,
          local_revision = excluded.local_revision,
          is_composing = 0,
          updated_at = excluded.updated_at
        WHERE excluded.local_revision > local_drafts.local_revision`,
        [record.documentId, record.schemaVersion, record.contentJson, record.localRevision, record.updatedAt]
      );
      if (result.rowsAffected !== 1) throw new LocalDraftPersistenceError("stale_local_revision");
    }
  };
}

function runtimeBackend() {
  if (isTauriRuntime()) return createTauriLocalDraftBackend();
  if (typeof window === "undefined") throw new LocalDraftPersistenceError("local_storage_unavailable");
  return createBrowserLocalDraftBackend(window.localStorage);
}

export async function loadLocalDraft(documentId, { backend = runtimeBackend() } = {}) {
  if (typeof documentId !== "string" || documentId.length === 0) {
    throw new LocalDraftPersistenceError("invalid_local_document_id");
  }
  return parseLocalDraftRecord(await backend.load(documentId), documentId);
}

export async function saveLocalDraft({
  documentId,
  schemaVersion,
  content,
  contentJson = JSON.stringify(content),
  localRevision,
  updatedAt = new Date().toISOString()
}, { backend = runtimeBackend() } = {}) {
  const canonical = parseCanonicalDocument(content);
  if (canonical.id !== documentId) throw new LocalDraftPersistenceError("local_draft_document_mismatch");
  if (canonical.schemaVersion !== schemaVersion) {
    throw new LocalDraftPersistenceError("local_draft_schema_mismatch");
  }
  let storedCanonical;
  try {
    storedCanonical = parseCanonicalDocument(JSON.parse(assertBoundedJson(contentJson)));
  } catch (error) {
    throw new LocalDraftPersistenceError("invalid_local_draft_json", undefined, { cause: error });
  }
  if (JSON.stringify(storedCanonical) !== JSON.stringify(canonical)) {
    throw new LocalDraftPersistenceError("local_draft_content_mismatch");
  }
  const record = {
    documentId,
    schemaVersion,
    contentJson,
    localRevision: assertRevision(localRevision),
    updatedAt,
    title: typeof canonical.metadata.title === "string" ? canonical.metadata.title : "",
    language: canonical.attrs.language,
    direction: canonical.attrs.direction,
    writingMode: canonical.attrs.writingMode
  };
  await backend.save(record);
  return parseLocalDraftRecord(record, documentId);
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
