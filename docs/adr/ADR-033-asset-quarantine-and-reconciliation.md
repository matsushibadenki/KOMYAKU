# ADR-033: Asset Quarantine, Reconciliation, and Retention GC

- Status: Accepted
- Date: 2026-08-20

## Context

Object Storage and PostgreSQL cannot commit atomically. A successful immutable object write followed by a failed database claim leaves an orphan object. Conversely, releasing the final logical reference must not immediately destroy content that may still be recoverable, published, archived, or legally held. Concurrent writers and maintenance Workers may also race across server replicas.

## Decision

- Model content-addressed Asset lifecycle explicitly as `active -> quarantined -> purging -> deleted`.
- Move reference-zero Assets into quarantine only after an inactivity delay, then require a separate recovery window before physical deletion.
- Discover unknown canonical objects through bounded Workspace-prefix pagination and record them in `asset_orphan_objects`; discovery never deletes.
- Preserve the earliest purge deadline while an orphan remains continuously quarantined, so repeated scans cannot extend retention forever.
- Claim due purge work with PostgreSQL row locks and `SKIP LOCKED` before deleting an exact canonical object key.
- Validate Workspace, key shape, hash prefix, and full hash again immediately before deletion. Unexpected keys are reported but never deleted by this workflow.
- On Object Storage or completion failure, return the candidate to quarantine with a bounded retry time. Do not persist provider error text.
- Serialize concurrent Asset claims by Workspace and SHA-256 with a transaction-scoped PostgreSQL advisory lock.
- Require an Operator identity and reason, and write summary-only audit events for reconciliation, quarantine, and purge operations.
- Keep public reads, media inspection, quota enforcement, published-Version holds, archive holds, and legal holds as additional gates before enabling this GC policy in production.

## Consequences

Maintenance is restartable, bounded, and suitable for multiple Workers without relying on one server process. Newly discovered or reference-zero bytes remain recoverable for a documented interval. A write racing with a `purging` Asset fails closed and can safely retry after deletion; a later reconciliation detects any object left by a cross-system failure.

The initial operator workflow is intentionally conservative. Production purge scheduling must remain disabled until publication, archive, legal-hold, inspection, and quota policies are connected.

## Rejected alternatives

- Delete immediately after the final reference is released: removes recovery time and races with new references.
- Delete unknown objects during the first scan: a temporary database outage could destroy valid content.
- Use an in-memory lock: does not coordinate API or Worker replicas.
- Store full provider errors in lifecycle rows: may leak bucket, credential, or authored-content details.
