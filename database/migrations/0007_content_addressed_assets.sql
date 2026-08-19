BEGIN;

ALTER TABLE assets
    ADD COLUMN storage_mode text NOT NULL DEFAULT 'immutable-keyed',
    ADD CONSTRAINT assets_storage_mode_check CHECK (
        storage_mode IN ('immutable-keyed', 'content-addressed')
    ),
    ADD CONSTRAINT assets_workspace_id_id_unique UNIQUE (workspace_id, id);

CREATE UNIQUE INDEX assets_workspace_content_hash_cas_unique_idx
    ON assets (workspace_id, content_hash)
    WHERE storage_mode = 'content-addressed' AND deleted_at IS NULL;

CREATE TABLE asset_references (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    referrer_type text NOT NULL,
    referrer_id uuid NOT NULL,
    relation text NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    released_at timestamptz,
    CONSTRAINT asset_references_asset_fk FOREIGN KEY (workspace_id, asset_id)
        REFERENCES assets(workspace_id, id),
    CONSTRAINT asset_references_referrer_type_check CHECK (
        referrer_type ~ '^[a-z][a-z0-9._-]{0,99}$'
    ),
    CONSTRAINT asset_references_relation_check CHECK (
        relation ~ '^[a-z][a-z0-9._-]{0,99}$'
    )
);

CREATE UNIQUE INDEX asset_references_active_unique_idx
    ON asset_references (workspace_id, asset_id, referrer_type, referrer_id, relation)
    WHERE released_at IS NULL;

CREATE INDEX asset_references_asset_active_idx
    ON asset_references (workspace_id, asset_id, created_at)
    WHERE released_at IS NULL;

CREATE INDEX asset_references_referrer_active_idx
    ON asset_references (workspace_id, referrer_type, referrer_id)
    WHERE released_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('0007_content_addressed_assets')
ON CONFLICT (version) DO NOTHING;

COMMIT;
