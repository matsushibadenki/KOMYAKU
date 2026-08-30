# ADR-050: Desktop opt-in Cloud AI Handoff synchronization

- Status: Accepted
- Date: 2026-08-30

## Context

Desktop imports are first reviewed on-device with a Local identity scope. Cloud conversations use deterministic IDs scoped to a Workspace, and a completed AI continuation must never be attached to a different graph identity. Provider credentials must remain on the device even when continuation metadata is stored in KOMYAKU Cloud.

## Decision

The Desktop exposes Cloud synchronization only after an authenticated exact-byte import has completed. It reparses those same source bytes with the selected Workspace ID and requires the resulting Conversation IDs to exactly match the server response. A mismatch fails closed.

Cloud mode is explicit and off by default. Enabling it replaces the Local graph with the Workspace-scoped graph and clears the configured connection, payload review, masking choice, and consent. The user then selects a server-authorized Provider Connection. The server returns metadata only; credentials and tokens are never returned.

Provider transport still resolves Local or BYOK credentials from the operating-system credential store at send time. The selected Cloud Provider Connection ID is carried in the confirmed handoff so the server can authorize it transactionally. Connection type must match the confirmed provider type.

After the AI response is complete, the Desktop first commits the continuation to Local SQLite. It then sends the already-confirmed assistant Message and Handoff metadata to the authenticated Cloud API. Cloud persistence uses `ai-handoff:<confirmed-handoff-id>` as its idempotency key. A Cloud failure retains only the completed persistence payload and offers a save-only retry; it never calls the AI provider again.

## Consequences

- Local-first safety remains the first durability boundary.
- Cloud graph identity cannot silently diverge from the exact reviewed import.
- Switching storage scope requires a new review and consent.
- A user may have a locally completed continuation while Cloud synchronization is pending; the UI reports that state and permits idempotent recovery.
- Provider secret synchronization is intentionally out of scope.

