# Cloud `.komyaku` Import

Connect the Desktop editor to an authenticated Cloud Workspace, choose **Open .komyaku archive**, and select an Archive of at most 50 MiB. The Desktop sends the exact bytes as `application/vnd.komyaku.archive+zip`; the server independently verifies the ZIP, manifest, Canonical Document, CRC32, Asset SHA-256 values, and current media policy.

Success replaces the working editor state with the Canonical Document returned from the committed Cloud import. Imported Asset IDs may differ from the Archive IDs when identical content already exists in the Workspace; the returned Document contains the authoritative remapped IDs. Reopening the exact same Archive is safe and returns the original committed import.

If the Archive is corrupt, unsupported, too large, unauthorized, or conflicts with an existing Document UUID, the working Document is unchanged. Operators can identify successful materialization through `operator_audit_events` action `archive.import_materialized`.

Current accepted Asset types are PNG, TXT, Markdown, CSV, Mermaid source, and JSON, with a 1 MiB limit per entry. Local mode verifies and restores Canonical structure only; it does not yet adopt Archive Asset bytes into SQLite.
