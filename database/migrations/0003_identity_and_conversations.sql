BEGIN;

CREATE TABLE users (
    id uuid PRIMARY KEY,
    email text NOT NULL,
    password_hash text,
    display_name text NOT NULL DEFAULT '',
    interface_locale text NOT NULL DEFAULT 'ja',
    timezone text NOT NULL DEFAULT 'UTC',
    email_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE UNIQUE INDEX users_email_unique_active_idx
    ON users (lower(email))
    WHERE deleted_at IS NULL;

CREATE TABLE user_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE workspaces (
    id uuid PRIMARY KEY,
    name text NOT NULL,
    workspace_kind text NOT NULL DEFAULT 'personal',
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT workspaces_kind_check CHECK (workspace_kind IN ('personal', 'team', 'enterprise'))
);

CREATE TABLE workspace_members (
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    user_id uuid NOT NULL REFERENCES users(id),
    member_role text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    PRIMARY KEY (workspace_id, user_id),
    CONSTRAINT workspace_members_role_check CHECK (
        member_role IN ('owner', 'admin', 'editor', 'reviewer', 'viewer')
    )
);

CREATE TABLE projects (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    name text NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
);

CREATE INDEX projects_workspace_idx ON projects (workspace_id, updated_at DESC);

CREATE TABLE assets (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    media_type text NOT NULL,
    byte_size bigint NOT NULL,
    content_hash text NOT NULL,
    storage_key text NOT NULL UNIQUE,
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT assets_byte_size_check CHECK (byte_size >= 0),
    CONSTRAINT assets_content_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE conversations (
    id uuid PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    project_id uuid REFERENCES projects(id),
    title text NOT NULL DEFAULT '',
    default_language text NOT NULL DEFAULT 'und',
    visibility text NOT NULL DEFAULT 'private',
    ai_training_policy text NOT NULL DEFAULT 'deny',
    created_by uuid NOT NULL REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz,
    CONSTRAINT conversations_visibility_check CHECK (
        visibility IN ('private', 'restricted', 'unlisted', 'public')
    ),
    CONSTRAINT conversations_ai_training_policy_check CHECK (
        ai_training_policy IN ('deny', 'allow')
    )
);

CREATE INDEX conversations_workspace_updated_idx
    ON conversations (workspace_id, updated_at DESC)
    WHERE deleted_at IS NULL;

CREATE TABLE conversation_messages (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    source_provider text NOT NULL,
    source_message_id text,
    message_role text NOT NULL,
    author_label text,
    content_parts jsonb NOT NULL,
    model_metadata jsonb NOT NULL DEFAULT '{}',
    tool_metadata jsonb NOT NULL DEFAULT '{}',
    created_at_source timestamptz,
    edited_at_source timestamptz,
    content_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT conversation_messages_conversation_id_unique UNIQUE (conversation_id, id),
    CONSTRAINT conversation_messages_content_parts_check CHECK (
        jsonb_typeof(content_parts) = 'array'
    ),
    CONSTRAINT conversation_messages_content_hash_check CHECK (
        content_hash ~ '^[0-9a-f]{64}$'
    )
);

CREATE INDEX conversation_messages_conversation_created_idx
    ON conversation_messages (conversation_id, created_at);

CREATE UNIQUE INDEX conversation_messages_source_unique_idx
    ON conversation_messages (conversation_id, source_provider, source_message_id)
    WHERE source_message_id IS NOT NULL;

CREATE TABLE conversation_edges (
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    parent_message_id uuid NOT NULL,
    child_message_id uuid NOT NULL,
    edge_kind text NOT NULL DEFAULT 'reply',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, parent_message_id, child_message_id),
    CONSTRAINT conversation_edges_parent_fk FOREIGN KEY (conversation_id, parent_message_id)
        REFERENCES conversation_messages(conversation_id, id),
    CONSTRAINT conversation_edges_child_fk FOREIGN KEY (conversation_id, child_message_id)
        REFERENCES conversation_messages(conversation_id, id),
    CONSTRAINT conversation_edges_no_self_check CHECK (parent_message_id <> child_message_id)
);

CREATE INDEX conversation_edges_child_idx
    ON conversation_edges (conversation_id, child_message_id);

CREATE TABLE conversation_imports (
    id uuid PRIMARY KEY,
    conversation_id uuid REFERENCES conversations(id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id),
    source_provider text NOT NULL,
    source_format text NOT NULL,
    source_schema_version text,
    parser_name text,
    parser_version text,
    raw_asset_id uuid NOT NULL REFERENCES assets(id),
    source_hash text NOT NULL,
    import_status text NOT NULL DEFAULT 'pending',
    warnings jsonb NOT NULL DEFAULT '[]',
    imported_by uuid NOT NULL REFERENCES users(id),
    imported_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT conversation_imports_source_hash_check CHECK (source_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT conversation_imports_status_check CHECK (
        import_status IN ('pending', 'complete', 'partial', 'failed')
    ),
    CONSTRAINT conversation_imports_warnings_check CHECK (jsonb_typeof(warnings) = 'array')
);

CREATE TABLE ai_provider_connections (
    id uuid PRIMARY KEY,
    workspace_id uuid REFERENCES workspaces(id),
    user_id uuid REFERENCES users(id),
    provider_type text NOT NULL,
    display_name text NOT NULL,
    secret_reference text NOT NULL,
    endpoint_origin text,
    connection_status text NOT NULL DEFAULT 'active',
    capabilities_cache jsonb NOT NULL DEFAULT '{}',
    last_used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT ai_provider_connections_owner_check CHECK (
        (workspace_id IS NOT NULL AND user_id IS NULL)
        OR (workspace_id IS NULL AND user_id IS NOT NULL)
    ),
    CONSTRAINT ai_provider_connections_status_check CHECK (
        connection_status IN ('active', 'invalid', 'revoked')
    )
);

CREATE TABLE ai_handoffs (
    id uuid PRIMARY KEY,
    conversation_id uuid NOT NULL REFERENCES conversations(id),
    source_message_id uuid NOT NULL,
    provider_connection_id uuid NOT NULL REFERENCES ai_provider_connections(id),
    provider_type text NOT NULL,
    model_id text NOT NULL,
    selected_message_ids uuid[] NOT NULL,
    selected_asset_ids uuid[] NOT NULL DEFAULT '{}',
    conversion_warnings jsonb NOT NULL DEFAULT '[]',
    payload_hash text NOT NULL,
    estimated_input_units bigint NOT NULL,
    estimated_cost_minor bigint,
    currency char(3),
    consented_by uuid NOT NULL REFERENCES users(id),
    consented_at timestamptz NOT NULL,
    handoff_status text NOT NULL DEFAULT 'confirmed',
    provider_response_id text,
    result_root_message_id uuid,
    created_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz,
    CONSTRAINT ai_handoffs_payload_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT ai_handoffs_input_units_check CHECK (estimated_input_units >= 0),
    CONSTRAINT ai_handoffs_cost_check CHECK (estimated_cost_minor IS NULL OR estimated_cost_minor >= 0),
    CONSTRAINT ai_handoffs_messages_check CHECK (cardinality(selected_message_ids) > 0),
    CONSTRAINT ai_handoffs_source_message_fk FOREIGN KEY (conversation_id, source_message_id)
        REFERENCES conversation_messages(conversation_id, id),
    CONSTRAINT ai_handoffs_result_message_fk FOREIGN KEY (conversation_id, result_root_message_id)
        REFERENCES conversation_messages(conversation_id, id),
    CONSTRAINT ai_handoffs_status_check CHECK (
        handoff_status IN ('confirmed', 'sending', 'completed', 'failed', 'canceled')
    )
);

INSERT INTO schema_migrations (version)
VALUES ('0003_identity_and_conversations')
ON CONFLICT (version) DO NOTHING;

COMMIT;
