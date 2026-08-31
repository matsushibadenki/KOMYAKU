# ADR-062: Local Asset quarantine recovery

## Status

Accepted

## Context

ADR-060 preserves local PNG bytes after their final saved document reference disappears, but a database-only quarantine is not useful to an author who needs to recover an image. Recovery must not expose image bytes through a broad listing, silently alter a document, or mark an Asset active before the restored reference is durably saved.

## Decision

The main Tauri window receives one capability-scoped command that lists at most 100 accepted quarantined PNG records. The response contains only Asset ID, encoded byte size, inspected width and height, and quarantine timestamp. It never returns image bytes, hashes, document content, filesystem paths, or records in pending, active, or legacy states. Ordering is newest quarantine first with Asset ID as a deterministic tie-breaker.

The localized Desktop UI lets an author select one record and provide new required alternative text. Recovery inserts a Canonical Image Node referencing the existing immutable local Asset through the normal ProseMirror/Yjs path. It does not update SQLite lifecycle state directly. Only the next successful monotonic Canonical draft transaction creates the document-to-Asset reference and changes `quarantined` to `active`.

The UI removes a restored item optimistically from its current view, but reopening the list reads authoritative SQLite state. If the application exits before checkpointing, the Asset remains quarantined and recoverable. No delete or purge command is added.

## Consequences

Authors can recover accidentally removed local images without duplicating bytes or relying on internal database tools. A failed or interrupted recovery cannot prematurely remove quarantine protection. Permanent deletion remains blocked until immutable-original or verified export/archive retention gates, explicit policy, audit, and a recovery window are implemented.
