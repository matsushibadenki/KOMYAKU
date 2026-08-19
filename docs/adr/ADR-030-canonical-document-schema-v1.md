# ADR-030: Canonical Document Schema v1 and Editor Boundary

- Status: Accepted
- Date: 2026-08-19

## Context

The editor foundation used ProseMirror JSON directly and did not assign stable identity to content nodes. That shape was useful for proving editor dependencies but could not safely serve as a long-term persistence format: editor plugins may change, binary and rendered data have different lifecycles, and silent conversion loss would undermine archival recovery.

## Decision

- Define Canonical Document Schema v1 in `@komyaku/document-schema`; ProseMirror remains an editor projection.
- Give the Document and every semantic content node a stable UUID. Keep plain text and hard breaks as inline values owned by their stable parent.
- Support text structure, lists, tables, images, files, code, LaTeX math, Mermaid/SVG diagrams, and accessibility captions/alternative text as first-class data.
- Preserve authored strings without Unicode normalization.
- Separate canonical source, original Asset references, derived render artifacts, compatible metadata, namespaced extensions, and provenance.
- Validate unique IDs, structural parents, link schemes, nesting, and resource ceilings before accepting a Document.
- Reject future schema versions and unknown nodes. Schema upgrades require explicit ordered migrations.
- Provide Canonical-to-ProseMirror and ProseMirror-to-Canonical adapters. Conversion must fail when the editor cannot represent Canonical information; it must not silently discard data.
- Keep the `.komyaku` archive container version independent from the Canonical Document version.

## Consequences

Stored Documents no longer depend on the editor implementation. Stable IDs can later power node lineage and content-specific Diff, while immutable whole-document snapshots remain the recovery authority. Import and rendering paths gain a strict validation boundary and predictable resource limits. Adding a node type or changing meaning now requires a schema version and migration rather than an incidental editor change.

Text-level metadata is valid Canonical data but is not currently representable in the ProseMirror projection. The adapter rejects such a conversion until an editor annotation representation is implemented.

## Rejected alternatives

- Persist ProseMirror JSON as the permanent format: couples archival data to editor plugins and schema changes.
- Normalize Unicode during save: changes authored data and can corrupt meaningful comparisons.
- Preserve unknown nodes by dropping or flattening them: creates irreversible loss disguised as a successful migration.
- Store binary payloads or previews inside Document JSON: inflates snapshots and mixes authoritative and derived data.
