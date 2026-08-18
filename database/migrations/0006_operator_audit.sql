BEGIN;

CREATE TABLE operator_audit_events (
    id uuid PRIMARY KEY,
    operator_id text NOT NULL,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reason text NOT NULL,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT operator_audit_events_operator_check CHECK (length(operator_id) BETWEEN 1 AND 200),
    CONSTRAINT operator_audit_events_reason_check CHECK (length(reason) BETWEEN 1 AND 1000),
    CONSTRAINT operator_audit_events_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX operator_audit_events_target_idx
    ON operator_audit_events (target_type, target_id, created_at DESC);

INSERT INTO schema_migrations (version)
VALUES ('0006_operator_audit')
ON CONFLICT (version) DO NOTHING;

COMMIT;
