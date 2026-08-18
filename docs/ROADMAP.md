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

## Stage 3 — Structured Document MVP

- [Next] Canonical Document Schema v1 with stable Node IDs, schema versioning, metadata, and language/direction attributes
- [Next] First-class Text, Heading, List, Table, Image, Math/LaTeX, Code, Basic SVG/Mermaid, and Generic File nodes
- [Next] Separate canonical source, render representation, Asset references, and provenance; never make previews the source of truth
- [Next] Workspace-scoped content-addressed Asset storage, immutable originals, safe deduplication, and reference accounting
- [Next] Secure isolated renderers for Math/LaTeX, Mermaid/SVG, images, and PDF previews
- [Next] Structured editor, local autosave, Asset insertion, accessible captions/alt text, and Japanese/English/Simplified Chinese UI
- [Next] Canonical Schema migrations and round-trip fixtures that preserve unknown compatible metadata
- [Later] Native table editing, full LaTeX documents, richer SVG authoring, and PDF inspection

## Stage 4 — Document Evolution and Diff

- [Later] Immutable Document Version DAG and object snapshots
- [Later] Node lineage derived from stable Node IDs, with optional content hashes and materialized Node revision projections
- [Later] Change-kind metadata: TEXT, MATH, DIAGRAM, IMAGE, TABLE, CODE, ASSET, and STRUCTURE
- [Later] Version Graph with icon/shape labels that do not rely on color alone
- [Later] Diff dispatcher with Text, Math source, Diagram, Image, Table, Code, and Binary Asset engines
- [Later] Grapheme-safe Text/LaTeX/Mermaid Diff and binary added/replaced/deleted/hash/size comparison
- [Later] Recovery snapshots, offline sync queue, and conflict branches
- [Later] Publish the open `.komyaku` Archive specification, schemas, conformance fixtures, and compatibility policy alongside its first implementation
- [Later] Backup, open Archive export/import, and automated restore verification

## Stage 5 — Semantic and Visual Content History

- [Later] Editable Diagram canonical model with nodes, edges, labels, positions, styles, and SVG preview artifacts
- [Later] Math AST/MathML normalization and semantic Math Diff while preserving authored LaTeX
- [Later] Diagram node/edge Diff, SVG structural Diff, and image side-by-side/overlay comparison
- [Later] Original/preview relationships for layered illustrations and externally edited design assets
- [Later] Search and filtering by Node lineage, content type, Figure, Equation, and change kind

## Stage 6 — Specialized Design and Media

- [Later] Read-only preview and metadata adapters for selected CAD/3D formats without building a native CAD editor
- [Later] External-editor references and version provenance for DXF, DWG, STEP, GLTF, OBJ, PSD, and similar source files
- [Later] Audio, video, and specialized scientific-data nodes based on measured user demand

## Commercialization and Scale

- [Later] Free Cloud / Personal / Pro subscription flow
- [Later] Team seat billing, Enterprise contracts, and Long-term Archive
- [Later] Metered AI and Developer API billing
- [Later] Separate Worker process and durable queue adapter
- [Later] Horizontal API / Worker replicas behind a load balancer
- [Later] PostgreSQL HA, read replicas, and partitioning based on measured load

## Conversation Archive and AI Handoff

- [Done] Raw conversation archive metadata verification job
- [Done] Authenticated, idempotent Generic JSON conversation import and status API
- [Next] Orphan-object reconciliation scan and provider export fixtures
- [Next] ChatGPT / Claude / Gemini import adapters based on maintained export fixtures
- [Later] Local/BYOK AI provider gateway, handoff review, and continuation branches
- [Later] Managed AI credits and Workspace AI connections
