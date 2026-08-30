PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS local_conversations (
    id TEXT PRIMARY KEY,
    schema_version INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    default_language TEXT NOT NULL DEFAULT 'und',
    canonical_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS local_conversation_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES local_conversations(id) ON DELETE CASCADE,
    message_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (conversation_id, id)
);

CREATE INDEX IF NOT EXISTS local_conversation_messages_conversation_idx
    ON local_conversation_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS local_conversation_edges (
    conversation_id TEXT NOT NULL REFERENCES local_conversations(id) ON DELETE CASCADE,
    parent_message_id TEXT NOT NULL,
    child_message_id TEXT NOT NULL,
    edge_kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, parent_message_id, child_message_id, edge_kind),
    FOREIGN KEY (conversation_id, parent_message_id)
        REFERENCES local_conversation_messages(conversation_id, id),
    FOREIGN KEY (conversation_id, child_message_id)
        REFERENCES local_conversation_messages(conversation_id, id),
    CHECK (parent_message_id <> child_message_id)
);

CREATE TABLE IF NOT EXISTS local_ai_handoffs (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES local_conversations(id) ON DELETE CASCADE,
    source_message_id TEXT NOT NULL,
    provider_connection_id TEXT NOT NULL,
    provider_type TEXT NOT NULL,
    model_id TEXT NOT NULL,
    selected_message_ids_json TEXT NOT NULL,
    selected_asset_ids_json TEXT NOT NULL,
    conversion_warnings_json TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    outbound_payload_hash TEXT NOT NULL,
    estimated_input_units INTEGER NOT NULL,
    consented_by TEXT NOT NULL,
    consented_at TEXT NOT NULL,
    provider_response_id TEXT,
    result_message_id TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    completed_at TEXT NOT NULL,
    FOREIGN KEY (conversation_id, source_message_id)
        REFERENCES local_conversation_messages(conversation_id, id),
    FOREIGN KEY (conversation_id, result_message_id)
        REFERENCES local_conversation_messages(conversation_id, id),
    CHECK (status = 'completed'),
    CHECK (length(payload_hash) = 64),
    CHECK (length(outbound_payload_hash) = 64),
    CHECK (estimated_input_units >= 0)
);

CREATE INDEX IF NOT EXISTS local_ai_handoffs_conversation_completed_idx
    ON local_ai_handoffs (conversation_id, completed_at DESC);
