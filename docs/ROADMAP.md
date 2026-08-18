# KOMYAKU Roadmap

## Stage 1 — Foundation

Stage status: [Done] Foundation complete

- [Done] Bun workspace and repository structure
- [Done] React, Vite, and Tauri 2 shell
- [Done] Bun and Hono API shell
- [Done] Japanese, English, and Simplified Chinese i18n baseline
- [Done] PostgreSQL and S3-compatible local service configuration
- [Done] Default AI training refusal signals and privacy documentation
- [Done] Local-first Freemium, Plan, Quota, and Entitlement architecture
- [Done] Single-server Modular Monolith and horizontal-scaling architecture
- [Done] Conversation Archive and provider-independent AI Handoff architecture
- [Done] PostgreSQL Migration Runner with advisory locking and idempotent replay
- [Done] Tauri SQLite plugin and local-first schema foundation
- [Done] ProseMirror editor schema foundation
- [Done] Canonical Conversation schema and AI Handoff review package
- [Done] S3-compatible immutable storage client and local bucket initializer
- [Done] Raw conversation archive service and generic JSON importer
- [Done] Structured logging configuration and fail-fast production environment validation
- [Done] Provider-independent Plan catalog and Entitlement key package
- [Done] PostgreSQL Transactional Outbox dispatcher with leases and idempotent Job creation
- [Done] Durable Job Runner, attempt history, lease recovery, and conversation archive verification
- [Done] Mutation idempotency middleware and audited Dead Letter service boundary
- [Done] Controlled Operator CLI, dead-letter pagination, and audited retention policy

## Stage 2 — Identity

- [Done] User, session, workspace, project, asset, and conversation database schema
- [Done] Identity repositories, personal workspace transaction, and password authentication
- [Done] Hashed session tokens, revocation service, and Bearer authentication middleware
- [Done] PostgreSQL distributed authentication rate limits and HMAC-protected identifiers
- [Done] Single-use email verification and password reset token domain flows
- [Done] SMTP notification adapter and feature-gated, rate-limited public authentication routes
- [Next] Notification delivery reconciliation, endpoint load testing, and external security review
- [Later] Workspace subscription and Usage Meter schema
- [Later] Passkey, OAuth, MFA, OIDC, SAML, and SCIM extension points
- [Later] Re-evaluate TanStack Start v1 for a separate Cloud Web app; keep Tauri Desktop on Vite SPA until validated

## Stage 3 onward

- [Later] Canonical document schema and editor
- [Later] Immutable Version DAG and object snapshots
- [Later] Version Graph and Unicode-safe Diff
- [Later] Recovery snapshots, offline sync queue, and conflict branches
- [Later] Backup, export, and automated restore verification
- [Later] Free Cloud / Personal / Pro subscription flow
- [Later] Team seat billing, Enterprise contracts, and Long-term Archive
- [Later] Metered AI and Developer API billing
- [Later] Separate Worker process and durable queue adapter
- [Later] Horizontal API / Worker replicas behind a load balancer
- [Later] PostgreSQL HA, read replicas, and partitioning based on measured load
- [Done] Raw conversation archive metadata verification job
- [Done] Authenticated, idempotent Generic JSON conversation import and status API
- [Next] Orphan-object reconciliation scan and provider export fixtures
- [Next] ChatGPT / Claude / Gemini import adapters based on maintained export fixtures
- [Later] Local/BYOK AI provider gateway, handoff review, and continuation branches
- [Later] Managed AI credits and Workspace AI connections
