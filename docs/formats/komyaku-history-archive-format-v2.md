# KOMYAKU History Archive Format 2

## Status and compatibility

This is the normative specification for format version 2 of the open `.komyaku` Archive. Version 2 carries one complete local Document history. Version 1 remains the single-Snapshot interchange format defined in `komyaku-archive-format.md`.

- Extension: `.komyaku`
- Media type: `application/vnd.komyaku.archive+zip`
- Container: ZIP
- Manifest format: `komyaku-archive`
- Manifest `formatVersion`: `2`

A v1 reader must reject v2 rather than silently open only the current Snapshot. A v2-capable application must retain its v1 reader as a separate import path. Converting v1 to v2 creates one imported root Version and does not invent earlier history.

## Required entries

The Archive contains exactly these entries:

```text
mimetype
manifest.json
versions/<Version UUID>.json
assets/sha256/<first two hex>/<64 lowercase hex>
```

Unknown, duplicate, absolute, parent-relative, backslash, NUL, encrypted, compressed, data-descriptor, multi-disk, or ZIP-comment entries are rejected by the reference reader. The reference writer stores entries without compression.

`mimetype` contains exactly `application/vnd.komyaku.archive+zip`. `manifest.json` conforms to `schemas/komyaku-history-archive-manifest-v2.schema.json`.

## Manifest

The manifest identifies one Document and its current Branch/Version pointers. `versions` contains immutable Version metadata, ordered parent IDs, the exact Snapshot path and digest, and the exact Asset IDs referenced by that Snapshot. `branches` contains every retained Branch head. `assets` contains the closed union of Assets referenced by all included Version Snapshots.

The writer sorts Version, Branch, and Asset arrays by lowercase UUID. ZIP entries use the order `mimetype`, `manifest.json`, sorted Versions, sorted Assets. `createdAt` is supplied by the caller. Given identical inputs and `createdAt`, the reference writer produces identical bytes.

## Exact Snapshot bytes

Each Version entry stores its original UTF-8 Canonical JSON bytes at `versions/<id>.json`. The writer and reader do not reserialize these bytes. `snapshotByteSize` and `snapshotSha256` cover the exact stored bytes, including insignificant JSON whitespace.

After byte verification, the reader parses Canonical Document v1 and requires:

- the Canonical Document ID equals `manifest.document.id`;
- the Canonical schema version equals the Version metadata;
- `snapshotEncoding` is `canonical-json-v1`;
- the sorted unique Asset IDs derived from the Snapshot equal `version.assetIds`.

Hash verification establishes integrity, not authorship or a cryptographic signature.

## Graph closure

The reader rejects the Archive unless all conditions hold:

- Version IDs, Branch IDs, Branch names, and Asset IDs are unique in their respective namespaces;
- every ordered parent exists in the Archive, differs from its child, and appears at most once;
- the Version graph is acyclic;
- `initial` has zero parents, `merge` has two, and ordinary named/restore Versions have one;
- every restore reference identifies an included Version;
- every Branch head identifies an included Version;
- the current Branch exists and its head equals the current Version;
- every included Version is reachable by following parents from at least one Branch head;
- the Asset table equals the union of Assets referenced by every Version Snapshot;
- the ZIP contains no unreferenced entry.

This contract preserves ordered merge parents but does not define merge semantics. Merge preview and conflict decisions belong to the Version/Diff contract.

## Asset closure

Asset paths are content addressed by SHA-256. Each Asset record binds one logical Asset UUID to media type, byte length, digest, and path. An Asset referenced only by an old Version remains required even when the current Version no longer references it.

The reader verifies every Asset byte length, digest, and path before returning any materialization input.

## Resource limits

The reference profile enforces:

| Resource | Limit |
| --- | ---: |
| Archive bytes | 512 MiB |
| One entry | 100 MiB |
| One Version Snapshot | 12 MiB |
| Versions | 5,000 |
| Branches | 200 |
| Assets | 5,000 |
| ZIP entries | 10,002 |

Callers may use stricter byte and entry limits. Raising a limit must not disable graph, identity, digest, or closure validation.

## Atomic import and collision policy

Verification completes before database mutation. Materialization then occurs in one transaction.

| Identity | Required policy |
| --- | --- |
| Document | Reject an existing ID unless the same Archive digest is an idempotent replay |
| Version | Reject any existing Version ID during a new import |
| Branch | Reject any existing Branch ID or same-Document name during a new import |
| Asset | Deduplicate only when ID, media type, byte size, and SHA-256 all match |

History import does not remap Document, Version, Branch, Node, or Asset identities. A user-requested copy is a separate transformation that must mint a new closed graph and disclose that it is no longer the same history.

No partial Document, Version, parent, Branch, Asset, working draft, current pointer, or import receipt may remain after rejection or storage failure.

## Exclusions

Format 2 does not contain credentials, Cloud sessions, provider secrets, Yjs updates, recovery/autosave records, rendered previews, executable HTML, review comments, or AI prompts. It does not provide encryption, signatures, Cloud synchronization, or automatic merge decisions.

## Implemented reference API

`@komyaku/archive-core` exports:

- `createKomyakuHistoryArchive`
- `verifyKomyakuHistoryArchive`
- `historyArchiveManifestSchema`
- `KOMYAKU_HISTORY_ARCHIVE_FORMAT_VERSION`
- `HISTORY_ARCHIVE_COLLISION_POLICY`

The deterministic two-Branch fixture proves exact Snapshot-byte round-trip, shared ancestry, current pointers, and retention of an Asset referenced only by the root Version.
