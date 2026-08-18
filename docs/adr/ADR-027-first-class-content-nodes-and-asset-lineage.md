# ADR-027: First-class Content Nodes and Asset Lineage

- Status: Accepted
- Date: 2026-08-18

## Context

KOMYAKU documents can contain prose, mathematical expressions, tables, code, diagrams, illustrations, PDFs, and design files. Treating every non-text item as an opaque attachment would discard editable source, semantic identity, accessibility metadata, and useful history. Conversely, normalizing every paragraph and figure into independently persisted revisions in the MVP would make atomic snapshots, offline editing, migration, and recovery unnecessarily complex.

## Decision

- Model supported content as typed, first-class nodes in a versioned Canonical Document Schema.
- Give every block a stable Node ID, type, schema version, metadata, and timestamps or provenance where applicable.
- Separate canonical source, render representation, Asset references, metadata, and version identity. A preview is never the canonical source.
- Keep the immutable whole-document snapshot as the authoritative Version representation for the MVP.
- Derive Node lineage by comparing stable Node IDs across Document Versions. Node revision numbers, hashes, and materialized lineage tables may be added as projections or storage optimizations; they do not replace the authoritative snapshot.
- Store large binary originals and generated artifacts outside Document JSON. Refer to them by Asset ID and record their content hash, media type, size, provenance, and source/preview relationship.
- Permit content-addressed deduplication only inside an authorization and encryption boundary, initially a Workspace. A matching hash never grants access and must not reveal that another tenant possesses the same content.
- Dispatch comparison by content type. Text, source math, diagrams, images, tables, code, and opaque binary Assets have different Diff capabilities.
- Record Version change kinds such as `TEXT`, `MATH`, `DIAGRAM`, `IMAGE`, `TABLE`, `CODE`, `ASSET`, and `STRUCTURE`. UI markers must combine labels or shapes with color for accessibility.
- Limit the MVP to Text, Heading, List, Table, Image, Math/LaTeX, Code, Basic SVG/Mermaid, and Generic File nodes. CAD/3D formats begin as original Asset plus metadata and optional safe preview, not native editing.

## Canonical boundary

```text
Content Node
├─ stable identity
├─ canonical source/data
├─ render representation reference
├─ Asset references
├─ metadata and accessibility text
└─ Version lineage
```

```text
Document Version (authoritative immutable snapshot)
├─ Node A — same stable ID, unchanged content hash
├─ Node B — same stable ID, new content hash
└─ Node C — newly added stable ID
```

## Consequences

KOMYAKU can evolve from prose history into a Structured Document Evolution Platform while keeping the MVP recoverable and understandable. Stable Node IDs make questions such as “when was Figure 3 introduced?” answerable without duplicating unchanged large Assets. Format-specific rendering and Diff remain isolated extensions. The system must validate Node IDs, prevent accidental reuse, maintain Asset reference counts, authorize every Asset fetch independently, and preserve authored source when renderers change.

## Rejected alternatives

- Store rendered HTML or images as the only source: loses semantics and reproducibility.
- Store binary data as Base64 inside Document JSON: inflates snapshots and defeats efficient Asset reuse.
- Make independently normalized Node revisions the only source of truth in the MVP: complicates atomic restore, offline operation, and schema migration.
- Deduplicate globally across tenants: creates authorization, privacy, deletion, and encryption-boundary risks.
