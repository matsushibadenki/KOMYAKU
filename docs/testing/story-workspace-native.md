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

## Composite immutable history — 2026-10-08

[Done] Add `story_workspace_history` and an optional history stage to the internal Workspace storage transaction. Validated Document/Graph candidates retain exact composite Snapshots, hashes, ordered parents, Branch heads/current selection and immutable Asset closure alongside working-state revision/current references/operation receipts. Supported internal transitions are initial/named/alternative/restore/merge; restore requires exact target bytes and hash, merge pins current/source heads, and all history guards execute under the same SQLite writer reservation. Workspace Document identity cannot change.

[Done] File-backed tests retain multilingual Document/Graph/Path data through initial → named → alternative → restore-as-new-version → two-parent reviewed merge and close/reopen. Every Snapshot/hash, both Branch heads, ordered merge parents, historical references and Asset bytes survive. Replay returns the original receipt without replacing later state; changed operation identity fails. Receipt-stage failure rolls back working state, Version rows and Branch/selection adoption; stale source heads, wrong restored Snapshots and identity substitution leave no receipt. Two separate concurrent writers produce exactly one winning head and a stale-revision loser. Full Rust suite: 61 passed / 1 ignored.

[Done] The shared Archive package now has the independent [Story History v3 reference contract](../formats/komyaku-story-archive-v3.md), retaining every exact composite Snapshot alongside nested verified v2 history. Six reference tests pass.

[Next] These remain **internal validated-candidate primitives**, not ordinary Agent commands or production runtime adoption. Add authoritative current-state derivation for named/alternative saves, complete author/label/time metadata, resolve normalized-input/schema/resource conformance, register production migrations/ACL/IPC/adapters, connect historical references to Asset reclamation and implement native v3 transactional import/export. No production migration or command was added in this stage. Earlier notices that composite history/format support is entirely absent are superseded only for this tested internal/reference scope.

## Authoritative capture and image declaration conformance — 2026-10-09

🟢 [Done] Native normalized Document validation now accepts the same `image/` subtype grammar as the shared schema. The single corpus consumed by JavaScript and Rust contains 60 cases, including JPEG/WebP/GIF/SVG/AVIF declarations, malformed media types, UTF-16 alternative-text boundaries and safe integer dimensions. Schema acceptance does not authorize decoding or establish rendering support.

🟢 [Done] Internal `capture_current` takes operation identity, revision and history guards, with no caller-supplied Document/Graph/Paths. Inside the reserved SQLite writer transaction it checks receipts first, reads and validates authoritative composite state, and adopts exact Snapshot bytes, history/head/selection, Asset references and receipt atomically. Named and alternative kinds are supported; initial/restore/reviewed merge still use their distinct candidate contracts. Regression covers a working Path edit, exact captures, replay after a newer alternative without rewinding state, changed-request collision, stale revision and malformed stored state without extra history or receipts.

🟠 [Next] This remains an internal boundary. Production owner/IPC/ACL, complete metadata, Asset reclamation and native v3 import/export are unfinished. N3S remains open.

Verification: `cargo test --lib --manifest-path apps/desktop/src-tauri/Cargo.toml` passed 62 tests with one ignored performance fixture. The repository `bun test` run passed 567 tests with 25 PostgreSQL-dependent skips; the shared conformance corpus alone passed all 60 cases. `git diff --check` passed. No UI or native IPC verification is claimed for this internal boundary.

## Composite history metadata — 2026-10-09

🟢 [Done] Internal Version persistence includes optional `metadata` with `authorId`, nullable `label` and UTC `createdAt`. Branch creation and update timestamps are persisted with the Version, state, ordered parents, selection, Asset closure and receipt. UUID author identity, Gregorian UTC datetime (including optional seconds) and the shared 1,000 UTF-16-unit label bound are validated before adoption. Supplying metadata does not authenticate the author; trusted author derivation remains a production-owner requirement.

🟢 [Done] Transactional, repeatable migration upgrades legacy internal tables with nullable columns. Existing historical identities and timestamps are not fabricated. A legacy request omits `metadata` when serialized, preserving its exact receipt identity. Old rows remain unknown/null; no conversion to a valid v3 manifest is claimed for those incomplete rows.

