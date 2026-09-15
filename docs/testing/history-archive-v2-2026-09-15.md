# History Archive v2 verification — 2026-09-15

This record covers the portable-history export and recovery milestone. It proves the format contract, pure reader/writer, Desktop collection and download boundaries, atomic native materialization, rollback, and exact recovery after reopening SQLite.

## [Done] Contract and implementation

- Format v2 stores exact UTF-8 Snapshot JSON bytes for every Version, ordered parent IDs, all Branch heads, current pointers, and the exact union of Assets referenced by any included Version.
- The reader rejects missing/duplicate parents, cycles, invalid parent counts, dangling restore references, invalid Branch heads, current-pointer disagreement, unreachable Versions, incomplete or extra Assets, unknown ZIP entries, and byte/hash/path mismatches.
- Limits are 5,000 Versions, 200 Branches, 5,000 Assets, 12 MiB per Snapshot, 100 MiB per entry, and 512 MiB per Archive. The writer stops when accumulated payload bytes exceed the Archive limit.
- The collision policy rejects existing Document/Version/Branch identities for a new import. An existing Asset is reused only when its ID, type, size, digest, and bytes all match; a digest already owned by another Asset ID is rejected. No identity remapping is part of a history import.
- v1 remains a single-Snapshot format with its existing reader. That reader rejects v2.

## [Done] Desktop export

- The Desktop collector follows every 100-item cursor page up to 5,000 Versions.
- It rereads each immutable Snapshot and its Assets through the native boundary with concurrency bounded to four, independently verifies SHA-256, and rejects conflicting bytes for one Asset ID.
- A final history read requires the current pointers and every Branch head/name to remain unchanged during collection.
- The v2 writer output is read and verified again before the browser download adapter receives it.
- English, Japanese, and Simplified Chinese distinguish full-history v2, current-Snapshot v1, Markdown, and TXT.

## [Done] Atomic native recovery

- The public v2 reader completes all ZIP, schema, graph, closure, byte-size, and SHA-256 checks before the Tauri mutation boundary receives input.
- One SQLite transaction writes the Document, current working draft, every immutable Version, ordered parent edge, Branch head, current pointers, historical Asset and import receipt.
- The native boundary independently revalidates UUIDs, graph reachability and cycles, reason-specific parent counts, exact current Snapshot bytes, every Snapshot hash, complete Asset closure, media inspection, and native 1 MiB per-Asset / 50 MiB total import limits.
- Same-digest replay is idempotent. Document conflicts and cross-ID Asset digest collisions are rejected without rewriting identities.
- A failure injected at the final receipt rolls back every preceding Document, Version, parent, Branch, Asset, reference, pointer, and draft write.
- A file-backed SQLite test closes and reopens the database, then compares all three exact Version Snapshot bytes and hashes, both Branches/current pointers, and the historical-only Asset bytes.
- The visible `.komyaku` file control accepts v2 and adopts only its verified current Snapshot. A history conflict offers opening the existing Document; v2 copy is hidden because copying requires a future explicit whole-graph transformation.

## [Done] Automated evidence

| Check | Result |
| --- | --- |
| Full Bun unit/service suite | 393 pass, 25 environment-dependent PostgreSQL integration tests skipped |
| Native Rust library suite | 31 pass, 1 explicit performance fixture ignored |
| History import/export focused tests | 11 pass |
| Version-history browser E2E | 17 pass, including real v2 create → verify → Blob download |
| Visible v2 file-import browser E2E | 1 pass |
| Full Desktop browser E2E | 44 pass |
| Desktop production build | pass |
| JSON Schema parse | pass |
| SQLite clean migration through v9 | pass |

The deterministic fixture reverses its input Version, Branch, and Asset arrays and requires byte-identical output. Its current main Version references no Asset; an Asset referenced only by the root Version must still round-trip exactly.

## [Next] Packaged application recovery gate

- Run export → full process quit → empty isolated profile import → full process quit/relaunch in the packaged macOS app.
- Read every Version and Asset back through real WebView IPC and compare the v2 source archive, including the visual lineage graph.
- Add an explicit whole-graph “import as copy” transformation only after its new Document, Version, Branch, Node, and Asset identity rules are specified and reviewable.
