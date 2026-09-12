# KOMYAKU Archive Format 1

## Status and identifiers

This is the normative specification for format version 1 of the open `.komyaku` Archive.

Format version 1 carries one immutable Snapshot. Complete Version/parent/Branch history uses the separately versioned [History Archive Format 2](komyaku-history-archive-format-v2.md). A v1 reader must reject v2 rather than silently discarding its history.

- Extension: `.komyaku`
- Media type: `application/vnd.komyaku.archive+zip`
- Container: ZIP, stored entries only for the v1 writer profile
- Manifest format identifier: `komyaku-archive`
- Format version: `1`

No KOMYAKU account, server, subscription, Yjs runtime, or proprietary library is required to inspect an unencrypted Archive.

## Required layout

```text
mimetype
manifest.json
documents/{document-uuid}.json
assets/sha256/{first-two-hex}/{sha256}
```

`mimetype` must be the first local ZIP entry, uncompressed, and contain exactly the media type above without a newline. Every name is UTF-8. Absolute paths, backslashes, empty components, `.`, `..`, NUL, duplicate paths, encrypted entries, data descriptors, and non-store compression methods are rejected by the v1 reference reader.

The Canonical document follows `docs/formats/canonical-document-v1.md`. Original Asset bytes are stored unchanged. Filenames are Canonical node metadata and never Archive paths.

## Manifest

`manifest.json` is UTF-8 JSON conforming to `docs/formats/schemas/komyaku-archive-manifest-v1.schema.json`. It contains the creation instant, one Canonical document descriptor, zero to 5,000 Asset descriptors, and an `extensions` object.

Each Asset path is derived exclusively from its SHA-256. The descriptor ID must be referenced by the Canonical document. Every Canonical Asset ID must occur exactly once in the manifest. Byte length and SHA-256 must match the stored entry.

## Integrity and verification

A conforming verifier must check ZIP structure and CRC32 before interpreting JSON, apply resource limits, parse the manifest, validate Canonical Document Schema and identity, compare the complete Canonical/manifest Asset sets, and hash every Asset. The Archive SHA-256 is computed over the complete ZIP byte sequence.

KOMYAKU Cloud writes the Archive to immutable Object Storage, reads it back, repeats full verification, and only then records retention evidence bound to the complete Archive digest.

A format-v1 reader can restore the Canonical document and unchanged Asset entries independently. Application import policy is separate from format validity. The packaged Desktop adopts accepted Asset bytes, remapped references, and the Document in one SQLite transaction; its browser build can only verify and restore Canonical structure. Cloud import accepts the safe profile below, materializes immutable Asset bytes and remapped references, and publishes the Document only when one PostgreSQL transaction succeeds.

The Local and Cloud safe profiles both limit entries to 1 MiB. Local PNG adoption retains the stricter 256 KiB decoded-preview limit. This is an application limit and does not narrow the open Archive format.

### Current Cloud import safe profile

- Archive: 50 MiB; each entry: 1 MiB; entries: 5,000
- Accepted originals: PNG, plain text, Markdown, CSV, Mermaid source, and JSON
- Each Asset is fully hashed and inspected; declared and detected media types must match
- Valid Archives containing another media type remain format-valid but are rejected by current Cloud application policy
- Reimporting the same Archive digest into one Workspace is an idempotent replay
- A different Archive with an existing Document UUID is rejected rather than overwriting that Document

## Limits in the reference implementation

- Archive: 512 MiB
- Single entry: 100 MiB
- ZIP entries: 10,000
- Manifest Assets: 5,000
- Cloud Canonical request: 5 MiB

Implementations may impose lower documented limits. They must fail closed before extraction when a limit is exceeded.

## Compatibility

Readers must reject unsupported major `formatVersion` values. Version 1 requires the fields in the published JSON Schema and rejects unknown top-level fields except namespaced data inside `extensions`. An extension must not replace the Canonical document or integrity fields. Yjs recovery data, if introduced, is optional and non-authoritative.

Version Graph, branches, merges, multiple documents, signatures, and encryption are not part of format version 1. They require a later format version or specified compatible extension with conformance fixtures. Format 1 remains readable after those additions.

## Determinism

The reference writer sorts Assets by UUID, uses compact JSON, fixed ZIP metadata fields, UTF-8 names, and store-only entries. Identical Canonical JSON, original bytes, and `createdAt` produce identical Archive bytes. The creation instant is therefore an explicit determinism input.
