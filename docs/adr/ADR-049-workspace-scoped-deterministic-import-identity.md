# ADR-049: Workspace-scoped Deterministic Import Identity

- Status: Accepted and implemented
- Date: 2026-08-30

## Context

Desktop and Cloud parse the same provider export independently. Random Canonical Conversation and Message UUIDs made the graphs structurally equivalent but prevented Cloud Handoff from resolving Desktop-selected Message IDs. A source-global deterministic UUID would solve alignment but collide when two Workspaces import the same export because Conversation and Message primary keys are globally unique.

## Decision

Conversation Importer identity version 1 derives RFC 4122 UUIDv5 values from a fixed KOMYAKU namespace and an unambiguous zero-delimited name.

Conversation identity includes:

- identity version;
- identity scope;
- parser name and parser version;
- exact raw source SHA-256;
- provider Conversation identity, or deterministic bundle ordinal;
- deterministic duplicate occurrence suffix where required.

Message identity includes the derived Conversation ID and effective source Message ID. Duplicate source Message IDs retain the existing deterministic `#duplicate-N` suffix.

The default identity scope is `local`. Cloud import uses the target Workspace UUID as its scope. Desktop can reparse the already reviewed exact bytes using that Workspace UUID before offering Cloud synchronization. Thus independent parses in the same Workspace align, while different Workspaces cannot collide.

Parser versions are raised from 1.0.0 to 1.1.0 because Canonical identity semantics changed. Identity version and scope are retained in `providerMetadata`. Import record IDs remain independent audit identities and are not used to derive Canonical IDs.

## Security and privacy properties

- IDs are not derived from title or authored body text.
- Raw SHA-256 participates in derivation but cannot be recovered from UUIDv5 output.
- Workspace scope prevents identical exports from sharing database primary keys across tenants.
- Provider ID absence and duplicates use deterministic ordinals rather than heuristic text matching.
- Existing Cloud Branch and authorization validation remains fail-closed.

## Consequences

- Same bytes, parser version, and scope produce the same Conversation and Message IDs despite different Import record IDs.
- A byte change, parser version change, or Workspace change produces a different identity graph.
- Reimporting identical bytes into the same Workspace needs the existing idempotency/import-reuse policy; deterministic keys intentionally expose duplicate import attempts as conflicts rather than silently overwriting.
- Desktop Cloud synchronization must use a Workspace-scoped reparse and must not send the default local-scope graph.

## Rejected alternatives

- Random UUID plus text matching: ambiguous and unsafe.
- Source-global deterministic UUID: cross-Workspace primary-key collision.
- Use the Import record UUID as namespace: independent Desktop／Cloud parses remain misaligned.
- Hash title or message text: authored edits and duplicate text make identity unstable or ambiguous.
