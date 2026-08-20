BEGIN;

ALTER TABLE assets
    ADD COLUMN lifecycle_state text NOT NULL DEFAULT 'active',
    ADD COLUMN quarantined_at timestamptz,
    ADD COLUMN purge_after timestamptz,
    ADD COLUMN purge_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN last_purge_error_at timestamptz;

UPDATE assets
SET lifecycle_state = 'deleted'
WHERE deleted_at IS NOT NULL;

ALTER TABLE assets
    ADD CONSTRAINT assets_lifecycle_state_check CHECK (
        lifecycle_state IN ('active', 'quarantined', 'purging', 'deleted')
    ),
    ADD CONSTRAINT assets_purge_attempts_check CHECK (purge_attempts >= 0),
    ADD CONSTRAINT assets_quarantine_timestamps_check CHECK (
        (lifecycle_state = 'active' AND quarantined_at IS NULL AND purge_after IS NULL AND deleted_at IS NULL)
        OR (lifecycle_state IN ('quarantined', 'purging') AND quarantined_at IS NOT NULL AND purge_after IS NOT NULL AND deleted_at IS NULL)
        OR (lifecycle_state = 'deleted' AND deleted_at IS NOT NULL)
    );

CREATE INDEX assets_reference_zero_scan_idx
    ON assets (created_at, id)
    WHERE storage_mode = 'content-addressed' AND lifecycle_state = 'active';

CREATE INDEX assets_purge_due_idx
    ON assets (purge_after, id)
    WHERE storage_mode = 'content-addressed' AND lifecycle_state = 'quarantined';

CREATE TABLE asset_orphan_objects (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    storage_key text NOT NULL UNIQUE,
    content_hash text NOT NULL,
    byte_size bigint NOT NULL,
    lifecycle_state text NOT NULL DEFAULT 'quarantined',
    first_seen_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    purge_after timestamptz NOT NULL,
    purge_attempts integer NOT NULL DEFAULT 0,
    last_purge_error_at timestamptz,
    recovered_at timestamptz,
    purged_at timestamptz,
    CONSTRAINT asset_orphan_objects_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT asset_orphan_objects_size_check CHECK (byte_size >= 0),
    CONSTRAINT asset_orphan_objects_state_check CHECK (
        lifecycle_state IN ('quarantined', 'purging', 'recovered', 'purged')
    ),
    CONSTRAINT asset_orphan_objects_attempts_check CHECK (purge_attempts >= 0)
);

CREATE INDEX asset_orphan_objects_due_idx
    ON asset_orphan_objects (purge_after, id)
    WHERE lifecycle_state = 'quarantined';

INSERT INTO schema_migrations (version)
VALUES ('0008_asset_lifecycle')
ON CONFLICT (version) DO NOTHING;

COMMIT;
