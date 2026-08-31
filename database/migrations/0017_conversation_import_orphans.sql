BEGIN;

CREATE TABLE conversation_import_orphan_objects (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    storage_key text NOT NULL UNIQUE,
    byte_size bigint NOT NULL CHECK (byte_size >= 0),
    lifecycle_state text NOT NULL DEFAULT 'quarantined'
        CHECK (lifecycle_state IN ('quarantined', 'recovered')),
    first_seen_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL,
    recovered_at timestamptz
);

CREATE INDEX conversation_import_orphans_workspace_idx
    ON conversation_import_orphan_objects (workspace_id, lifecycle_state, last_seen_at DESC);

INSERT INTO schema_migrations (version) VALUES ('0017_conversation_import_orphans')
ON CONFLICT (version) DO NOTHING;

COMMIT;
