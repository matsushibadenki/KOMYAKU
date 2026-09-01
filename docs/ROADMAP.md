# KOMYAKU Roadmap

## Stage 1 — Foundation

Stage status: [Done] Foundation complete

- [Done] Bun workspace and repository structure
- [Done] Bun 1.4.0 workspace pin and reproducible `oven/bun:1.4.0` Linux server build/runtime image
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

Stage status: [Done] Identity engineering complete; production launch gates remain below

- [Done] User, session, workspace, project, asset, and conversation database schema
- [Done] Identity repositories, personal workspace transaction, and password authentication
- [Done] Hashed session tokens, revocation service, and Bearer authentication middleware
- [Done] PostgreSQL distributed authentication rate limits and HMAC-protected identifiers
- [Done] Single-use email verification and password reset token domain flows
- [Done] SMTP notification adapter and feature-gated, rate-limited public authentication routes
- [Done] Encrypted transactional notification delivery, retry reconciliation, and reproducible local authentication endpoint load harness
- [Done] Isolated production-like PostgreSQL/SMTP load test, internal engineering review, and external-review package
- [Later] Workspace subscription and Usage Meter schema
- [Later] Passkey, OAuth, MFA, OIDC, SAML, and SCIM extension points
- [Later] Re-evaluate TanStack Start v1 for a separate Cloud Web app; keep Tauri Desktop on Vite SPA until validated

## Production Launch Gates

- [Done] XServer VPS Cloud small-start topology selected: one 4GB App VPS, 10GB Managed PostgreSQL with seven-day daily backup, external S3-compatible Asset storage, measured NFS/L4 adoption, and HTTPS-or-queue-only external Workers; see `docs/adr/ADR-074-xserver-vps-cloud-small-start.md`
- [Next] User environment required: repeat representative load and failure tests in the intended TLS/proxy, PostgreSQL, SMTP-provider, monitoring, and backup topology
- [Next] Independent reviewer required: external security review, remediation, and retest using `docs/security/stage2-external-review-package.md`

## Stage 3 — Structured Document MVP