🟢 [Done] Regression reconstructs a legacy schema, migrates it twice and successfully replays its exact request; injects receipt-stage failure and proves no Version/state adoption; retries successfully, checks multilingual metadata and new Branch timestamps, and rejects an altered label under an existing operation ID. File-backed history reopening preserves exact metadata across named, alternative, restore and merge rows. Invalid author IDs, invalid dates, non-UTC offsets and astral-label overflow are rejected. Full Rust suite: **64 passed / 1 ignored**.

🟠 [Next] Register production migrations/commands/ACL and Agent adapters, require complete metadata for new product operations with author identity derived by the owner, protect historical Assets from reclamation, and connect native Archive v3 import/export. N3S is not complete.

## Production Asset retention and schema provisioning — 2026-10-09

🟢 [Done] Tauri registers migration 10, provisioning composite current state/receipts, immutable Versions/ordered parents, Branch/selection, current/historical Asset references and nullable history metadata. Existing internal migration remains compatible; runtime commands are not registered by this change.

🟢 [Done] `local_retained_asset_references` combines ordinary draft, imported Archive, ordinary immutable Version, composite current state and composite immutable Version references. Ordinary draft saves and Version adoption use it when marking Archive Assets active/quarantined; active-preview removal and abandoned-preview quarantine require no retained reference. Quarantine listing independently excludes any referenced Asset even if its persisted lifecycle flag is stale. No physical byte deletion is implemented.

🟢 [Done] The file-backed native regression applies the registered migration, repeats schema setup and runs the internal migration; verifies current-only protection, then retains a PNG solely through a composite immutable Version after removing its working reference. An ordinary draft save keeps Archive bytes active and an aged pending preview protected. A deliberately stale quarantine flag cannot expose the PNG as a candidate. Full DB close/reopen retains exact bytes and quarantine exclusion. Only explicit fixture deletion of the final history reference permits quarantine and listing. Existing lifecycle and restore tests remain green.

Verification: full Rust library suite **65 passed / 1 ignored**; `git diff --check` passed. This exercises registered migration SQL and production persistence functions directly. ⭕️ [Pending] Packaged WebView startup on an existing profile with migration 10 has not been run for this change. 🟠 [Next] Composite owner/IPC/ACL/Agent adapters and native Archive v3 dispatch/recovery remain unfinished; N3S is still open.

## Read-only Workspace discovery IPC — 2026-10-09

🟢 [Done] `list_story_workspaces` is registered in the Tauri handler and command manifest, with `allow-list-story-workspaces` granted only to the main window. The hidden renderer retains event-only permissions. It reads the shared SQLite pool and accepts only an optional lowercase UUID continuation cursor.

🟢 [Done] Rust queries at most 101 rows, returns at most 100 ordered summaries (`workspaceId`, `documentId`, `revision`) and emits the last returned ID as continuation only when another row exists. It rejects malformed/oversized Snapshot JSON, absent or inconsistent identity and out-of-range revisions. Discovery does not claim full Canonical/Graph conformance and does not return Snapshot bytes, authored content or receipts. It does not write state.

🟢 [Done] The Desktop adapter validates strict response fields, safe positive revisions, unique ascending IDs after the requested cursor and correct continuation; freezes the returned summaries; and refuses non-native use rather than simulating an empty native library. Native regression verifies a 102-Workspace traversal and no receipt mutation, plus corrupt JSON/identity and invalid cursor refusal. Three adapter tests cover IPC payload, valid paging, malformed/unsolicited content, duplicate/unordered IDs, bad cursors and browser refusal. Existing ACL manifest/renderer-boundary tests pass.

Verification: Rust **66 passed / 1 ignored**, Bun **570 passed / 25 PostgreSQL-dependent skips**, Desktop frontend build successful, `git diff --check` passed. ⭕️ [Pending] Actual invocation in the packaged WebView has not been run for this command. 🟠 [Next] Validated production write dispatch, Agent integration and native Archive v3 recovery remain open; this discovery adapter does not complete N3S.

## Shared Graph conformance and stored edit boundary — 2026-10-09

🟢 [Done] JavaScript `parseStoryGraph` and Rust `validate_graph_schema` consume the same 34-case corpus under `packages/story-graph/test/fixtures/native-conformance.json`. Inputs use normalized lowercase UUIDs. The corpus covers each state condition/effect operation with valid and invalid value presence, including explicit null/object values; missing and duplicate document references; missing entities and Path nodes; duplicate/empty Paths; strict root/node/position fields; subtype grammar; invalid extension keys; and astral title boundaries. All 34 JavaScript cases and the native corpus test pass. External normalization, uppercase identities and native-specific resource ceilings are not certified by this corpus.

