ALTER TABLE local_documents ADD COLUMN archived_at TEXT;

CREATE INDEX local_documents_library_idx
    ON local_documents (archived_at, updated_at DESC, id);