- [Done] Canonical Document Schema v1 with stable Node IDs, schema versioning, metadata, and language/direction attributes
- [Done] First-class Text, Heading, List, Table, Image, Math/LaTeX, Code, Basic SVG/Mermaid, and Generic File nodes
- [Done] Separate canonical source, render representation, Asset references, and provenance; never make previews the source of truth
- [Done] Workspace-scoped content-addressed Asset storage foundation, immutable originals, safe deduplication, and reference accounting
- [Done] Bounded Asset orphan reconciliation and audited reference-zero quarantine/retention GC foundation
- [Done] Leased media inspection state machine, conservative signature policy, and authenticated short-lived attachment reads
- [Done] Inline preview isolation and published/archive/legal retention holds for the current decoder-inspected PNG and complete-input text safe profile
- [Later] Production malware scanner and quota metering before expanding uploads to broader binary formats or enabling commercial Cloud limits
- [Done] Deny-by-default static preview Descriptor and sandboxed iframe boundary, plus bounded script-free KaTeX-to-MathML rendering for untrusted LaTeX
- [Done] Bounded Basic SVG XML parser and new-document allowlist sanitizer excluding active content, foreign namespaces, events, styles, animation, and external resources
- [Done] Pinned Mermaid 11.17.2 parser and isolated Renderer Adapter contract with fixed secure configuration, authored-config/interaction/style rejection, budgets, and mandatory SVG re-sanitization
- [Done] Capability-minimized hidden Mermaid WebView with explicit Tauri application-command ACL, fail-closed runtime application-command and direct SQL canaries, event-only bounded transport, lazy renderer loading, timeout/backpressure, timeout-triggered WebView recreation, and mandatory SVG re-sanitization
- [Done] Mermaid Diagram NodeView integration retaining visible Canonical source, script-free static iframe output, localized fail-closed Web fallback, and responsive layout
- [Done] Isolated-profile packaged macOS Mermaid QA covering live static rendering, malformed and forbidden-source rejection, fail-closed application-command/SQL readiness canaries, full quit/relaunch recovery, and deterministic timeout → WebView recreation → post-recovery rendering
- [Done] Accepted-PNG static Descriptor foundation requiring inspected MIME, exact byte size, inspection-confirmed dimensions, 256 KiB encoded and 16 MP decoded budgets, data-only CSP, and an empty iframe sandbox
- [Done] Server-only decoder-backed PNG inspection with a 1 MiB complete-input budget, 16 MP libvips limit, full raw decode, persisted inspected dimensions, lease-safe completion, and opaque failure handling
- [Done] Authorized Cloud PNG preview-byte proxy and Desktop Resolver with Workspace membership, exact inspection policy, 256 KiB limit, immutable SHA-256 recheck, no-store binary response, no Object Storage URL exposure, and memory-only Session use
- [Done] Local SQLite accepted-PNG preview cache, byte length/SHA-256 revalidation, lazy Descriptor loading, and localized Image NodeView retaining visible Asset identity and alternative text on failure
- [Done] Decoder-verified local PNG insertion with capability-scoped native command, bounded full decode, atomic/idempotent SQLite cache write, required alternative text, and Canonical Image Node creation only after durable acceptance
- [Done] Centralized editor Workspace preview state selecting either the Local Resolver or a Cloud Resolver bound to one memory-only Session and Workspace, with no cross-authority fallback
- [Done] Isolated-profile packaged macOS Image QA covering decoder-verified native insertion, Yjs replication, explicit durable Canonical checkpoint, complete process quit, SQLite reopen, stable Image Node recovery, and restored static preview without Asset rewrite
- [Done] Atomic local document-to-Asset reference accounting with pending/active/quarantined/legacy lifecycle, 24-hour insertion grace, final-reference quarantine, stale-revision rollback, migration-era protection, and no destructive byte deletion
- [Done] Accessible Image Node metadata authoring with required alternative text, optional visible plain-text captions, stable-Node-ID ProseMirror transactions, Yjs replica synchronization, Canonical restart recovery, and rich-caption preservation
- [Done] Structured rich Image caption authoring for marked text, hard breaks, and stable-ID inline LaTeX, with bounded Canonical validation, reordering, Yjs synchronization, and exact restart recovery
- [Done] Authenticated Cloud PNG insertion with preallocated stable Node identity, exact-byte content-addressed upload, bounded asynchronous decoder inspection, accepted-only Canonical insertion, authorized static preview, and failed-staging reference release
- [Done] Authenticated Cloud immutable text-original insertion for TXT, Markdown, CSV, Mermaid, and JSON with stable File Node identity, 1 MiB complete-input inspection, multilingual display filenames, accepted-only Canonical insertion, and failed-staging reference release
- [Done] Revision-monotonic Cloud document-to-Asset checkpoint reconciliation with Document-bound upload references, deterministic digests, accepted-reference validation, transactional stale-reference release, idempotent replay, and multi-replica PostgreSQL locking
- [Done] Explicit local Asset quarantine management with a bounded metadata-only native list, localized responsive UI, required recovery alternative text, non-destructive reinsertion, and checkpoint-gated reactivation
- [Done] Packaged macOS Mermaid pressure/backpressure QA covering pre-IPC source rejection, permitted 200-edge rendering, exact eight-request reservation, ninth-request busy rejection, timeout-wide fail-closed cleanup, hidden WebView recreation, and post-pressure recovery
- [Next] Windows/Linux hosts required: WebView2/WebKitGTK packaged pressure passes and remaining platform-specific sensitive-command denial probes
- [Later] JPEG/WebP still-image policies, animated-image policy, and isolated PDF rasterization/viewing using the gates in `docs/architecture/isolated-content-previews.md`
- [Done] Structured editor feasibility view, validated Canonical local autosave, page/app restart recovery, and Japanese/English/Simplified Chinese UI
- [Done] Export-gated Asset retention safety with digest-bound verified export/archive evidence, evidence invalidation, publication/legal holds, fail-closed SQL claims, defense-in-depth purge capability, audited operator controls, and disabled automatic orphan deletion
- [Done] Automated open `.komyaku` v1 export with deterministic store-only ZIP, strict manifest, Canonical/Asset-set validation, immutable write, persisted reread, full CRC32/SHA-256 verification, automatic retention evidence, and localized Cloud workflow
- [Done] Authorized `.komyaku` export listing, 60-second forced download, transactional export/evidence invalidation, and fail-closed local Canonical recovery through the public Reader
- [Done] Atomic Cloud Archive Asset materialization with full reread verification, bounded media inspection, content-addressed Asset identity remapping, source/render references, transactional Document publication and audit, digest replay, and Document-ID conflict rejection
- [Done] Atomic Local SQLite Archive materialization with exact Asset-set verification, native SHA-256 and media reinspection, content-hash deduplication and ID remapping, transactional Document/Asset/reference publication, PNG preview adoption, lifecycle tracking, and digest replay
- [Done] Production Local Document Library workflow with bounded inventory, multi-document navigation, Canonical-aware rename, Archive/restore controls, source Archive digest inventory, and explicit import-conflict choices to open existing or create a fresh-identity copy
- [Later] Expand Generic File originals beyond inspected text after production malware scanning and format-specific parser/decoder policies
- [Done] Headless Yjs and `y-prosemirror` working-state foundation covering concurrent convergence, state-vector offline rejoin, stable Node IDs, deterministic Canonical checkpoints, bounded updates, and selective local undo
- [Done] Browser two-replica feasibility view with live Yjs synchronization, disconnect/reconnect lifecycle, Relative Position selection capture/restore path, composition-safe checkpoints, accessible labels, and responsive layouts
- [Done] Automated browser regression coverage for collaboration, composition lifecycle, restart recovery, and responsive layout
- [Done] Packaged Tauri Japanese IME composition, conversion, SQLite restart recovery, and exact Relative Position caret restoration pass on macOS
- [Done] Packaged Tauri Simplified Chinese Pinyin composition, candidate conversion, Yjs replication, SQLite autosave, full quit/relaunch recovery, and exact Relative Position caret restoration pass on macOS
- [Done] Canonical Schema migration boundary, ProseMirror adapters, and round-trip fixtures that preserve compatible metadata
- [Next] Reusable compact Math Palette with localized command registry, placeholder-aware LaTeX templates, selection wrapping, isolated preview, keyboard/focus accessibility, and Support App/Desktop Equation integration
- [Later] Local handwriting stroke canvas, reviewed LaTeX candidate flow, and provenance-preserving Equation insertion
- [Later] Benchmark UniMERNet Tiny/Small and alternative mathematical-expression-recognition models in an isolated normal-VPS Worker, then add explicit-consent Cloud recognition without direct Managed PostgreSQL access
- [Later] Academic submission export foundation with versioned destination profiles, deterministic LaTeX/BibTeX/Figure bundles, isolated reproducible PDF compilation, double-blind metadata checks, readiness reports, and user-controlled download without automatic final submission
- [Later] Verified destination-specific adapters for current official journal/conference requirements, followed by JATS XML, DOCX, MathML, camera-ready, and supplementary research packages
- [Later] Native table editing, full LaTeX documents, richer SVG authoring, and PDF inspection

