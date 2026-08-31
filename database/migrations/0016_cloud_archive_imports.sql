BEGIN;

CREATE TABLE cloud_documents (
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    id uuid NOT NULL,
    schema_version integer NOT NULL,
    canonical_json jsonb NOT NULL,
    revision bigint NOT NULL CHECK (revision >= 1),
    imported_from_digest text CHECK (imported_from_digest IS NULL OR imported_from_digest ~ '^[0-9a-f]{64}$'),
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (workspace_id, id)
);

CREATE TABLE cloud_archive_imports (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    document_id uuid NOT NULL,
    archive_digest text NOT NULL CHECK (archive_digest ~ '^[0-9a-f]{64}$'),
    asset_count integer NOT NULL CHECK (asset_count >= 0),
    imported_by uuid NOT NULL REFERENCES users(id),
    imported_at timestamptz NOT NULL,
    CONSTRAINT cloud_archive_imports_document_fk FOREIGN KEY (workspace_id, document_id)
        REFERENCES cloud_documents(workspace_id, id),
    CONSTRAINT cloud_archive_imports_digest_unique UNIQUE (workspace_id, archive_digest)
);

INSERT INTO schema_migrations (version)
VALUES ('0016_cloud_archive_imports')
ON CONFLICT (version) DO NOTHING;

COMMIT;
