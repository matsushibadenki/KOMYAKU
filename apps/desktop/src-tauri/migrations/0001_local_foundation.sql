PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS local_documents (
    id TEXT PRIMARY KEY,
    workspace_id TEXT,
    project_id TEXT,
    content_kind TEXT NOT NULL DEFAULT 'structured_document',
    title TEXT NOT NULL DEFAULT '',
    default_language TEXT NOT NULL DEFAULT 'und',
    default_direction TEXT NOT NULL DEFAULT 'auto',
    default_writing_mode TEXT NOT NULL DEFAULT 'horizontal-tb',
    current_branch_id TEXT,
    current_version_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS local_drafts (
    document_id TEXT PRIMARY KEY REFERENCES local_documents(id) ON DELETE CASCADE,
    schema_version INTEGER NOT NULL,
    content_json TEXT NOT NULL,
    local_revision INTEGER NOT NULL DEFAULT 0,
    is_composing INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    CHECK (local_revision >= 0),
    CHECK (is_composing IN (0, 1))
);

CREATE TABLE IF NOT EXISTS local_snapshots (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES local_documents(id) ON DELETE CASCADE,
    snapshot_kind TEXT NOT NULL,
    schema_version INTEGER NOT NULL,
    content_json TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK (snapshot_kind IN ('recovery', 'named'))
);

CREATE INDEX IF NOT EXISTS local_snapshots_document_created_idx
    ON local_snapshots (document_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sync_queue (
    id TEXT PRIMARY KEY,
    operation_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    base_version_id TEXT,
    local_revision INTEGER,
    payload_reference TEXT NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    CHECK (attempt_count >= 0)
);

CREATE INDEX IF NOT EXISTS sync_queue_claim_idx
    ON sync_queue (status, available_at, created_at)
    WHERE status IN ('pending', 'processing');

CREATE TABLE IF NOT EXISTS sync_state (
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    remote_version_id TEXT,
    last_synced_revision INTEGER,
    last_synced_at TEXT,
    last_error_code TEXT,
    PRIMARY KEY (resource_type, resource_id)
);

CREATE TABLE IF NOT EXISTS local_conversation_imports (
    id TEXT PRIMARY KEY,
    raw_asset_path TEXT NOT NULL,
    source_provider TEXT NOT NULL,
    source_hash TEXT NOT NULL,
    parser_name TEXT,
    parser_version TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    warnings_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (status IN ('pending', 'complete', 'partial', 'failed'))
);