## Stage 4 — Document Evolution and Diff

- [Later] Immutable Document Version DAG and object snapshots
- [Later] Node lineage derived from stable Node IDs, with optional content hashes and materialized Node revision projections
- [Later] Change-kind metadata: TEXT, MATH, DIAGRAM, IMAGE, TABLE, CODE, ASSET, and STRUCTURE
- [Later] Version Graph with icon/shape labels that do not rely on color alone
- [Later] Diff dispatcher with Text, Math source, Diagram, Image, Table, Code, and Binary Asset engines
- [Later] Grapheme-safe Text/LaTeX/Mermaid Diff and binary added/replaced/deleted/hash/size comparison
- [Later] Recovery snapshots, offline sync queue, and conflict branches
- [Done] Publish the open `.komyaku` Archive v1 specification, manifest schema, deterministic minimal fixture, security limits, and compatibility policy alongside its first writer/reader
- [Later] Extend `.komyaku` with immutable Version DAG, branches, merges, and corresponding conformance fixtures without breaking v1 readers
- [Later] Backup, open Archive export/import, and automated restore verification

## Collaborative Editing and Local-first Sync

- [Done] Define and test the explicit Yjs working-state to validated Canonical Document checkpoint boundary; keep immutable Version commits as a separate application-service operation
- [Done] Persist validated Canonical drafts locally with monotonic revisions, composition-safe autosave, fail-closed restoration, and browser restart tests
- [Done] Save the Tauri local document shell and validated Canonical draft through one Rust-side SQLite transaction with atomic stale-revision rejection
- [Later] Durable local working-state persistence and offline update queue with bounded recovery and compaction
- [Later] Authenticated Provider adapters with Workspace/Document authorization, state-vector differential sync, idempotent update persistence, quotas, and update-size/rate limits
- [Done] Origin-aware local UndoManager foundation that excludes remote, AI, import, migration, and system-normalization transactions by default
- [Later] Connect selective undo/redo to the editor UI with translated labels and accessibility announcements
- [Later] Relative Position cursors and selections plus durable comment anchors using stable Node IDs and quoted/context fallback
- [Later] Ephemeral privacy-minimized Awareness with TTL; exclude Presence from Versions, archives, backups, search, and analytics
- [Later] Multi-replica room routing, shared persistence, compaction workers, and collaboration load/failure tests without relying on sticky sessions for correctness
- [Later] Publish optional versioned session-recovery data only as a non-authoritative `.komyaku` extension; archives must remain readable without Yjs

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

