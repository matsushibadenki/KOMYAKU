# Foundation Architecture

## Runtime layout

```text
apps/desktop      React + Vite + Tauri 2
apps/server       Bun + Hono API
packages/i18n     ja / en / zh-Hans resources
packages/shared   Cross-runtime policies and constants
packages/editor-core          ProseMirror canonical editor foundation
packages/conversation-schema Canonical conversation graph validation
packages/conversation-importer Generic JSON archive parser and provenance
packages/ai-gateway           Provider-independent handoff review boundary
packages/storage-core         S3-compatible immutable object boundary
packages/*-core   Domain boundaries for later stages
database          PostgreSQL migrations and seeds
```

The frontend and Hono routes must not own Version DAG business logic. Domain behavior belongs in packages and application services, while storage access belongs in repositories added in later stages.

## Local infrastructure

`compose.yaml` starts PostgreSQL and S3-compatible MinIO. Development credentials are examples only and must be replaced outside a local environment.

PostgreSQL uses Bun SQL with a bounded connection pool. Migration execution uses a dedicated single connection, an advisory lock, ordered immutable SQL files, and an applied-version table.

Tauri uses the official SQL plugin with SQLite. Migrations are registered in Rust and preloaded from `tauri.conf.json`; local draft, recovery snapshot, sync queue, sync state, and conversation import tables form the local-first base.

## Installed foundation libraries

```text
zod                         Runtime schema validation
uuid                        UUIDv7 generation
ProseMirror packages        Structured editor core
@aws-sdk/client-s3          S3-compatible object storage
@aws-sdk/s3-request-presigner Short-lived object access
@tauri-apps/plugin-sql      Frontend SQLite binding
tauri-plugin-sql            Rust SQLite plugin and migrations
```

Provider-specific AI SDKs are intentionally not foundation dependencies. AI providers connect through `@komyaku/ai-gateway` adapters so SDK upgrades do not enter the canonical conversation domain.

Conversation imports use a raw-first boundary: exact source bytes are archived under an ID-only S3 key before parsing. PostgreSQL then commits the asset metadata, canonical DAG, import report, and outbox event in one transaction. No unauthenticated import route is exposed by the foundation.

Identity is PostgreSQL-backed so one session can be used and revoked consistently across future API replicas. Personal account creation commits the user, personal workspace, owner membership, initial hashed session, and outbox event atomically. Password hashing uses Bun Argon2id; session tokens are random 256-bit credentials and only their SHA-256 hashes are persisted.

TanStack Start is intentionally not part of the current desktop foundation. Tauri remains a Vite SPA and Hono remains the single cloud API boundary. A separate TanStack Start web application may be evaluated after its v1 release when SSR or public web rendering is required; see ADR-017.

Authentication abuse protection is shared through PostgreSQL rather than process memory. Identifier keys are HMAC-SHA-256 protected, and advisory transaction locks serialize concurrent attempts across replicas. Email verification and password reset tokens are single-use 256-bit credentials stored only as hashes; reset completion revokes all sessions atomically.

## Privacy baseline

AI training use defaults to `deny`. Request logging omits URL paths because unlisted share tokens may appear in them. Document bodies must never enter ordinary application logs.
