DROP INDEX local_document_versions_document_created_idx;

CREATE INDEX local_document_versions_document_created_idx
    ON local_document_versions (document_id, created_at DESC, id DESC);
