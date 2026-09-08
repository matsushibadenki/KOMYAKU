CREATE TABLE local_document_versions (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES local_documents(id) ON DELETE RESTRICT,
    schema_version INTEGER NOT NULL,
    snapshot_encoding TEXT NOT NULL CHECK (snapshot_encoding = 'canonical-json-v1'),
    snapshot_json TEXT NOT NULL,
    snapshot_hash TEXT NOT NULL,
    author_id TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('initial', 'named', 'restore', 'merge', 'import')),
    restored_from_version_id TEXT REFERENCES local_document_versions(id) ON DELETE RESTRICT,
    label TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (document_id, id)
);

CREATE INDEX local_document_versions_document_created_idx
    ON local_document_versions (document_id, created_at DESC, id);

CREATE TABLE local_document_version_parents (
    version_id TEXT NOT NULL REFERENCES local_document_versions(id) ON DELETE RESTRICT,
    parent_version_id TEXT NOT NULL REFERENCES local_document_versions(id) ON DELETE RESTRICT,
    parent_order INTEGER NOT NULL CHECK (parent_order IN (0, 1)),
    PRIMARY KEY (version_id, parent_order),
    UNIQUE (version_id, parent_version_id),
    CHECK (version_id <> parent_version_id)
);

CREATE INDEX local_document_version_parents_parent_idx
    ON local_document_version_parents (parent_version_id, version_id);

CREATE TABLE local_version_asset_references (
    version_id TEXT NOT NULL REFERENCES local_document_versions(id) ON DELETE RESTRICT,
    asset_id TEXT NOT NULL,
    PRIMARY KEY (version_id, asset_id)
);

CREATE INDEX local_version_asset_references_asset_idx
    ON local_version_asset_references (asset_id, version_id);

CREATE TABLE local_document_branches (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES local_documents(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    head_version_id TEXT NOT NULL REFERENCES local_document_versions(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (document_id, name)
);

CREATE INDEX local_document_branches_document_idx
    ON local_document_branches (document_id, updated_at DESC, id);

CREATE TABLE local_version_operations (
    operation_id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL,
    document_id TEXT NOT NULL,
    version_id TEXT NOT NULL REFERENCES local_document_versions(id) ON DELETE RESTRICT,
    branch_id TEXT NOT NULL REFERENCES local_document_branches(id) ON DELETE RESTRICT,
    created_at TEXT NOT NULL
);

CREATE INDEX local_version_operations_document_idx
    ON local_version_operations (document_id, created_at DESC, operation_id);
