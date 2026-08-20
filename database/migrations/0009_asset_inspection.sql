BEGIN;

ALTER TABLE assets
    ADD COLUMN inspection_status text NOT NULL DEFAULT 'pending',
    ADD COLUMN detected_media_type text,
    ADD COLUMN inspection_policy_version text,
    ADD COLUMN inspection_attempts integer NOT NULL DEFAULT 0,
    ADD COLUMN inspection_available_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN inspection_lease_owner text,
    ADD COLUMN inspection_lease_expires_at timestamptz,
    ADD COLUMN inspected_at timestamptz,
    ADD CONSTRAINT assets_inspection_status_check CHECK (
        inspection_status IN ('pending', 'inspecting', 'accepted', 'rejected', 'error')
    ),
    ADD CONSTRAINT assets_inspection_attempts_check CHECK (inspection_attempts >= 0),
    ADD CONSTRAINT assets_inspection_lease_check CHECK (
        (inspection_status = 'inspecting' AND inspection_lease_owner IS NOT NULL AND inspection_lease_expires_at IS NOT NULL)
        OR (inspection_status <> 'inspecting' AND inspection_lease_owner IS NULL AND inspection_lease_expires_at IS NULL)
    ),
    ADD CONSTRAINT assets_inspection_result_check CHECK (
        (inspection_status IN ('accepted', 'rejected') AND inspected_at IS NOT NULL
            AND detected_media_type IS NOT NULL AND inspection_policy_version IS NOT NULL)
        OR inspection_status IN ('pending', 'inspecting', 'error')
    );

CREATE INDEX assets_inspection_claim_idx
    ON assets (inspection_available_at, id)
    WHERE storage_mode = 'content-addressed'
      AND lifecycle_state = 'active'
      AND inspection_status = 'pending';

CREATE INDEX assets_inspection_lease_recovery_idx
    ON assets (inspection_lease_expires_at, id)
    WHERE storage_mode = 'content-addressed'
      AND lifecycle_state = 'active'
      AND inspection_status = 'inspecting';

INSERT INTO schema_migrations (version)
VALUES ('0009_asset_inspection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
