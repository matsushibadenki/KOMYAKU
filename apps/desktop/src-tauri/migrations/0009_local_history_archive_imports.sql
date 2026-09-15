CREATE TABLE local_history_archive_imports (
    archive_digest TEXT PRIMARY KEY,
    document_id TEXT NOT NULL UNIQUE REFERENCES local_documents(id) ON DELETE RESTRICT,
    current_branch_id TEXT NOT NULL REFERENCES local_document_branches(id) ON DELETE RESTRICT,
    current_version_id TEXT NOT NULL REFERENCES local_document_versions(id) ON DELETE RESTRICT,
    version_count INTEGER NOT NULL,
    branch_count INTEGER NOT NULL,
    asset_count INTEGER NOT NULL,
    imported_at TEXT NOT NULL,
    CHECK (archive_digest NOT GLOB '*[^0-9a-f]*' AND length(archive_digest) = 64),
    CHECK (version_count BETWEEN 1 AND 5000),
    CHECK (branch_count BETWEEN 1 AND 200),
    CHECK (asset_count BETWEEN 0 AND 5000)
);

CREATE INDEX local_history_archive_imports_document_idx
    ON local_history_archive_imports (document_id, imported_at DESC);
