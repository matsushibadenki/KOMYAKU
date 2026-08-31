BEGIN;

ALTER TABLE assets
    ADD COLUMN inspected_width integer,
    ADD COLUMN inspected_height integer,
    ADD CONSTRAINT assets_inspected_dimensions_check CHECK (
        (inspected_width IS NULL AND inspected_height IS NULL)
        OR (inspected_width > 0 AND inspected_height > 0)
    );

INSERT INTO schema_migrations (version)
VALUES ('0012_asset_inspected_dimensions')
ON CONFLICT (version) DO NOTHING;

COMMIT;
