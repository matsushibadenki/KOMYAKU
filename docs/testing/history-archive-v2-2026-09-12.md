# History Archive v2 verification — 2026-09-12

This record covers the first portable-history milestone. It proves the format contract, pure reader/writer, Desktop collection boundary, and browser download request. Atomic materialization into an empty native profile remains separate work.

## [Done] Contract and implementation

- Format v2 stores exact UTF-8 Snapshot JSON bytes for every Version, ordered parent IDs, all Branch heads, current pointers, and the exact union of Assets referenced by any included Version.
- The reader rejects missing/duplicate parents, cycles, invalid parent counts, dangling restore references, invalid Branch heads, current-pointer disagreement, unreachable Versions, incomplete or extra Assets, unknown ZIP entries, and byte/hash/path mismatches.
- Limits are 5,000 Versions, 200 Branches, 5,000 Assets, 12 MiB per Snapshot, 100 MiB per entry, and 512 MiB per Archive. The writer stops when accumulated payload bytes exceed the Archive limit.
- The collision policy rejects existing Document/Version/Branch identities for a new import and permits Asset deduplication only for identical identity, type, size, and digest. No identity remapping is part of a history import.
- v1 remains a single-Snapshot format with its existing reader. That reader rejects v2.

## [Done] Desktop export

- The Desktop collector follows every 100-item cursor page up to 5,000 Versions.
- It rereads each immutable Snapshot and its Assets through the native boundary with concurrency bounded to four, independently verifies SHA-256, and rejects conflicting bytes for one Asset ID.
- A final history read requires the current pointers and every Branch head/name to remain unchanged during collection.
- The v2 writer output is read and verified again before the browser download adapter receives it.
- English, Japanese, and Simplified Chinese distinguish full-history v2, current-Snapshot v1, Markdown, and TXT.

## [Done] Automated evidence

| Check | Result |
| --- | --- |
| Archive v1 + v2 focused tests | 5 pass |
| Archive/Desktop export focused tests | 20 pass |
| Version-history browser E2E | 17 pass, including real v2 create → verify → Blob download |
| Desktop production build | pass |
| JSON Schema parse | pass |
| `git diff --check` | pass |

The deterministic fixture reverses its input Version, Branch, and Asset arrays and requires byte-identical output. Its current main Version references no Asset; an Asset referenced only by the root Version must still round-trip exactly.

## [Next] Native recovery gate

- Add a bounded Tauri import command that materializes the verified input in one SQLite transaction.
- Reject all Document/Version/Branch collisions except an exact Archive-digest replay; verify Asset collision metadata and bytes.
- Inject failures at Document, Snapshot, parent, Branch, Asset, current-pointer, draft, and receipt stages and prove rollback.
- Quit and reopen an empty QA profile, then compare all Version bytes, ordered parents, Branch heads, current pointers, and historical-only Asset bytes.
