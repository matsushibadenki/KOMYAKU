# ADR-080 · Symbio local mathematical computation

- Status: Accepted for the bounded local implementation
- Date: 2026-10-23
- Related: ADR-051, ADR-075; Canonical Document v1

## Decision

KOMYAKU keeps authored LaTeX in existing `math_inline` / `math_block` nodes. Mathematical computation uses the GUI-independent Rust `symbio-core` crate as a sibling path dependency. No Canonical schema migration, cloud service, subprocess, shell execution, automatic AI request or new document authority is introduced.

The contextual math panel opens from the editor toolbar or a math node. Eight structural templates support selection wrapping and Tab / Shift+Tab placeholder navigation. They do not reproduce OS keyboard controls. Applying source issues one ProseMirror/Yjs transaction, preserves an existing Node ID and attributes, and passes through the normal Canonical checkpoint/autosave/history path. Existing-node updates compare the original source before applying and reject stale edits. Cancel closes only the local draft. The computation subset is intentionally narrower than KOMYAKU's source/preview grammar.

Explicit assumptions and differentiation variable are stored in the namespaced node extension `dev.symbio.math`. Computed MathML, SEG, result values and trust are derived, transient UI data; they do not replace authored source or become proof evidence. Changing source, parameters, selection or document invalidates displayed results and pending responses.

## Native boundary

Only the `main` window receives these capabilities, with an additional Rust window-label check:

- `compute_symbio_math(input)` returns a bounded CellView from the shared kernel.
- `export_symbio_math(input, origin?)` returns one valid `.symbio` research document.
- `import_symbio_math(json)` validates a `.symbio` Project and returns only the selected source of its active branch and explicit assumptions.

An atomic process-wide lease permits one operation at a time. Work runs on `spawn_blocking`, away from the UI thread. No adapter operation writes SQLite, chooses a filesystem path, resolves network data or modifies a KOMYAKU document. Reads and downloads use user-selected files and the existing local download pattern.

## Presentation

Authored source retains KOMYAKU's bounded KaTeX-to-MathML preview. Symbio result MathML is independently parsed, constrained by namespace/element/attribute/size/depth limits and rebuilt into a fresh XML document. Both use an iframe with empty sandbox and Permissions Policy, no referrer, and a deny-by-default CSP. Backend-generated strings are never inserted as trusted HTML into the editor.

## Exchange scope

Export includes this source and explicit assumptions only. A UUID origin (KOMYAKU document and equation node) is retained in the Symbio cell note when available. It does not claim a saved Version/Branch identity and does not export other document content, history, assets or AI prompts. Export need not run a calculation.

Import validates all stored Project structures but adopts no stored outputs/trust claims. It reads the active branch's selected cell, converting Expression syntax through the SEG when necessary. The user sees a source draft before applying it. This is a source exchange, not `.komyaku` Archive support, full-history synchronization, automatic merging or a bidirectional live link.

## Limits and builds

Canonical editing/KaTeX preview retain the 20,000-code-unit LaTeX limit. Computation/export accept 2048 UTF-8 bytes, 512 tokens and depth 64. Matrices are at most 8×8; inverse and larger determinants require rational entries. Solving supports rational-coefficient single-variable real polynomials up to degree two. General integrals, complex solving, Lean proofs and certified numeric bounds remain unsupported. Imported `.symbio` files are limited to 8 MiB.

Build layout requires sibling folders `Tauri/KOMYAKU` and `Tauri/Symbio`; compiled apps contain the Rust kernel and require neither a running Symbio app nor Python/Julia. Browser builds retain source editing and safe previews; native computation and exchange controls are disabled.

## Verification

Shared-kernel tests cover integral/matrix/equation results, exact versus approximate trust, valid single-equation export/import, source conversion and invalid-file rejection. Editor transaction tests cover identity preservation and stale-source rejection. Preview tests reject active elements, attributes, foreign namespaces, entities, malformed XML and oversized graphs. Native macOS input/computation/download/import/restart checks are recorded in the implementation delivery; Windows/Linux remain pending.

The integration also corrects an existing draft-persistence comparison: Canonical checkpoint serialization sorts opaque JSON keys, so validation must compare JSON values independently of object property order. Arrays and actual values remain order/content-sensitive. A regression test passes an actual Yjs checkpoint containing Symbio assumptions and verifies that a changed nonzero condition is rejected without changing the stored revision.
