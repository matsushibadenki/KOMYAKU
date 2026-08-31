ALTER TABLE local_asset_previews
    ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'legacy'
    CHECK (lifecycle_status IN ('legacy', 'pending', 'active', 'quarantined'));

ALTER TABLE local_asset_previews
    ADD COLUMN last_referenced_at TEXT;

ALTER TABLE local_asset_previews
    ADD COLUMN quarantined_at TEXT;

CREATE TABLE local_document_asset_references (
    document_id TEXT NOT NULL REFERENCES local_documents(id) ON DELETE CASCADE,
    asset_id TEXT NOT NULL REFERENCES local_asset_previews(asset_id) ON DELETE RESTRICT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (document_id, asset_id)
);

CREATE INDEX local_document_asset_references_asset_idx
    ON local_document_asset_references (asset_id, document_id);

CREATE INDEX local_asset_previews_lifecycle_idx
    ON local_asset_previews (lifecycle_status, updated_at, asset_id);

