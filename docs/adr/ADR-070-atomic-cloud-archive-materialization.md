# ADR-070: Atomic Cloud Archive Materialization

## Status

Accepted — 2026-08-31

## Decision

Cloud `.komyaku` import verifies the complete Archive before application state changes. Every Asset is then fully inspected and written under its content-addressed immutable Object Storage key. A single PostgreSQL transaction claims or reuses the Asset rows, remaps Archive Asset UUIDs to Workspace Asset UUIDs, creates source and render references, inserts the Canonical Document, records the Archive digest, and appends an operator audit event.

The Workspace and Archive digest are protected by a transaction advisory lock. Repeating the same digest returns the already materialized Canonical Document. A different Archive whose Document UUID already exists is rejected; import never overwrites an existing Cloud Document.

## Failure boundary

No Cloud Document becomes visible until all relational writes commit. Object Storage writes may precede that transaction because it cannot participate in PostgreSQL commit. A later failure can therefore leave an unreferenced immutable object, but never a partial Document. Existing orphan reconciliation treats such bytes as quarantined candidates and automatic destructive deletion remains disabled.

## Media policy

Format validity does not imply application acceptance. The initial Cloud safe profile accepts decoder-verified PNG and complete-input inspected TXT, Markdown, CSV, Mermaid, and JSON up to 1 MiB per entry. PDF, SVG, office, CAD, audio, video, and other binary types remain rejected until isolated decoders or malware scanning policies exist.

## Consequences

This boundary is safe on a single initial server and on horizontally scaled API replicas because correctness lives in PostgreSQL locks, unique constraints, immutable keys, and transactions rather than process memory. Local SQLite Asset adoption remains a separate next milestone.
