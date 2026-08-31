# ADR-063: Structured rich Image captions

## Status

Accepted

## Context

Canonical Image captions are arrays of inline nodes, not plain strings. They can contain marked text, hard breaks, and `math_inline` nodes with stable identity and authored LaTeX. Flattening that array into a textarea would destroy marks, math identity, provenance, metadata, and future extension data.

## Decision

The Image accessibility form uses a structure editor over the existing Canonical Caption array. Authors can add, edit, remove, and reorder:

- text segments with bold, italic, underline, strike, or code marks;
- explicit hard-break nodes;
- inline LaTeX nodes whose stable Node ID survives subsequent edits and restarts.

Existing link marks, metadata, extensions, render artifacts, and provenance are carried forward when their segment is edited. The editor does not invent a parallel markup language and does not parse delimiter syntax such as `$...$`.

Before dispatch, editor-core validates every element against `inlineNodeSchema`, limits a caption to 256 inline nodes, and limits combined text, LaTeX source, and break weight to 10,000 code units. Alternative text remains required. A single `setNodeMarkup` transaction updates the Image Node by stable ID; Yjs synchronizes it and the validated Canonical checkpoint persists the same array.

## Consequences

Rich captions remain machine-readable and diffable instead of becoming an opaque string or image. Inline math retains authored LaTeX and identity for future semantic Diff. Rendering remains conservative text-source display in the current Image NodeView; isolated inline-math visual rendering can be added later without changing stored caption data.
