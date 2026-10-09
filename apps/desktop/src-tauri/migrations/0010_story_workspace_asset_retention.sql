-- Composite storage is provisioned before runtime IPC exposure.
-- Nullable metadata preserves unknown legacy history rather than inventing it.
CREATE TABLE IF NOT EXISTS story_workspace_states (
    workspace_id TEXT PRIMARY KEY,
    revision INTEGER NOT NULL CHECK(revision > 0), snapshot_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS story_workspace_receipts (
    operation_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL,
    request_json TEXT NOT NULL, revision INTEGER NOT NULL, snapshot_json TEXT NOT NULL,
    FOREIGN KEY(workspace_id) REFERENCES story_workspace_states(workspace_id)
);
CREATE TABLE IF NOT EXISTS story_workspace_assets (
    workspace_id TEXT NOT NULL REFERENCES story_workspace_states(workspace_id),
    asset_id TEXT NOT NULL, PRIMARY KEY(workspace_id,asset_id)
);
CREATE INDEX IF NOT EXISTS story_workspace_assets_asset_idx ON story_workspace_assets(asset_id);
CREATE TABLE IF NOT EXISTS story_workspace_versions (
            workspace_id TEXT NOT NULL REFERENCES story_workspace_states(workspace_id),
            version_id TEXT NOT NULL, snapshot_json TEXT NOT NULL, snapshot_hash TEXT NOT NULL,
            revision INTEGER NOT NULL, kind TEXT NOT NULL, restored_from_id TEXT,
            author_id TEXT, label TEXT, created_at TEXT,
            PRIMARY KEY(workspace_id,version_id));

CREATE TABLE IF NOT EXISTS story_workspace_version_parents (
            workspace_id TEXT NOT NULL, version_id TEXT NOT NULL, parent_id TEXT NOT NULL,
            ordinal INTEGER NOT NULL CHECK(ordinal IN (0,1)),
            PRIMARY KEY(workspace_id,version_id,ordinal),
            UNIQUE(workspace_id,version_id,parent_id),
            FOREIGN KEY(workspace_id,version_id) REFERENCES story_workspace_versions(workspace_id,version_id),
            FOREIGN KEY(workspace_id,parent_id) REFERENCES story_workspace_versions(workspace_id,version_id));

CREATE TABLE IF NOT EXISTS story_workspace_branches (
            workspace_id TEXT NOT NULL, branch_id TEXT NOT NULL, name TEXT NOT NULL, head_id TEXT NOT NULL,
            created_at TEXT, updated_at TEXT,
            PRIMARY KEY(workspace_id,branch_id), UNIQUE(workspace_id,name),
            FOREIGN KEY(workspace_id,head_id) REFERENCES story_workspace_versions(workspace_id,version_id));

CREATE TABLE IF NOT EXISTS story_workspace_selection (
            workspace_id TEXT PRIMARY KEY, branch_id TEXT NOT NULL, version_id TEXT NOT NULL,
            FOREIGN KEY(workspace_id,branch_id) REFERENCES story_workspace_branches(workspace_id,branch_id),
            FOREIGN KEY(workspace_id,version_id) REFERENCES story_workspace_versions(workspace_id,version_id));

CREATE TABLE IF NOT EXISTS story_workspace_version_assets (
            workspace_id TEXT NOT NULL, version_id TEXT NOT NULL, asset_id TEXT NOT NULL,
            PRIMARY KEY(workspace_id,version_id,asset_id),
            FOREIGN KEY(workspace_id,version_id) REFERENCES story_workspace_versions(workspace_id,version_id));

CREATE INDEX IF NOT EXISTS story_workspace_version_assets_asset_idx
            ON story_workspace_version_assets(asset_id);
-- All current and immutable references protect the same underlying Asset bytes.
CREATE VIEW IF NOT EXISTS local_retained_asset_references AS
    SELECT asset_id FROM local_document_asset_references
    UNION ALL SELECT asset_id FROM local_archive_asset_references
    UNION ALL SELECT asset_id FROM local_version_asset_references
    UNION ALL SELECT asset_id FROM story_workspace_assets
    UNION ALL SELECT asset_id FROM story_workspace_version_assets;
