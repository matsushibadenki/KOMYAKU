BEGIN;

ALTER TABLE asset_references ADD COLUMN document_id uuid;

CREATE INDEX asset_references_document_active_idx
    ON asset_references (workspace_id, document_id, referrer_id)
    WHERE released_at IS NULL AND document_id IS NOT NULL;

CREATE TABLE cloud_document_asset_checkpoints (
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    document_id uuid NOT NULL,
    revision bigint NOT NULL CHECK (revision >= 1),
    reference_digest text NOT NULL CHECK (reference_digest ~ '^[0-9a-f]{64}$'),
    asset_reference_count integer NOT NULL CHECK (asset_reference_count >= 0),
    checkpointed_by uuid NOT NULL REFERENCES users(id),
    checkpointed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, document_id)
);

INSERT INTO schema_migrations (version)
VALUES ('0013_cloud_document_asset_checkpoints')
ON CONFLICT (version) DO NOTHING;

COMMIT;