## User-owned External Providers

- [Later] Provider-neutral ExternalProviderConnection model separating Local, KOMYAKU Cloud, and user-owned targets
- [Later] Google Drive “My Google Cloud Project” wizard using a user-owned Desktop OAuth Client, system browser, PKCE, loopback callback, and `drive.file`
- [Later] Platform secure token storage, revocation, reconnect, scope-loss handling, redacted diagnostics, and security review
- [Later] Optional KOMYAKU-managed Google OAuth connection after product, policy, verification, and operational review
- [Later] Additional connectors such as WebDAV, user-owned S3, Dropbox, and OneDrive based on demand; do not generalize unlike credential types into one input
- [Later] Individually reviewed GCP capabilities beyond Drive; Service Accounts, API keys, and organization-wide access require separate threat models

## Conversation Archive and AI Handoff

- [Done] Raw conversation archive metadata verification job
- [Done] Authenticated, idempotent Generic JSON conversation import and status API
- [Done] Bounded Conversation Import orphan-object reconciliation with canonical-key validation, database ownership comparison, non-destructive quarantine/recovery records, pagination, operator audit, and maintenance CLI
- [Done] Versioned ChatGPT mapping, Claude chat_messages, structured Gemini, and Gemini My Activity adapter foundation with maintained synthetic export fixtures
- [Done] Atomic Cloud persistence and authenticated API for multi-conversation provider export bundles
- [Done] On-device Provider export selection UI with localized preview, provider override, provenance summary, and explicit partial-import warning review
- [Done] Authenticated Workspace connection and explicit confirmation that submits the reviewed exact bytes to the Cloud import API
- [Done] Opt-in durable Tauri session storage through OS credential stores, startup revalidation, revocation handling, and a persisted threat model
- [Done] Local/BYOK AI provider gateway foundation with single-branch selection, dual review hashes, bounded OpenAI-compatible transport, and immutable continuation branches
- [Done] Desktop AI Handoff review UI with exact single-branch disclosure, dual hashes, explicit one-send consent, Local/BYOK connection setup, and OS-secured Provider credential registration
- [Done] Bounded OpenAI-compatible Provider model discovery with send-time credential resolution, duplicate removal, localized selection UI, and manual Model ID fallback
- [Done] On-device selected-branch sensitive-data detection with value-free findings, explicit outbound-copy masking, immutable archive preservation, and localized review UI
- [Done] Bounded OpenAI-compatible SSE streaming with incremental Desktop display, Abort cancellation, strict event validation, and complete-response-only branch creation
- [Done] Packaged Tauri transactional persistence of completed AI Handoff, assistant Message, `ai_continuation` Edge, and Canonical Conversation in one SQLite commit, with idempotent replay and save-only retry
- [Done] Privacy-bounded Local Conversation library with startup enumeration, metadata-only summaries, explicit one-conversation loading, and validated Canonical restoration
- [Done] Cloud PostgreSQL transactional persistence foundation for completed Handoff, assistant Message, continuation Edge, dual hashes, Conversation timestamp, and ID-only Outbox event, with in-transaction authorization and Branch validation
- [Done] Authenticated, 1 MiB-bounded, no-store, idempotent Cloud Handoff API with workspace-scoped replay lookup and stable authorization/conflict errors
- [Done] Real PostgreSQL Cloud Handoff integration coverage for migration 0011, atomic Message／Edge／Handoff／Outbox commit, UUID array encoding, and idempotent replay
- [Done] Workspace-scoped deterministic UUIDv5 import identity v1 across Generic JSON, ChatGPT, Claude, structured Gemini, and Gemini My Activity, with Parser 1.1.0 and cross-Workspace collision isolation
- [Done] Desktop opt-in Cloud synchronization using an exact-byte Workspace-scoped reparse, explicit metadata-only Cloud Provider Connection selection, Local-first persistence, and idempotent Cloud save-only retry
- [Done] File-backed SQLite close/reopen regression for completed AI Handoff recovery, with metadata and Canonical Branch verification
- [Next] Interactive OS access required: packaged-app quit/relaunch and native credential-store QA on macOS, Windows, and Linux; use `docs/testing/ai-handoff-restart-recovery.md`
- [Later] Managed AI credits and Workspace AI connections
