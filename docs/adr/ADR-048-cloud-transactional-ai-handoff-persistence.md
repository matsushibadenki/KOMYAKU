# ADR-048: Cloud Transactional AI Handoff Persistence

- Status: Persistence and authenticated API boundaries implemented; Desktop integration pending
- Date: 2026-08-30

## Context

Cloud Conversations already had normalized Message, Edge, Handoff, Provider Connection, and Outbox tables, but no application boundary committed a completed continuation. The original Handoff schema also retained only the Canonical Context Hash, so it could not prove which provider-converted payload was reviewed.

## Decision

Migration `0011_cloud_ai_handoff_persistence.sql` adds the required Outbound Payload Hash and an index for completed Handoff history. The Cloud persistence Service validates the completed Handoff and assistant Message without accepting credentials or an entire client-supplied Conversation replacement.

The PostgreSQL Repository performs all of the following in one transaction:

1. Lock the target Conversation and verify active Workspace membership, verified User state, and an active Provider Connection owned by either that Workspace or actor.
2. Verify that every selected Message belongs to the Conversation, appears once in the reviewed order, follows persisted Edges, and ends at the reviewed source Message.
3. Detect an existing Handoff ID. An identical result is an idempotent replay; different hashes, result identity, or Provider response identity are a conflict.
4. Insert the assistant Message and `ai_continuation` Edge.
5. Insert the completed Handoff with both hashes and consent metadata.
6. Update the Conversation timestamp and emit `conversation.ai_handoff_completed` through the transactional Outbox.

The Outbox payload contains IDs only, never Message content or credentials.

## Consequences

- A committed Cloud continuation cannot expose a partial Message／Edge／Handoff graph.
- Authorization is repeated inside the transaction instead of relying only on a future HTTP middleware check.
- User-owned desktop credentials are not uploaded. The initial Cloud boundary requires an existing active Cloud Provider Connection record.
- The authenticated route requires a Session and Idempotency Key, limits JSON to 1 MiB, emits no-store headers, binds the Conversation ID in the path to the reviewed Handoff, and resolves replays only through an actor/workspace-scoped lookup. Desktop opt-in synchronization remains the next integration boundary.
- A real PostgreSQL integration test verifies migration 0011, UUID-array binding, atomic completion, ID-only Outbox content, and idempotent replay.
- Desktop and Server currently generate different Canonical IDs when independently parsing the same export. Identity alignment is a mandatory gate before Desktop Cloud synchronization; see `docs/architecture/conversation-import-identity-alignment.md`.

## Rejected alternatives

- Upload the entire modified Conversation: permits unrelated client-side graph replacement.
- Trust selected Message IDs without checking persisted Edges: permits context/audit mismatch.
- Emit Message content in the Outbox: unnecessarily duplicates sensitive authored data.
- Expose the route before transactional authorization and replay rules exist: expands attack surface prematurely.