🟢 [Done] Internal editing checks the stored composite byte ceiling before parsing, exact root field set and schema identity/version, and agreement of the stored Document ID, Graph ID and Graph document ID with the requested workspace. Four injected corruptions (unknown root field, foreign schema, newer schema version and foreign Graph document identity) reject edits without changing revision/state or adding receipts. The writer remains internal; no new write IPC is registered in this change.

🟠 [Next] Complete remaining identity/resource conformance and trusted author derivation, then expose initial/edit/named/alternative dispatch through the production owner and Agent adapter. Native Archive v3 recovery remains open. N3S is not complete.

Verification: full Rust library suite **68 passed / 1 ignored**, full Bun suite **604 passed / 25 PostgreSQL-dependent skips**, and `git diff --check` passed. No packaged write-IPC verification is claimed.

## UUID identity and opaque Graph resource ceilings — 2026-10-09

🟢 [Done] The native lowercase UUID predicate now checks UUID versions 1–8 and variants 8/9/a/b in addition to shape. It matches the existing Desktop adapter contract. Native unit tests exercise all accepted version/variant combinations and reject unsupported versions/variants, uppercase, nil and maximal UUIDs. This deliberately bounded native identity contract is stricter than some shared external UUID inputs; no implicit identity remapping is performed. Four invalid version/variant cases were added to each shared corpus: **64 Document cases and 38 Graph cases**.

🟢 [Done] Full native Graph schema validation first traverses every JSON value iteratively, including opaque metadata, entity initial state and condition/effect values. Independent ceilings are 64 depth levels (root 0), 500,000 JSON values and 10×1024×1024 UTF-16 units counting strings and object keys. These native ceilings supplement shared array/schema limits; a Graph within individual array limits may still exceed the combined budget. Exact depth/value-count/astral-string boundaries pass; exceeding each fails. No new general metadata-key grammar is imposed.

🟢 [Done] Transactional regressions reject oversized initialization without state adoption, then reject an oversized entity-state edit without changing the existing revision/Snapshot or adding a receipt. Full Rust suite **71 passed / 1 ignored**; full Bun suite **612 passed / 25 PostgreSQL-dependent skips**; `git diff --check` passed.

🟠 [Next] Derive local author metadata in the Rust owner and connect bounded write dispatch plus Agent adapters, then complete native Archive v3 integration/recovery. No write IPC was registered in this change. N3S remains open; the corpus does not claim exhaustive shared/native normalization equivalence.

## Rust-owned local attribution — 2026-10-09

🟢 [Done] Production migration 11 and the repeatable internal migration provision `story_workspace_local_author`. The singleton local profile UUID is allocated using SQLite random bytes by Rust inside the history writer transaction. New owned named/alternative capture rejects supplied `HistoryMetadata`; only the label is caller-controlled. The UTC timestamp comes from the transactional SQLite clock. This is local attribution, not an authenticated account or tamper-proof author claim; the existing main-window SQL capability still exists.

🟢 [Done] Owned capture request identity includes input history guards/label and excludes generated author/time. The writer reserves the transaction and checks the exact durable receipt first. New operations derive attribution and commit it together with state, history, heads, Asset references and receipt; errors roll back the author allocation as well. Legacy candidate/capture helpers are unchanged. No new write IPC is registered.

🟢 [Done] File-backed regression injects final receipt failure and proves no author row or revision adoption; retries successfully; checks multilingual labels and stable authors for named/alternative Versions; closes/reopens the database; corrupts the author row and still replays the original request without changing its Snapshot or metadata; rejects a changed label under the same operation ID, rejects a new write with corrupt author state and rejects caller-supplied author/time. Existing state and receipt counts are retained on rejection.

Verification: full Rust suite **72 passed / 1 ignored**, `git diff --check` passed. ⭕️ [Pending] Packaged startup with migration 11 and real write IPC are not certified. 🟠 [Next] Connect owned capture and initialization/edit dispatch to production IPC/ACL and Agent adapters, then native Archive v3 recovery. N3S remains open.

