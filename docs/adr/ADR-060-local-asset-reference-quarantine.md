# ADR-060: Local Asset reference accounting and non-destructive quarantine

## Status

Accepted

## Context

Decoder-verified local PNG insertion can leave an unreferenced cache row if the native commit succeeds but Canonical insertion or checkpointing does not. Images removed from all documents also become orphans. However, the current bounded PNG record is both the local preview representation and the only retained image bytes; deleting it automatically would make undo, recovery, or export incomplete and conflict with KOMYAKU's principle that user writing must not be held hostage.

## Decision

SQLite migration `0004_local_asset_reference_lifecycle.sql` adds a document-to-Asset reference table and four lifecycle states:

- `pending`: decoder-verified bytes committed before a Canonical checkpoint references them;
- `active`: at least one saved local document references the Asset;
- `quarantined`: no saved document currently references the Asset, but its bytes remain recoverable;
- `legacy`: data created before reference accounting and protected from automatic lifecycle inference.

The native local-draft transaction parses only the Canonical document's nested `content` arrays and collects lowercase UUID-shaped `image.assetId` values. Image-shaped objects in metadata or extensions do not count. In the same SQLite transaction as the monotonic draft save it:

1. reads and replaces that document's reference set;
2. inserts references only for local preview rows that actually exist;
3. activates referenced rows and clears quarantine metadata;
4. quarantines a formerly active row only after its final document reference disappears;
5. quarantines unreferenced `pending` rows only after a 24-hour insertion grace period.

A stale local revision rolls back the draft and all reference lifecycle changes together. No lifecycle state deletes bytes. `legacy` rows are never swept by the pending reconciliation query.

## Consequences

KOMYAKU can now distinguish a committed-but-not-yet-checkpointed image, an actively referenced image, and a recoverable orphan without destructive cleanup. Multi-document references prevent one document from quarantining an Asset still used elsewhere. A future purge command requires immutable-original storage or verified export/archive coverage, an explicit retention policy, bounded audited batches, and a recovery window; it is intentionally not implemented here.

ADR-062 adds a user-facing metadata-only quarantine list and non-destructive reinsertion. It does not change the purge boundary established here.
