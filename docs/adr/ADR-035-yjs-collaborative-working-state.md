# ADR-035: Yjs for Collaborative Working State

- Status: Accepted
- Date: 2026-08-21

## Context

KOMYAKU needs local-first editing, offline recovery, and eventually concurrent editing without weakening its central promise: the immutable Version DAG and the open `.komyaku` archive must preserve document evolution for decades. A live collaboration engine and a durable historical format have different compatibility, security, and retention requirements.

Yjs provides CRDT shared types, compact binary updates, state-vector-based differential synchronization, editor bindings, relative positions, transaction origins, selective undo, and an ephemeral Awareness protocol. Its update representation is useful for convergence, but it is not an appropriate public archival contract or a replacement for KOMYAKU's Canonical Document Schema.

## Decision

Adopt Yjs as the **collaborative working-state engine**, initially through a bounded `y-prosemirror` feasibility implementation. Keep the following authority boundary:

```text
ProseMirror editor
       │ local/remote transactions
       ▼
Yjs working state
       │ explicit checkpoint
       ▼
Canonical Document validation and normalization
       │ explicit save / autosave policy
       ▼
Immutable KOMYAKU Version DAG
```

- The Canonical Document Schema is the authoritative durable document representation.
- The Version DAG is the authoritative history. A Yjs update stream is never presented as a KOMYAKU Version history.
- `.komyaku` archives must remain readable without a Yjs runtime. Yjs binary updates may be optional, versioned session-recovery material, but never the only copy of document content.
- Asset bytes remain in content-addressed Asset storage. Collaborative state contains only stable Asset references and bounded metadata.
- Yjs schema/binding versions are tracked independently from the Canonical Document schema version.

## Working-state rules

- Synchronization uses state vectors and differential updates where practical. Update application must remain idempotent so retries and duplicate delivery are harmless.
- A server update is untrusted binary input. Enforce authenticated Workspace/Document room access, maximum update size, maximum decoded structure/operation limits where available, rate limits, storage quotas, and compaction thresholds.
- Persist updates durably before acknowledging them under the selected Provider protocol. Create periodic compacted checkpoints so startup and resynchronization do not require replaying an unbounded log.
- Provider, persistence, and transport are adapters. Do not make a demo WebSocket server or sticky in-memory room state a correctness requirement.
- Transaction origins distinguish local user input, remote collaborators, AI proposals, imports, migrations, and system normalization. Local undo tracks only explicitly allowed origins and must not unexpectedly undo remote, AI, or system changes.
- Use Yjs Relative Positions for live cursors and selections. Durable comment anchors also store stable Node IDs plus quoted/context fallback because comments must survive checkpoint conversion and future migrations.
- Awareness/Presence data is ephemeral, TTL-bound, and privacy-minimized. It is not written into the Version DAG, `.komyaku` archives, analytics payloads, or backups as document content.
- Do not begin with Yjs subdocuments. Introduce them only if measured document size or independent loading boundaries justify their lifecycle complexity.

## Feasibility gate

Production dependencies and network infrastructure are introduced only after a Stage 3 spike demonstrates all of the following:

1. Two ProseMirror clients converge after concurrent multilingual and IME-safe edits.
2. An offline client can rejoin and converge without losing authored content.
3. Stable Node IDs survive Yjs-to-Canonical checkpoint round trips.
4. Authored LaTeX, Mermaid/SVG source, language/direction attributes, and compatible metadata survive the round trip.
5. Asset bytes never enter the Yjs document; only validated references do.
6. Invalid collaborative state cannot bypass Canonical Schema validation.
7. Equal converged working states produce deterministic Canonical checkpoint bytes and hashes.
8. Local undo excludes remote, AI, import, migration, and normalization origins unless explicitly selected.
9. Oversized, malformed, duplicate, and replayed updates are bounded and handled safely.

## Consequences

KOMYAKU gains a proven convergence model and ProseMirror integration path without coupling long-term archives to an implementation-specific CRDT encoding. Explicit checkpoints make live collaboration observable and testable, while immutable Versions remain intentional product events.

This introduces a second schema boundary, update compaction, room authorization, and failure recovery work. A successful CRDT merge does not guarantee a valid KOMYAKU document, so every checkpoint still requires Canonical validation.

## Rejected alternatives

- Use Yjs updates as the permanent Version DAG: live operations do not express KOMYAKU's branch, commit, publication, and archival semantics.
- Store ProseMirror/Yjs state directly as the `.komyaku` public format: this would bind the open archive to library internals.
- Build an original CRDT before validating product requirements: unnecessary algorithmic and interoperability risk.
- Persist Awareness as history: presence is transient and may disclose activity or identity data.
- Put binary Assets inside Yjs: this inflates updates and bypasses Asset inspection, deduplication, and retention controls.

## Multilingual summary

- 日本語: Yjsは共同編集の作業状態に限定して採用する。正本はCanonical Document、履歴の正本はVersion DAG、公開交換形式は`.komyaku`であり、Presenceは保存しない。
- English: Yjs is the live collaboration layer; Canonical Documents, the Version DAG, and the open archive remain the durable authorities.
- 简体中文：Yjs仅用于协同编辑的工作状态；Canonical Document、Version DAG和开放归档格式仍是持久化权威，Presence不进入历史记录。
