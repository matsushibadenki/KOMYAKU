# Cloud Archive Import Verification

Run `bun test` and `bun run build`. The automated boundary checks cover exact Archive Asset-byte recovery, safe media rejection before Object Storage write, raw API media type handling, authenticated actor binding, and exact API-client byte upload.

Before production enablement, apply migration `0016_cloud_archive_imports`, import an Archive containing both a PNG and text original, restart the API, then import the same bytes again. Confirm the first response is `201`, replay is `200`, both return the same Import and Document identities, every active Canonical Asset reference resolves, and exactly one `archive.import_materialized` audit event exists.

Force a PostgreSQL failure after Object Storage upload and confirm no `cloud_documents` row is visible. The immutable unreferenced object is expected; run the non-destructive Asset reconciliation report and keep automatic orphan deletion disabled.
