# ADR-031: Workspace-scoped Content-addressed Assets

- Status: Accepted
- Date: 2026-08-19

## Context

Structured Documents can reference large images, PDFs, previews, and files across many immutable Versions. Copying unchanged bytes for every Version wastes storage, but global hash deduplication can reveal that another tenant possesses particular content. Object Storage and PostgreSQL also cannot participate in one atomic transaction.

## Decision

- Deduplicate exact bytes only inside one Workspace using SHA-256 and a deterministic Workspace-prefixed key.
- Use an immutable conditional object write. On a precondition conflict, verify stored hash metadata and byte size before reuse.
- Enforce one active content-addressed Asset per Workspace and hash in PostgreSQL. Existing raw conversation archives remain `immutable-keyed` and are not rewritten by this migration.
- Authorize the actor and enforce byte limits before hashing or storage work that reveals state.
- Store logical ownership in `asset_references`, with an active uniqueness constraint and auditable `released_at` state.
- Claim the Asset and logical reference in one PostgreSQL transaction after object persistence.
- Never synchronously delete an object when a reference is released or the database claim fails. Reconciliation and retention garbage collection handle unreferenced data later.
- Treat media type, size, hash, key, and Workspace as integrity metadata. A conflicting database record fails closed.

## Consequences

Unchanged large content can be reused across Document Versions without cross-Workspace disclosure. Conditional Object Storage writes and database uniqueness remain correct when multiple API replicas race. Logical reference counts can support quota, retention, and publication checks without making a mutable counter the source of truth.

An object may be orphaned if Object Storage succeeds and PostgreSQL remains unavailable. A prefix reconciliation and quarantine job is required before production cleanup. Public upload/read routes still require membership authorization, content inspection, signed-delivery policy, rate limits, and quota enforcement.

## Rejected alternatives

- Global cross-tenant deduplication: creates privacy, authorization, encryption-boundary, and deletion risks.
- Client-supplied hashes without server verification: permits aliasing and integrity attacks.
- Reference counters without reference rows: lose lineage and are fragile under retries and crashes.
- Immediate deletion at reference count zero: races with new references and bypasses recovery, publication, archive, and legal-hold policy.
