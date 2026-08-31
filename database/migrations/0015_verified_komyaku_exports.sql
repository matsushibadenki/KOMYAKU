BEGIN;

CREATE TABLE verified_document_exports (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    document_id uuid NOT NULL,
    archive_digest text NOT NULL CHECK (archive_digest ~ '^[0-9a-f]{64}$'),
    byte_size bigint NOT NULL CHECK (byte_size > 0),
    storage_key text NOT NULL UNIQUE,
    manifest jsonb NOT NULL,
    verified_by uuid NOT NULL REFERENCES users(id),
    verified_at timestamptz NOT NULL,
    invalidated_at timestamptz,
    CONSTRAINT verified_document_exports_identity UNIQUE (workspace_id, id)
);

CREATE INDEX verified_document_exports_document_idx
    ON verified_document_exports (workspace_id, document_id, verified_at DESC)
    WHERE invalidated_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('0015_verified_komyaku_exports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
