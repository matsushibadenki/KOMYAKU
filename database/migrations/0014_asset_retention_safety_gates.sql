BEGIN;

CREATE TABLE asset_preservation_evidence (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    evidence_type text NOT NULL CHECK (evidence_type IN ('verified_export', 'verified_archive')),
    artifact_id uuid NOT NULL,
    artifact_digest text NOT NULL CHECK (artifact_digest ~ '^[0-9a-f]{64}$'),
    verified_by text NOT NULL,
    verified_at timestamptz NOT NULL,
    invalidated_at timestamptz,
    CONSTRAINT asset_preservation_evidence_asset_fk FOREIGN KEY (workspace_id, asset_id)
        REFERENCES assets(workspace_id, id),
    CONSTRAINT asset_preservation_evidence_unique UNIQUE
        (workspace_id, asset_id, evidence_type, artifact_id)
);

CREATE INDEX asset_preservation_evidence_active_idx
    ON asset_preservation_evidence (workspace_id, asset_id)
    WHERE invalidated_at IS NULL;

CREATE TABLE asset_retention_holds (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    hold_type text NOT NULL CHECK (hold_type IN ('published_version', 'legal_hold')),
    scope_id uuid NOT NULL,
    reason text NOT NULL,
    placed_by text NOT NULL,
    placed_at timestamptz NOT NULL,
    released_by text,
    released_at timestamptz,
    CONSTRAINT asset_retention_holds_asset_fk FOREIGN KEY (workspace_id, asset_id)
        REFERENCES assets(workspace_id, id),
    CONSTRAINT asset_retention_holds_release_check CHECK (
        (released_at IS NULL AND released_by IS NULL) OR
        (released_at IS NOT NULL AND released_by IS NOT NULL)
    ),
    CONSTRAINT asset_retention_holds_unique UNIQUE
        (workspace_id, asset_id, hold_type, scope_id)
);

CREATE INDEX asset_retention_holds_active_idx
    ON asset_retention_holds (workspace_id, asset_id)
    WHERE released_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('0014_asset_retention_safety_gates')
ON CONFLICT (version) DO NOTHING;

COMMIT;
