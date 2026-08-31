# ADR-072: Local Document Library and Import Conflict Choices

## Status

Accepted — 2026-09-01

## Decision

The packaged Desktop exposes a bounded metadata-only Local Document inventory backed by SQLite. Opening loads one validated Canonical Draft. Rename updates both the library title and Canonical metadata while monotonically advancing the local revision in one transaction. Archive is reversible metadata and never deletes Document or Asset bytes.

Imported Documents retain their source Archive digest in the inventory. When an Archive Document UUID already exists, KOMYAKU never overwrites it silently. The user may open the existing Document or import a copy. Copy import assigns fresh Document and Node UUIDs while retaining immutable Asset identities; native inspection and one-transaction materialization still apply.

## Security and privacy

The list command returns at most 200 summaries containing identity, title, language, revision, timestamps, Archive digest, and Archive state. It returns no authored body or Asset bytes. All mutations are capability-scoped to the main Tauri window. Browser feasibility mode does not claim a native durable library.
