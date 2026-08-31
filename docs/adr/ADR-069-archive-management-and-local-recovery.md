# ADR-069: Archive management and local Canonical recovery

## Status

Accepted

## Decision

Verified Cloud exports are managed as first-class immutable artifacts. Authenticated Workspace members may list bounded metadata and request a 60-second forced-download URL. Storage keys are never returned. Owner/admin/editor invalidation marks the export invalid and invalidates every `verified_export` preservation-evidence row for that artifact in the same PostgreSQL transaction. Immutable bytes remain in storage for later retention handling.

Desktop recovery reads an attached `.komyaku` file entirely locally through the published Archive Reader. It applies the Desktop 50 MiB Archive, 25 MiB entry, and 5,000-entry limits, then validates ZIP structure, CRC32, manifest, Canonical schema, exact Asset set, and SHA-256. Only after complete success does it replace the working Canonical document. Existing local revision state for the same Document ID is loaded so the next checkpoint remains monotonic.

Format v1 local recovery restores Canonical structure and Asset identities. It does not yet materialize archived Asset bytes into local SQLite or import them into another Cloud Workspace. Missing local previews therefore remain fail-closed while their identities and accessibility metadata stay visible.

## Consequences

Users can independently download and inspect durable Archives and recover authored structure without Cloud availability. Invalidating an export immediately closes the retention gate contribution. Full cross-Workspace Asset materialization requires an atomic import/adoption workflow and remains next.
