# ADR-036: Local Canonical Draft Autosave and Recovery

- Status: Accepted and implemented
- Date: 2026-08-24
- Owners: KOMYAKU architecture

## Context

The collaborative editor previously kept its Yjs Working State only in memory. A window reload or application restart therefore returned to the welcome fixture. KOMYAKU needs bounded crash recovery without making Yjs encoding the durable document format.

## Decision

KOMYAKU persists the latest validated Canonical Document checkpoint as the local draft:

```text
ProseMirror transaction
        ↓ 450 ms quiet period
Yjs Working State
        ↓ composition has ended
Canonical validation
        ↓
monotonic local revision
        ↓
Rust validation + SQLite transaction
        ↓
local_documents + local_drafts
```

- Tauri uses `sqlite:komyaku.db` and the existing `local_documents` / `local_drafts` tables.
- The Vite browser feasibility environment uses origin-local `localStorage` behind the same application contract. It is development infrastructure, not the desktop storage authority.
- Stored Canonical JSON is limited to 12 MiB at this boundary and is validated before both writing and restoration.
- The document ID and schema version must match the storage key and record metadata.
- Local revisions only move forward. A stale writer cannot replace a newer draft.
- Tauri performs document-shell upsert and draft upsert in one Rust-side SQLite transaction. Stale-revision rejection rolls back document metadata as well as the draft write.
- The native command independently checks the 12 MiB boundary and requires its document ID, schema version, language, direction, writing mode, and title to match the Canonical JSON. It returns stable error codes without database details.
- IME composition suspends checkpointing. Only the transaction observed after `compositionend` becomes eligible for autosave.
- Corrupt or incompatible local data fails closed. The application starts a non-persisting fallback view and displays a generic local-storage error rather than silently overwriting the stored record.

The recovery point objective for ordinary editing is the 450 ms quiet period plus local storage latency. This is draft recovery, not an immutable Version commit.

## Consequences

- A normal restart restores the last validated draft while preserving Canonical Schema independence from Yjs.
- A crash can lose the final sub-second editing interval.
- A process stop cannot commit only the `local_documents` shell from a draft save; SQLite commits both local records or neither.
- Durable keystroke-level Yjs updates, compaction, named recovery snapshots, and Version DAG commits remain separate later work.
- Packaged macOS Tauri has passed Japanese Kotoeri composition, conversion, restart recovery, and exact caret restoration. Simplified Chinese Pinyin remains an environment-specific gate.

## Verification

- JavaScript unit tests cover multilingual round-trip recovery, corrupt JSON, document identity mismatch, and stale-revision rejection.
- Rust tests cover atomic document-and-draft persistence, rollback of document metadata on stale revision, and rejection of mismatched Canonical identity without creating a document shell.
- Playwright covers live replica convergence, disconnect/reconnect, composition pause/resume, page-restart recovery, and widths from 320 to 1024 CSS pixels.
- `cargo test` and `tauri build --debug --bundles app` verify the native build boundary; the packaged `.app` passed the Japanese IME workflow.
