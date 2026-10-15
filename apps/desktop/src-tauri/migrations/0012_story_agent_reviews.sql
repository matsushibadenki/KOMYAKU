CREATE TABLE IF NOT EXISTS story_agent_reviews (
    review_id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES story_workspace_states(workspace_id),
    proposal_json TEXT NOT NULL,
    candidate_json TEXT NOT NULL,
    candidate_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('review','attempting','adopted','rejected')),
    adoption_json TEXT,
    editor_revision INTEGER,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS story_agent_review_workspace ON story_agent_reviews(workspace_id,status,review_id);
CREATE TABLE IF NOT EXISTS story_agent_review_assets (
    review_id TEXT NOT NULL REFERENCES story_agent_reviews(review_id),
    asset_id TEXT NOT NULL,
    PRIMARY KEY(review_id,asset_id)
);
DROP VIEW IF EXISTS local_retained_asset_references;
CREATE VIEW local_retained_asset_references AS
    SELECT asset_id FROM local_document_asset_references
    UNION ALL SELECT asset_id FROM local_archive_asset_references
    UNION ALL SELECT asset_id FROM local_version_asset_references
    UNION ALL SELECT asset_id FROM story_workspace_assets
    UNION ALL SELECT asset_id FROM story_workspace_version_assets
    UNION ALL SELECT asset_id FROM story_agent_review_assets;
