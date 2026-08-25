BEGIN;

CREATE TABLE conversation_import_items (
    import_id uuid NOT NULL REFERENCES conversation_imports(id) ON DELETE CASCADE,
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    source_conversation_id text,
    ordinal integer NOT NULL CHECK (ordinal >= 0),
    PRIMARY KEY (import_id, conversation_id),
    UNIQUE (import_id, ordinal)
);

CREATE INDEX conversation_import_items_conversation_idx
    ON conversation_import_items (conversation_id);

INSERT INTO conversation_import_items (import_id, conversation_id, ordinal)
SELECT id, conversation_id, 0
FROM conversation_imports
WHERE conversation_id IS NOT NULL
ON CONFLICT DO NOTHING;

INSERT INTO schema_migrations (version)
VALUES ('0010_conversation_import_bundles')
ON CONFLICT (version) DO NOTHING;

COMMIT;
