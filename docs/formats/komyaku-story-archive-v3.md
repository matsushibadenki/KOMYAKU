# Story History Archive v3

[Done] Reference reader/writer and manifest JSON Schema. [Next] Native transactional import/export and Agent/runtime integration. Ordinary Desktop controls continue to use v1/v2 and must not advertise v3 recovery until its native boundary is complete.

Exports from `@komyaku/archive-core`:

- `KOMYAKU_STORY_ARCHIVE_FORMAT_VERSION = 3`
- `storyArchiveManifestSchema`
- `createKomyakuStoryArchive({ history, workspaceId, workspaces })`
- `verifyKomyakuStoryArchive(bytes, limits?)`

`history` is the existing v2 writer input. `workspaces` contains exactly one `{ versionId, snapshotJson }` per history Version. `snapshotJson` is an exact UTF-8 Story Workspace v1 snapshot containing Document, Graph and its named Paths. The reader returns `kind: "story-history"`, independently verified nested `history`, `workspaceId`, immutable workspace records with exact strings/bytes and validated values, plus the outer archive digest/size.

## Container and integrity

A store-only UTF-8 ZIP contains only:

```text
mimetype
manifest.json
history/document-history.komyaku
workspaces/<version-uuid>.json
```

The nested v2 archive preserves every exact Document Snapshot, ordered parent, Branch/current pointer and historical Asset under its existing independent verification contract. The v3 manifest declares the nested archive's SHA-256/size and every composite Snapshot's Version identity/path/SHA-256/size. Its timestamp must equal the nested manifest timestamp. v1/v2 readers reject the outer major version instead of dropping Graph/Paths. The nested archive is accessible only through the explicitly declared v3 reader; callers must not silently treat v3 as v2.

Semantic validation additionally requires:

- Exact closed Version-ID correspondence: no missing, duplicate or foreign composite record.
- One stable Graph workspace identity across all Versions.
- Each composite Document agrees with the corresponding normalized Canonical v2 Version; Graph references and Paths validate against that Document.
- Restore Versions reuse the target's exact composite Snapshot bytes, including Graph/Paths.
- No extra/missing ZIP entry, path substitution, undeclared Asset or unverified bytes.

The manifest [JSON Schema](schemas/komyaku-story-archive-manifest-v3.schema.json) validates fields/bounds; it alone cannot establish the ZIP, cross-reference or digest invariants. Always use the full reader.

## Limits and collision policy

Maximum outer ZIP: 512 MiB. At most 5,000 composite Snapshots and 5,003 outer entries. Each composite Snapshot is at most 24 MiB; the embedded v2 retains its own Version/Branch/Asset counts and 12 MiB Document-Snapshot / 100 MiB Asset limits. Writer bounds aggregate payload before packaging and checks final ZIP size. Reader policy overrides can tighten the outer byte/entry limits but cannot expand them. Graph resource limits come from `@komyaku/story-graph`; exact source strings remain data, never executable content.

Native adoption must reject existing Workspace/Version/Branch identities unless replaying the same verified archive digest, and deduplicate Assets only on identical ID/media/size/hash. All composite state, immutable history, pointers, Asset references and import receipt must commit atomically. This is a required future native gate, not a property established by the JavaScript reader/writer. v3 does not serialize operation receipts, credentials or editor undo state.

## Verification

Seven regressions cover deterministic roundtrip and exact Path/Snapshot retention; object-key-order-independent Document comparison with exact byte retention; closed Version sets; mismatched Document/workspace/reference/Path rejection; exact composite restore; corruption and bounded-reader overrides; historical-only Asset bytes. The Rust internal composite-history tests separately verify atomic state/Version/head/receipt adoption, rollback, concurrent writers and file-database reopening. Native and shared normalized-schema differences remain in N3S; these tests do not establish a production v3 importer.
