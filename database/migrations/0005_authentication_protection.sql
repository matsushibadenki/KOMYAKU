BEGIN;

CREATE TABLE authentication_rate_limits (
    scope text NOT NULL,
    key_hash bytea NOT NULL,
    window_started_at timestamptz NOT NULL,
    attempt_count integer NOT NULL,
    blocked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (scope, key_hash),
    CONSTRAINT authentication_rate_limits_attempt_count_check CHECK (attempt_count > 0)
);

CREATE INDEX authentication_rate_limits_cleanup_idx
    ON authentication_rate_limits (updated_at);

CREATE TABLE email_verification_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT email_verification_tokens_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX email_verification_tokens_user_active_idx
    ON email_verification_tokens (user_id, expires_at DESC)
    WHERE used_at IS NULL;

CREATE TABLE password_reset_tokens (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id),
    token_hash bytea NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    used_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT password_reset_tokens_expiry_check CHECK (expires_at > created_at)
);

CREATE INDEX password_reset_tokens_user_active_idx
    ON password_reset_tokens (user_id, expires_at DESC)
    WHERE used_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('0005_authentication_protection')
ON CONFLICT (version) DO NOTHING;

COMMIT;
