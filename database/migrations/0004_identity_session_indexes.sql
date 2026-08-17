BEGIN;

CREATE INDEX user_sessions_user_active_idx
    ON user_sessions (user_id, expires_at DESC)
    WHERE revoked_at IS NULL;

CREATE INDEX workspace_members_user_active_idx
    ON workspace_members (user_id, workspace_id)
    WHERE revoked_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('0004_identity_session_indexes')
ON CONFLICT (version) DO NOTHING;

COMMIT;
