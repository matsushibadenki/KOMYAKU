BEGIN;

CREATE TABLE idempotency_keys (
    id uuid PRIMARY KEY,
    scope text NOT NULL,
    key_hash bytea NOT NULL,
    request_hash bytea NOT NULL,
    operation_status text NOT NULL,
    response_status integer,
    response_reference text,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    CONSTRAINT idempotency_keys_scope_key_unique UNIQUE (scope, key_hash),
    CONSTRAINT idempotency_keys_status_check CHECK (
        operation_status IN ('processing', 'completed', 'failed')
    )
);

CREATE TABLE outbox_events (
    id uuid PRIMARY KEY,
    aggregate_type text NOT NULL,
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL,
    schema_version integer NOT NULL,
    partition_key text NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    event_status text NOT NULL DEFAULT 'pending',
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text,
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz,
    CONSTRAINT outbox_events_idempotency_unique UNIQUE (idempotency_key),
    CONSTRAINT outbox_events_schema_version_check CHECK (schema_version > 0),
    CONSTRAINT outbox_events_attempt_count_check CHECK (attempt_count >= 0),
    CONSTRAINT outbox_events_status_check CHECK (
        event_status IN ('pending', 'processing', 'published', 'failed')
    )
);

CREATE INDEX outbox_events_dispatch_idx
    ON outbox_events (event_status, available_at)
    WHERE event_status IN ('pending', 'processing');

CREATE TABLE jobs (
    id uuid PRIMARY KEY,
    outbox_event_id uuid REFERENCES outbox_events(id),
    job_type text NOT NULL,
    schema_version integer NOT NULL,
    partition_key text NOT NULL,
    idempotency_key text NOT NULL,
    payload jsonb NOT NULL,
    job_status text NOT NULL DEFAULT 'queued',
    priority smallint NOT NULL DEFAULT 0,
    available_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text,
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 10,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    completed_at timestamptz,
    CONSTRAINT jobs_idempotency_unique UNIQUE (idempotency_key),
    CONSTRAINT jobs_schema_version_check CHECK (schema_version > 0),
    CONSTRAINT jobs_attempts_check CHECK (
        attempt_count >= 0 AND max_attempts > 0 AND attempt_count <= max_attempts
    ),
    CONSTRAINT jobs_status_check CHECK (
        job_status IN ('queued', 'processing', 'completed', 'failed', 'dead_letter')
    )
);

CREATE INDEX jobs_claim_idx
    ON jobs (priority DESC, available_at, created_at)
    WHERE job_status IN ('queued', 'processing');

CREATE TABLE job_attempts (
    job_id uuid NOT NULL REFERENCES jobs(id),
    attempt_number integer NOT NULL,
    worker_instance_id text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    outcome text,
    error_code text,
    PRIMARY KEY (job_id, attempt_number),
    CONSTRAINT job_attempts_number_check CHECK (attempt_number > 0),
    CONSTRAINT job_attempts_outcome_check CHECK (
        outcome IS NULL OR outcome IN ('completed', 'retry', 'failed')
    )
);

INSERT INTO schema_migrations (version)
VALUES ('0002_distributed_runtime')
ON CONFLICT (version) DO NOTHING;

COMMIT;
