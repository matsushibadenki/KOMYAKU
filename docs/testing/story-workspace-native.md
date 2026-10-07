# Story Workspace native groundwork — 2026-10-06

[Done] Internal Rust storage commits composite snapshot and operation receipt atomically. Receipt lookup precedes revision compare-and-swap. A receipt-stage failure rolls back the snapshot; exact retries return the original result without rewinding newer state. File database close/reopen replay preserves exact snapshot bytes.

[Done] Native Graph schema validation covers normalized shared snapshots: strict field sets, node/entity/edge kinds, names and slug bounds, finite positions, extension/state keys, condition/effect value presence, resource limits, ID/reference closure, reading DAGs and connected named paths. Bounds on strings count UTF-16 units as in the shared JavaScript contract. The validator expects default arrays already materialized; it is not an external-input normalizer.

[Done] `commit_workspace` checks the operation UUID, Document/Graph identity, collects Document content/caption IDs, validates Graph schema and links, derives the composite snapshot and request identity in Rust, and uses the atomic storage primitive. The Document argument must already be validated Canonical input from a future native owner. A test proves invalid Graph references leave the existing state/revision intact.

[Done] Rust unit suite: 41 passed, one explicit performance test ignored. No Tauri command, permission or production migration was added. The internal modules cannot yet be invoked from the ordinary UI.

[Next] Port complete Canonical Document validation/normalization and shared conformance fixtures to Rust. Current draft validation is insufficient as a complete Canonical boundary.

[Next] Execute bounded Story Workspace edit commands against the authoritative current state in Rust, deriving the proposed result there instead of accepting a WebView snapshot. Verify concurrent writers and retry receipts through this command boundary.

[Next] Register production migrations, Tauri commands/ACL and frontend adapters after those validation gates pass. Include composite immutable snapshots in Version/Branch/reviewed-Merge transactions and define the new Archive major contract. History Archive v2 remains Document-only.

## Native Graph command execution — 2026-10-06

[Done] `story_workspace_commands::execute` accepts a bounded strict Graph-edit batch (put/remove in nodes/edges/paths/entities), reads the authoritative current SQLite snapshot, checks workspace identity and expected revision, applies edits locally and validates the final Graph before storage. Rust derives both request identity and snapshot bytes. Revision CAS prevents adopting a candidate derived from an outdated state.

[Done] Receipt lookup occurs before reading the current snapshot. The storage primitive repeats it under the writer reservation, including when current revision is already stale. Tests cover rejected missing Canonical references with no additional receipt, successful put/remove, exact replay after later edits, operation-ID collision and stale requests. Rust suite passes 42 tests; one explicit performance fixture is ignored.

[Next] Document replacement is intentionally unsupported by the native command enum until complete Canonical Document validation exists. The command remains internal and does not register Tauri IPC or production migrations. Initialization still requires a trusted, already validated Canonical Document. Full composite Version/Branch/Merge and Archive support remain unfinished.

## Plain-prose Document replacement — 2026-10-06

[Done] The internal command enum now supports replace-document for a strictly validated normalized plain-prose subset: paragraph/heading blocks, unmarked text and hard breaks. Identity, strict field sets, language/direction/writing mode, heading levels, unique Canonical node IDs, metadata/extension keys and whole-JSON depth/value/string budgets are checked in Rust. Rich nodes, marked text, artifacts and provenance fail closed. Replacement preserves Document identity, and final Graph reference validation still occurs after the batch.

[Done] Replacement test verifies the exact Document inside the committed composite Snapshot and exact request replay. Rust suite passes 43 tests with one performance fixture ignored.

[Next] Complete all rich Canonical types and shared conformance fixtures before claiming full Document support or exposing this subset through production IPC. Earlier statements that replace-document is disabled are superseded only for this plain-prose subset. Trusted initialization remains internal; Version/Branch/Merge and Archive integration are unfinished.

[Done] 2026-10-06: The native Document subset additionally accepts normalized code blocks, LaTeX blocks, file references and horizontal rules. Source is validated as an opaque string, never executed. Strict fields and file ID/media/name/title/description bounds are enforced. The validator rejects a block reusing the Document ID and repeated block IDs. Type-specific tests cover supported shapes and identity collisions. `validate_document_subset` names the partial support explicitly.

[Next] Tables, images, diagrams, inline math, marks, artifacts and provenance still fail closed. File reference validation does not yet guarantee Asset availability; native Asset closure must be connected before runtime adoption is exposed.

## Atomic current Asset closure — 2026-10-06

[Done] Composite Snapshot commits collect typed file/image references from Document content/captions, avoiding metadata lookalikes. Before adoption, the same SQLite transaction checks each referenced local Archive Asset for presence, matching media type, nonempty bounded bytes, declared byte size and SHA-256. Repeated references with conflicting media declarations fail closed.

[Done] Current references are stored in `story_workspace_assets` in the state/receipt transaction. The receipt-stage injected failure rolls the reference replacement back. Native tests reject missing/corrupt bytes and preserve prior reference rows after failure. Rust suite: 45 passed, one performance fixture ignored.

[Next] The new table is internal groundwork, not a registered production migration. Existing Asset quarantine/lifecycle routines and immutable Version Asset closure do not yet consume these references. Image Document validation is still unsupported despite this storage check understanding typed image references. Do not expose runtime adoption until those contracts are connected.

## PNG Document node validation — 2026-10-06

