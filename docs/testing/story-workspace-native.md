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
