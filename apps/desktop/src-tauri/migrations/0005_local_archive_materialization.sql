CREATE TABLE local_archive_assets (
    asset_id TEXT PRIMARY KEY,
    bytes BLOB NOT NULL,
    byte_size INTEGER NOT NULL,
    content_hash TEXT NOT NULL UNIQUE,
    media_type TEXT NOT NULL,
    inspection_policy_version TEXT NOT NULL,
    inspected_width INTEGER,
    inspected_height INTEGER,
    lifecycle_status TEXT NOT NULL DEFAULT 'active'
        CHECK (lifecycle_status IN ('active', 'quarantined')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (length(asset_id) = 36),
    CHECK (byte_size BETWEEN 1 AND 1048576),
    CHECK (length(bytes) = byte_size),
    CHECK (content_hash NOT GLOB '*[^0-9a-f]*' AND length(content_hash) = 64),
    CHECK (media_type IN ('image/png', 'text/plain', 'text/markdown', 'text/csv', 'text/vnd.mermaid', 'application/json')),
    CHECK (
        (media_type = 'image/png' AND inspection_policy_version = 'decoder-backed-png-v1'
            AND inspected_width > 0 AND inspected_height > 0)
        OR
        (media_type <> 'image/png' AND inspection_policy_version = 'baseline-signature-v1'
            AND inspected_width IS NULL AND inspected_height IS NULL)
    )
);

CREATE TABLE local_archive_imports (
    archive_digest TEXT NOT NULL,
    document_id TEXT PRIMARY KEY REFERENCES local_documents(id) ON DELETE RESTRICT,
    asset_count INTEGER NOT NULL,
    imported_at TEXT NOT NULL,
    CHECK (archive_digest NOT GLOB '*[^0-9a-f]*' AND length(archive_digest) = 64),
    CHECK (asset_count >= 0)
);

CREATE UNIQUE INDEX local_archive_imports_digest_document_idx
    ON local_archive_imports (archive_digest, document_id);

CREATE TABLE local_archive_asset_references (
    document_id TEXT NOT NULL REFERENCES local_documents(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES local_archive_assets(asset_id) ON DELETE RESTRICT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (document_id, asset_id)
);

CREATE INDEX local_archive_assets_lifecycle_idx
    ON local_archive_assets (lifecycle_status, updated_at, asset_id);

CREATE INDEX local_archive_asset_references_asset_idx
    ON local_archive_asset_references (asset_id, document_id);