## Owned named/alternative capture IPC — 2026-10-09

🟢 [Done] Tauri registers `capture_story_workspace_version` with a strict camelCase DTO: `workspaceId`, `operationId`, `expectedRevision`, `versionId`, `branchId`, `branchName`, `expectedBranchId`, `expectedHeadId`, `kind` and optional `label`. Only `named` and `alternative` are accepted. Native history validation and owned capture enforce identity, branch rules, selection/head/revision guards and label bounds. Rust derives the sole parent from the expected head, reads authoritative state and derives local author/time. The main window alone receives the new generated permission; the hidden renderer remains event-only.

🟢 [Done] The native result is limited to `workspaceId`, `versionId`, `branchId`, `revision`, `replayed`. The Desktop adapter requires all request fields (use explicit null label), rejects extra content/author/time/parents and unsupported kinds, freezes a prepared request, and validates exact result identity/revision/fields. Uncertain invocation errors propagate; callers must preserve the same operation ID, Version ID and guards for retries. The adapter does not manufacture a new request or silently accept a malformed response.

🟢 [Done] Runtime regression seeds validated internal history, captures a named Version, verifies Rust-derived parent and five-field receipt, rejects DTO extras, captures an alternative and replays the original capture without rewinding the newer revision. Stale revision is rejected. Three adapter regressions verify identical retry payloads, caller-spoof rejection before IPC, explicit alternatives, unexpected response rejection and propagated response-loss errors. Existing ACL manifest tests pass.

Verification: Rust **73 passed / 1 ignored**, Bun **615 passed / 25 PostgreSQL-dependent skips**, Desktop build succeeded, `git diff --check` passed. ⭕️ [Pending] Real packaged invocation and product UI adoption are unverified. 🟠 [Next] Initialization/edit/read-state and restore/reviewed-Merge dispatch, Agent-facing integration and native Archive v3 recovery remain open. The existing internal seed used in this test is not a public initializer. N3S remains unfinished.

## Connected initial/edit/read lifecycle — 2026-10-09

🟢 [Done] Main-window-only commands `initialize_story_workspace`, `edit_story_workspace` and `read_story_workspace` are registered in the handler/ACL manifest. Initial input includes validated normalized Document/Graph and first Version/Branch identity plus label, excluding caller author/time. Rust commits initial composite/history/head/selection/closure/local attribution/receipt in one transaction with expected revision zero; another operation cannot overwrite an existing Workspace. Edit DTO carries operation identity and a bounded command JSON string; the existing validator/CAS updates working state without an implicit immutable Version. Read validates the composite and obtains current selection in one SQLite reader transaction, preserving raw Snapshot bytes.

🟢 [Done] Desktop adapters normalize/detach initial input into prepared JSON for exact retries; serialize detached edit commands with strict operation fields and a 24 MiB byte ceiling; validate result identity/revision/fields; and validate full read responses/selection pairing/composite identity. Browsers cannot use these native APIs. The Desktop now declares the existing local `@komyaku/story-graph` workspace dependency; offline install updated only that workspace lock dependency.

🟢 [Done] File-backed runtime flow starts through the new initializer (no internal history seed), edits a multilingual Graph node and Path, reads working state with the unchanged original selection, captures a named Version and checks stable Rust-derived author identity. A different initialization operation cannot overwrite it. After full DB close/reopen, initial/edit/capture exact requests replay while revision 3 and exact Snapshot bytes remain unchanged; receipts remain three. Three adapter tests cover detached initial retry data, unsolicited author rejection, edited-result identity and validated native reads.

🟢 [Done] Asset verification rejects more than 5,000 unique attachments before any lookup and caps aggregate verification bytes at 512 MiB, alongside existing per-Asset bounds and integrity checks. The excessive-closure regression proves no state or receipt adoption. The aggregate ceiling is implemented; this test does not allocate a 512 MiB boundary fixture.

Verification: Rust **75 passed / 1 ignored**, Bun **618 passed / 25 PostgreSQL-dependent skips**, Desktop build succeeded, `git diff --check` passed. ⭕️ [Pending] Real packaged IPC invocation and editor UI adoption have not been verified. 🟠 [Next] Restore/reviewed-Merge dispatch, Agent orchestration and native Archive v3 recovery remain open. N3S is unfinished.