[Done] The normalized Document subset now supports PNG image nodes with Asset UUIDs, bounded alternative text, null or positive integer display dimensions and unmarked text/hard-break captions. Rendering artifacts/provenance remain unsupported. Tests reject zero/fractional dimensions, non-PNG formats and malformed captions. Rust suite passes 46 tests with one explicit performance fixture ignored.

[Next] This schema stage does not decode PNG bytes. The existing Workspace storage stage checks stored Asset bytes/hash/media type, while normal Archive Asset creation supplies the decoder-backed inspection contract. A dedicated composite image adoption/recovery fixture, full rich Canonical support and production IPC integration remain unfinished. Earlier notes that all image Document nodes are unsupported are superseded only for this normalized PNG subset.

[Done] 2026-10-06: Native subset now accepts tables/rows/cells, bullet and ordered lists/items, and blockquotes with nested supported blocks. Validation enforces strict container fields, nonempty children, row/cell/item parent constraints, required child types, cell spans (1–100), ordered starts (1–1,000,000), global Node identity and iterative limits. Inline content and image captions count toward node/depth budgets. Tests cover a valid nested table/list, invalid spans and misplaced cells/items. Rust suite: 47 passed, one performance fixture ignored. This does not assert rectangular table geometry beyond the shared schema.

[Done] 2026-10-06: Text and image-caption validation now accepts bold/italic/underline/strike/code/link marks with strict fields and the shared 20-mark limit. Duplicate mark keys fail; link identity includes href. Link href/title bounds, relative URL forms and http/https/mailto schemes are checked using Tauri’s existing URL parser. Tests cover allowed links, javascript/data/file and protocol-relative rejection, duplicate marks and unknown fields. Rust suite: 48 passed, one performance fixture ignored. Earlier statements that all marked text is unsupported are superseded.

[Done] 2026-10-06: Native normalized subset now accepts Mermaid/SVG diagrams and LaTeX inline math inside supported prose/captions. Strict fields and global math IDs are checked through one shared inline validator. Source remains opaque data, including SVG strings; this validation does not render, sanitize or execute them. Tests reject unsupported Source types and duplicate caption math IDs. Rust suite: 49 passed, one performance fixture ignored. Artifacts/provenance and non-PNG image support remain unfinished; production IPC is still unregistered.

## Rendering artifact closure — 2026-10-07

[Done] 2026-10-07: Native normalized Document nodes accept render artifacts with strict fields, UUID/media/role bounds, optional renderer/version and lowercase SHA-256 source hashes, capped at 20 per node. Workspace commits collect artifact Asset references alongside files/images, verify availability, media type and byte integrity in the same transaction, and roll back state/reference adoption on failure. Tests cover invalid artifact fields, missing/corrupt bytes, conflicting media declarations and receipt-stage rollback. Provenance, non-PNG images, full shared conformance and production IPC remain unfinished.

[Next] Complete provenance and remaining Canonical schema coverage, then shared cross-runtime conformance fixtures before registering production migrations and IPC. This stage does not implement generated rendering or immutable Version/Archive artifact retention. Earlier notes that render artifacts are rejected are superseded.

[Done] Validation: freshly rebuilt Rust library suite, 50 passed / 1 ignored; Bun workspace suite, 460 passed / 25 skipped / 0 failed. The final Rust run includes the conflicting-media and file-reference regression cases.

## Provenance and shared conformance — 2026-10-07

[Done] 2026-10-07: Support normalized Node provenance in Rust (optional createdAt/createdBy/sourceNodeId/sourceVersionId with strict fields). Offset datetime validation mirrors the installed shared Zod contract, including Gregorian leap dates, optional seconds, fractions and bounded timezone offsets. A single 42-case JSON corpus is consumed by JavaScript and Rust tests for provenance, artifacts, supported Source/container/inline nodes and safe links. The corpus exposed empty Document content being accepted only in Rust; native replacement now rejects it without state or receipt mutation. Exact replacement/replay retains provenance.

[Next] Expand conformance to resource-boundary and identity cases and resolve the remaining deliberate differences: PNG-only native image validation, lowercase UUIDs, and stricter whole-JSON depth/string budgets. External-input normalization, production migrations/IPC and composite Version/Archive integration remain unfinished. This corpus demonstrates agreement only for its covered normalized inputs; it is not complete schema equivalence. Earlier statements that provenance is rejected are superseded.

[Done] Validation: final Rust library suite 51 passed / 1 ignored; Bun workspace suite 504 passed / 25 skipped / 0 failed. Both runtimes pass all 42 shared corpus cases. Native command verification includes provenance preservation and rejected empty replacement with unchanged revision and no receipt.

## Validated adoption and concurrent writers — 2026-10-07

[Done] 2026-10-07: Enforce native normalized Document validation in both composite initialization and the final Graph-edit candidate, replacing unchecked Canonical ID collection with the validator’s ID set. Initialization no longer relies on a caller claiming the Document is trusted. Tests reject empty/unsupported/duplicate-ID/unsafe-link Documents without creating state, receipts or Asset references; Graph edits cannot readopt a corrupt stored Document. A file-backed two-connection concurrent command test proves only one writer adopts a shared expected revision, the loser receives a stale-revision error, and successful retry returns the original Snapshot without duplicate adoption. Rust suite: 54 passed / 1 ignored.

[Next] Resolve remaining shared/native schema differences and external normalization before runtime registration. This validation is still the explicitly supported normalized subset. The low-level commit primitive remains internal storage machinery and may be used only after validation; no production migration, IPC or Version/Archive integration is added. Earlier requirements for trusted initialization are superseded by native validation at commit_workspace.
