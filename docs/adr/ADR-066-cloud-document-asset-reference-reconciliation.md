# ADR-066: Cloud Document Asset reference reconciliation

## Status

Accepted

## Context

Upload-time staging references protect immutable originals before a Canonical node is durable, but a client crash, deleted node, or interrupted cleanup can leave an active reference that no current document checkpoint needs. Releasing references one-by-one from UI events is not authoritative because collaboration, offline edits, replay, and process termination can reorder those events.

## Decision

Every new Cloud Asset upload carries both a stable Document ID and stable Node ID. The resulting `document_node/source` reference stores that Document ID. After a validated Canonical checkpoint is saved locally, the client submits a bounded list of `{nodeId, assetId}` pairs and a positive monotonic revision.

The server sorts the pairs and hashes their bounded JSON representation with SHA-256. In one PostgreSQL transaction it takes a Workspace/Document advisory transaction lock, authorizes a verified owner/admin/editor, locks the last checkpoint, rejects stale or conflicting revisions, validates every desired accepted Asset reference, soft-releases absent references, and stores the new revision, digest, count, actor, and time.

An identical revision and digest is an idempotent replay. Empty desired sets are valid. Physical Object Storage deletion is never part of this transaction. Cloud reconciliation failure is visible but does not invalidate or block the local-first checkpoint.

## Consequences

Multiple API replicas require no sticky sessions, and late clients cannot roll reference state backward. The server receives neither Asset bytes nor the entire Canonical document during reconciliation. Render-artifact reconciliation, archive/published holds, verified-export gates, and production purge activation remain later work.
