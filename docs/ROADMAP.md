# KOMYAKU Roadmap

## Active delivery plan — 2026-09-05 revision

The execution order below overrides the historical Stage numbering and older feature priorities. See [product assessment and contracts](product/document-git-strategy.md) and [ADR-077](adr/ADR-077-document-history-first-delivery.md). Existing Done entries describe their stated foundation scope, not completion of the document-versioning product.

Latest consolidated verification: [2026-09-09 results, performance baseline and remaining gates](testing/verification-2026-09-09.md). PostgreSQL-enabled tests: 397 pass; Rust: 26 pass plus the separately executed performance fixture; browser E2E: 41 pass. These results do not close unexecuted native/platform or production gates.

- [Done] means implemented in the current codebase; for QA items, only the recorded tested scope is complete.
- [Next] means high-priority unfinished work in the local history milestone; execute in N0 → N1 → N2 → N3 order, not all at once.
- [Later] means planned, but not the closest next step. Cloud/platform release prerequisites still block those releases when reached.

### N0 — Reliable editing before history

- [Done] Introduce document-scoped edit sessions with serialized monotonic revisions, failed-write blocking, explicit retry, and isolation from a subsequently active Document.
- [Done] Cancel pending autosave and require a successful durable checkpoint before Document open, active rename/archive, Archive import, or import-conflict navigation; prevent those transitions during IME composition.
- [Done] Reload the atomically renamed active Canonical Document and its returned revision before editing continues; cover rename → next revision in the native SQLite test.
- [Done] Distinguish validated in-memory checkpoints from durable checkpoints, expose pending/saving/error/retry states in en/ja/zh-Hans, and make Cloud export checkpoint the current content before exporting the exact saved document.
- [Done] Require an explicitly durable checkpoint at the document-transition boundary and reject unsafe revision increments before writing. Automated service regressions cover non-durable receipts, failure/retry, and revision overflow; browser regressions cover persistence failure → blocked navigation → explicit retry → reload, plus IME-blocked new-document navigation and pending-edit preservation (2026-09-09, macOS Chrome; browser storage only).
- [Done] Serialize Canonical capture/hash preparation and revision persistence inside the same document save queue. A controlled Chrome regression holds an older autosave hash, adds newer text, requests navigation, and verifies navigation waits for the queue and the newer text survives reload. The test failed before the fix; this is browser evidence, not native timing QA.
- [Done] Recheck document-session identity, edit generation, and composition state after a transition checkpoint finishes; cancel the transition if input changed while waiting. Invalidate stale save announcements on new edits and show pending persistence during composition. Controlled browser regressions cover additional typing and synthetic composition-start while the transition hash is held; actual native IME conversion remains a separate gate.
- [Done] Retain a session/edit guard through Archive file reads, verification/materialization, and final draft reads; recheck immediately before adopting imported/opened content. Apply the checkpoint gate to conflict-copy import too. If an import already materialized when editing changed, refresh the library while keeping the working editor intact. Controlled browser regressions cover typing during file read and Archive verification with reload recovery; native conflict-copy and delayed IPC remain unverified.
- [Done] Apply the composition-aware durable checkpoint gate to local export and Cloud export dispatch; recheck the current edit/session immediately before download or request dispatch. A shared export service prevents delivery after edits during asynchronous archive construction. Service tests cover dirty-checkpoint ordering, composition refusal, non-durable refusal and delayed-build cancellation. Local v1 still exports the current immutable Version while TXT/Markdown export the checkpointed draft; native download/dirty-export UI and Cloud request completion remain separate verification scope.
- [Done] Verify packaged macOS TXT/Markdown/v1 export through the actual history controls and downloaded files; add a read-only SQLite/file comparison script that checks draft bytes, immutable Version hash and Archive content. Confirm post-Version draft edits occur only in TXT/Markdown and stale TXT is rejected by the script. See [file-level evidence and remaining timing gates](testing/export-packaged-files.md).
- [Done] Correct en/ja/zh-Hans export completion copy to report download initiation rather than confirmed filesystem persistence. Add failure-path tests for preparation, archive construction and delivery rejection, plus blob-URL cleanup on a failed download request. Browser download cancellation and disk-full outcomes remain unobservable with the current anchor-based adapter.
- [Done] Add an exclusive UI mutation gate for rename and restore: refuse entry during composition, mark the workspace inert while applying the operation, expose an en/ja/zh-Hans progress message outside the inert region, and release on success or failure. Starting a mutation invalidates earlier import/open/export adoption guards. Restore now uses the durable transition checkpoint and checks its guard before native dispatch. Unit tests cover overlap refusal and retry after failure; delayed native UI and already-running asynchronous insertion remain separate QA scope.
- [Done] Bind asynchronous image/file insertion to its starting EditorView and document/mutation session; check after file reads and before insertion, rejecting replaced/destroyed views, composition and intervening rename/restore. Reset insertion feedback on document/workspace changes and avoid showing old completion errors in a new view. Delayed helper tests cover replaced/destroyed views and invalidated mutation sessions; staged Asset reclamation and native timed insertion scenarios remain separate scope.
- [Done] Retain Cloud PNG/text-file staging cleanup outside serializable Node attributes and release the exact upload reference when the final pre-insertion guard rejects adoption. Successful insertion retains its reference; uncertain editor transaction failures do not release a possibly adopted reference. Tests cover both media paths, cleanup failure and uncertain transaction outcomes. No Asset bytes are deleted; offline cleanup reconciliation and local staged-Asset lifecycle remain separate verification scope.
- [Done] Verify abandoned local PNG retention through the 24-hour boundary, file-backed SQLite close/reopen, quarantine listing and checkpoint-based reinsertion. The native regression compares every byte and reference count: pending with no reference before the boundary, quarantined with zero references after a qualifying checkpoint, active with one reference after recovery. This uses fixture timestamps and direct native functions, not a 24-hour wall-clock or packaged-UI pass.
- [Done] Retry Cloud staging-reference release on transient network/HTTP failures with the same captured session/workspace/asset/reference identity, at most three attempts and bounded backoff. Honor short Retry-After and stop rather than retry early for longer values; do not retry authorization/permanent errors. Applies to rejected preparation and cancelled adoption for PNG/text files. Unit tests cover lost-response replay, limits and permanent failures. This in-request retry is supplemented by the persisted release-intent queue below.
- [Done] Persist explicit Cloud reference-release intent in bounded local storage before dispatch, containing only Workspace/Asset/reference IDs under an API-authority-specific key. After a successful authenticated document-reference checkpoint, retry at most 20 matching-Workspace items using the current token; remove only successful releases, retain failed items and stop the batch. Tests cover queue reopening, authority/Workspace isolation, secret exclusion, pre-request recording, batch limits and corrupt-record preservation. Actual packaged offline/relaunch QA remains pending; unavailable/full local storage means durable cleanup cannot be guaranteed, and uploads interrupted before release intent is recorded still require server reconciliation.
- [Done] Run persisted reference cleanup in the background after successful Cloud reference reconciliation, without delaying the checkpoint receipt. Coalesce simultaneous cleanup triggers by API authority and Workspace within the process; release the running-batch slot on completion/failure. Tests cover pending cleanup versus save completion, failed-checkpoint refusal and duplicate-batch suppression. Cross-process coordination and packaged offline/relaunch verification remain separate scope.
- [Done] Rotate a failed cleanup item to the tail without deleting it, then stop the current batch; subsequent checkpoint-triggered batches can reach other items. Add a real two-process regression using a temporary file-backed Storage adapter: mocked offline release persists intent, the first process exits, and a fresh process reopens/drains with a fresh token while no token appears on disk. This verifies process-lifetime independence of the queue contract, not packaged WebView localStorage or a live Cloud outage.
- [Done] Add native SQLite regressions for rename → rejection of a delayed stale draft → multilingual edit → file database close/reopen → continued edit; inject failures between draft/metadata writes to verify draft-save and rename rollback plus same-revision retry. These test the Rust persistence functions directly, not packaged WebView/IPC or process-crash recovery.
- [Done] Add an isolated History QA bundle with native application-identity gating; verify real macOS Tauri IPC save → rename → stale-save rejection → multilingual edit → v1 snapshot verification, then full application quit/relaunch and exact read-only recovery. See [recorded scope and reproduction](testing/history-packaged-restart-recovery.md). This harness bypasses editor controls and does not establish the UI scenarios below.
- [Done] Add an isolated Editing QA bundle opening the ordinary product workspace; verify packaged macOS active rename → further edit → new document → library navigation → full quit/relaunch, preserving both document texts and the renamed title. See [actual UI evidence and timing limits](testing/editing-packaged-restart-recovery.md).
- [Done] Inject native SQLite Archive import failures at draft creation, Asset-reference creation, and the final import receipt. Verify complete rollback of the imported Document/draft/Asset/reference/receipt, exact preservation of an existing draft and revision, then successful retry with the same identities/digest and exact Asset bytes followed by idempotent replay. All 25 native library tests pass (2026-09-09). This directly tests SQLite transactions, not packaged UI timing, disk-full behavior, or process-crash recovery.
- [Done] Verify packaged macOS SQLite write failure → blocked new-document navigation with unsaved editor text retained → explicit UI retry → full quit/relaunch with the same final artifact. Confirm failed writes preserve the prior database revision/content and never show saved success; remove the temporary QA-only failure trigger afterward. Correct shared checkpoint failure copy in en/ja/zh-Hans to include saving failures. See [native failure/retry evidence and limits](testing/editing-packaged-restart-recovery.md#native-save-failure-and-retry--2026-09-09).
- [Done] Route initial/named/alternative Version creation through the composition-aware durable transition checkpoint and exclusive mutation gate. Recheck the edit/session guard after history lookup and keep the workspace inert through Version persistence. Four browser regressions cover named/alternative refusal during composition followed by success after composition, latest-draft capture with a held write, and cancellation when composition begins during held history reads. Only the native history adapter is substituted; actual platform IME and native Version IPC timing remain separate QA scope.
- [Done] Inject native restore failures at draft update and the final operation receipt. Verify rollback preserves exact working-draft bytes/revision, current Version and Branch head, Version/parent/operation counts, and active PNG bytes/reference. Retry the identical restore operation successfully, verify idempotent replay and restored draft revision, and confirm the removed draft-only PNG is quarantined without deleting bytes. All 26 native library tests pass; this exercises SQLite functions directly, not packaged restore controls or crash recovery.
- [Done] Put library Archive/unarchive actions through the shared exclusive mutation gate, including composition refusal and guaranteed unlock after failure. Three browser regressions hold the library adapter operation, reject queued duplicate Archive/rename actions, verify success/failure unlock and retry, and verify composition refusal followed by successful Archive. Native library IPC is substituted in these tests; packaged operation timing and unarchive interaction QA remain separate scope.
- [Next] Add packaged-app regressions for switching/importing during pending autosave, composition during navigation/Version creation, and export during dirty state on the supported native hosts. Expand failed-persistence QA to library-open/import/restore paths. Repeat rename/edit and other applicable scenarios on each additional distributed platform.

Exit: packaged macOS and automated regressions preserve text/title/revision through the scenarios above and restart. Failed writes never display saved success. Other platforms require their own native passes before release.

### N1 — Local history engine and independent export

- [Done] Implement the pure Version/parent/Branch domain foundation with deterministic Canonical snapshot encoding, authored-Unicode preservation, DAG and restore validation, and expected-head Branch advancement in `version-engine`.
- [Done] Persist Versions, ordered parent Edges, Branch heads, current Document pointers, and idempotency fingerprints in one native SQLite transaction with expected-head compare-and-swap and persisted snapshot-hash readback.
- [Done] Expose the persistence operation only to the main Tauri window through a validated Desktop adapter and generated command capability.
- [Done] Implement initial version, named-version save, and create/switch alternative operations in the packaged Desktop app. The local history panel reads bounded metadata, and exact Snapshot reads recheck SHA-256 before parsing Canonical content.
- [Done] Implement restore-as-new-version so the restored immutable Version, Branch head, working draft, revision, Document metadata, and Asset-reference lifecycle change in one native transaction. Branch drafts, recovery snapshots, and immutable Versions remain distinct.
- [Done] Protect historical Asset references transactionally for both local preview and imported Archive Assets; removing an Asset from the current draft cannot quarantine bytes still referenced by an immutable Version.
- [Done] Add account-free TXT/Markdown export with explicit fidelity warnings and `.komyaku` v1 single-document Snapshot export. Exact Version Snapshot and Asset bytes are reread from native storage, SHA-256 verified, written, and verified again before download. Keep v1 labeled as a single-document export, not a full-history backup.

Exit: create A → B, branch from A to C, restore A as child of B, restart and inspect all parents/content/Assets. Crash/retry and two stale head updates neither corrupt the graph nor silently discard an alternative. Local snapshot export works with networking disabled.

### N2 — The first usable document-history workflow

- [Done] Add the first translated local history workflow with history list, named alternatives, restore, two-Version selection, comparison, and account-free export in the existing workbench.
- [Done] Replace the default two-replica demo with a single-editor workspace and safe new-document action; retain the two-replica workbench at `?workbench=1` and in Preview QA. Existing durable saved-state feedback remains visible.
- [Done] Add visible undo/redo controls backed by the existing local Yjs undo plugin. Replacing the working document recreates the editor view, keeping undo history scoped to the opened/restored Document session.
- [Done] Implement stable-Node-ID structure comparison with grapheme-safe text replacement spans, explicit additions/removals/moves/format changes, source comparison for Math/Mermaid, and identity/hash metadata comparison for Assets. Exact Snapshots are verified before comparison.
- [Done] Scope asynchronous history and comparison results to their starting edit session and latest request sequence. Ignore both success and failure from obsolete requests so switching Documents cannot display the previous Document's history, diff, or error state. Browser regressions hold history/comparison adapter responses across real new-document navigation and verify all four late success/failure cases; native IPC timing remains separate scope.
- [Done] Apply latest-request ordering to library refreshes so a delayed pre-Archive list cannot restore stale active-state feedback, and a delayed failure cannot clear a newer successful list. Two browser regressions hold the pre-mutation list across a real Archive UI action and verify late success/failure preserve the archived entry. All five library mutation browser tests pass; native list IPC is substituted.
- [Done] Restore the initiating control's focus after the mutation lock is removed, only if it remains connected and focus has fallen back to the document body. Real Tab/Enter/Shift+Tab browser regressions failed before this fix and pass afterward for Archive success and failure, preserving keyboard continuation to Rename. All seven library mutation browser tests pass. Native WebView focus behavior and other mutation controls still need their own interaction passes.
- [Done] Add four keyboard-only form regressions for named Version and alternative creation, each with successful and failed writes. Tab to the input, type its name, Tab/Enter to submit, verify focus returns to the button, preserve the name on failure, retry with the identical name, clear on success, and Shift+Tab back to the input. Native Version storage is substituted; these are Chrome interaction checks, not native IME or persistence evidence.
- [Done] Complete Chrome keyboard regressions for initial Version creation, restore and comparison. Add a stable history-heading focus fallback when controls disappear and defer focus until the next animation frame after unlocking. Final packaged macOS Tab/Return checks confirm initial creation and restore return focus to the heading, the next Tab reaches the name field, and Archive/unarchive retain button focus. See the consolidated verification record for native scope and limitations.
- [Done] Add a visual document-lineage graph over the ordinary Version list. It derives up to six compact display lanes from Branch heads and ordered parent edges, marks the current position, keeps every Branch name on its head, measures real row positions for wrapped translated content, and extends across incrementally loaded pages. Additional logical lanes reuse the bounded display lanes without changing persisted relationships. The list remains semantic and usable without the decorative SVG.
- [Next] Repeat the graph and remaining keyboard/language/viewport flows on native hosts. The translated comparison controls and lineage graph already adapt to narrow browser widths.
- [Done] Run a real SQLite 100k-ASCII-grapheme/1,000-Version/20-Branch fixture, plus a separate multilingual 100k-grapheme encoding/Diff/v1 Archive fixture; record timings, byte sizes and sampled memory. The first run exposed a 500-Version browsing cap without data loss.
- [Done] Replace the 500-Version cap with a bounded 100-item `(created_at, Version ID)` cursor. The UI reveals 10 older Versions at a time, fetches another native page only when needed, rejects duplicate/out-of-order pages, and can compare or restore a Version older than the first page. A descending compound SQLite index supports the access path. Same-timestamp Rust coverage, adapter coverage, and narrow-width Playwright coverage prevent gaps, duplicates, and horizontal overflow.
- [Done] Fix reference-fixture acceptance budgets before further optimization: 25 ms Version-save p95, 10 ms first-page list p95, 25 ms reopen plus first page, 100 ms complete ten-page traversal, and 128 MiB database size for the Apple M4 debug fixture. The 2026-09-12 run passed all five budgets; these do not certify packaged UI startup or memory.
- [Done] Add a repeatable macOS packaged-app harness that launches only the dedicated Editing QA bundle five times, detects its first on-screen window, samples process-family RSS after three idle seconds, enforces predeclared 3-second/512-MiB p95 budgets, and leaves no QA process running. The package-script verification measured 275.29 ms startup p95 and 131,186,688-byte settled RSS p95 on Apple M4. This does not replace release-build or other-host measurements.
- [Next] Run the target-user task trial. Actual pilot users and full-history Archive functionality remain separate requirements.

Exit: target users can save, branch, compare and restore without learning Git terms; initial trial target is 4 of 5 unassisted completions and zero observed data loss. This is a usability gate, not market validation.

### N3 — Reviewed integration and portable history

- [Next] Implement 3-way base/ours/theirs comparison with explicit delete/edit, move, text and metadata conflicts. Preview user-selected/manual results before a two-parent merge; fail clearly on unsupported ambiguous merge bases.
- [Done] Publish History Archive v2 as a new major contract with a reference reader/writer, JSON Schema, exact Version Snapshot bytes, ordered parents, Branch/current pointers, complete historical Asset closure, SHA-256 verification, fixed resource limits, explicit collision policy, and deterministic two-Branch fixtures. The separate v1 reader remains available and rejects v2 instead of discarding its history.
- [Done] Add account-free Desktop History Archive export. It traverses every bounded history page, rereads and verifies every immutable Snapshot and Version Asset with at most four concurrent native requests, deduplicates exact Asset bytes, rechecks Branch heads for concurrent changes, creates v2, verifies it again, and only then initiates the local download. Service tests retain a root-only Asset and a browser test exercises the real v2 writer/reader through the visible export control.
- [Next] Materialize a verified v2 History Archive atomically into an empty profile, compare every Version byte/parent/Branch/Asset after restart, and reject identity collisions or injected storage failures without partial adoption.
- [Next] Complete a two-week opt-in pilot of recurring history use and full restart/export recovery. Record whether users actually revisit, compare, adopt, or restore alternatives.

Exit: public local Alpha requires N0–N3 plus native QA for each distributed platform. Private N2 trials must disclose missing full-history export/merge. Do not expand scope solely because infrastructure tests pass.

### N4 — Cloud and asynchronous review after validation

- [Later] Version upload/download, resumable durable queue, head compare-and-swap, idempotent retries, and conflict alternatives that preserve both devices' histories.
- [Later] Version-bound review proposals/comments and author-approved adoption before production real-time collaboration.
- [Later] Re-run Cloud production gates below, including independent review, backup restoration and deployment-topology validation, before public Cloud release.
- [Later] Add billing, managed AI, math recognition, academic exports, additional media, and external storage providers only against observed demand.

### 日本語の実行方針

- [Later] KOMYAKU本体完成後、独立サンプルアプリStory Graphを `samples/story-graph/` で開発する。[専用Roadmap](../samples/story-graph/ROADMAP.md)と[設計原案](Story-Graph設計仕様書.md)を参照。本体の現在の完成条件には追加しない。

文書・添付保全の基盤は活かし、保存整合性 → ローカルの版と別案 → 比較・復元の画面 → 確認付き統合と履歴持ち出し → Cloudの順に進める。Math Paletteを含む新規周辺機能は後段。詳細な判断根拠は上記の評価文書を参照する。

### 简体中文执行方针

保留文档和附件保护基础，按可靠保存 → 本地版本与备选方案 → 比较与恢复界面 → 人工确认合并及完整历史导出 → Cloud的顺序推进。数学面板等扩展功能后移。下方原有阶段保留作为实现清单，不代表当前执行顺序。

## Historical implementation inventory

## Stage 1 — Foundation

Stage status: [Done] Foundation complete

- [Done] Bun workspace and repository structure
- [Done] Bun 1.4.0 workspace pin and reproducible `oven/bun:1.4.0` Linux server build/runtime image
- [Done] React, Vite, and Tauri 2 shell
- [Done] Bun and Hono API shell
- [Done] Japanese, English, and Simplified Chinese i18n baseline
- [Done] PostgreSQL and S3-compatible local service configuration
- [Done] Default AI training refusal signals and privacy documentation
- [Done] Local-first Freemium, Plan, Quota, and Entitlement architecture
- [Done] Single-server Modular Monolith and horizontal-scaling architecture
- [Done] Conversation Archive and provider-independent AI Handoff architecture
- [Done] PostgreSQL Migration Runner with advisory locking and idempotent replay
- [Done] Tauri SQLite plugin and local-first schema foundation
- [Done] ProseMirror editor schema foundation
- [Done] Canonical Conversation schema and AI Handoff review package
- [Done] S3-compatible immutable storage client and local bucket initializer
- [Done] Raw conversation archive service and generic JSON importer
- [Done] Structured logging configuration and fail-fast production environment validation
- [Done] Provider-independent Plan catalog and Entitlement key package
- [Done] PostgreSQL Transactional Outbox dispatcher with leases and idempotent Job creation
- [Done] Durable Job Runner, attempt history, lease recovery, and conversation archive verification
- [Done] Mutation idempotency middleware and audited Dead Letter service boundary
- [Done] Controlled Operator CLI, dead-letter pagination, and audited retention policy

## Stage 2 — Identity

Stage status: [Done] Identity engineering complete; production launch gates remain below

- [Done] User, session, workspace, project, asset, and conversation database schema
- [Done] Identity repositories, personal workspace transaction, and password authentication
- [Done] Hashed session tokens, revocation service, and Bearer authentication middleware
- [Done] PostgreSQL distributed authentication rate limits and HMAC-protected identifiers
- [Done] Single-use email verification and password reset token domain flows
- [Done] SMTP notification adapter and feature-gated, rate-limited public authentication routes
- [Done] Encrypted transactional notification delivery, retry reconciliation, and reproducible local authentication endpoint load harness
- [Done] Isolated production-like PostgreSQL/SMTP load test, internal engineering review, and external-review package
- [Later] Workspace subscription and Usage Meter schema
- [Later] Passkey, OAuth, MFA, OIDC, SAML, and SCIM extension points
- [Later] Re-evaluate TanStack Start v1 for a separate Cloud Web app; keep Tauri Desktop on Vite SPA until validated

## Production Launch Gates

- [Done] XServer VPS Cloud small-start topology selected: one 4GB App VPS, 10GB Managed PostgreSQL with seven-day daily backup, external S3-compatible Asset storage, measured NFS/L4 adoption, and HTTPS-or-queue-only external Workers; see `docs/adr/ADR-074-xserver-vps-cloud-small-start.md`
- [Later] User environment required: repeat representative load and failure tests in the intended TLS/proxy, PostgreSQL, SMTP-provider, monitoring, and backup topology
- [Later] Independent reviewer required: external security review, remediation, and retest using `docs/security/stage2-external-review-package.md`

## Stage 3 — Structured Document MVP

- [Done] Canonical Document Schema v1 with stable Node IDs, schema versioning, metadata, and language/direction attributes
- [Done] First-class Text, Heading, List, Table, Image, Math/LaTeX, Code, Basic SVG/Mermaid, and Generic File nodes
- [Done] Separate canonical source, render representation, Asset references, and provenance; never make previews the source of truth
- [Done] Workspace-scoped content-addressed Asset storage foundation, immutable originals, safe deduplication, and reference accounting
- [Done] Bounded Asset orphan reconciliation and audited reference-zero quarantine/retention GC foundation
- [Done] Leased media inspection state machine, conservative signature policy, and authenticated short-lived attachment reads
- [Done] Inline preview isolation and published/archive/legal retention holds for the current decoder-inspected PNG and complete-input text safe profile
- [Later] Production malware scanner and quota metering before expanding uploads to broader binary formats or enabling commercial Cloud limits
- [Done] Deny-by-default static preview Descriptor and sandboxed iframe boundary, plus bounded script-free KaTeX-to-MathML rendering for untrusted LaTeX
- [Done] Bounded Basic SVG XML parser and new-document allowlist sanitizer excluding active content, foreign namespaces, events, styles, animation, and external resources
- [Done] Pinned Mermaid 11.17.2 parser and isolated Renderer Adapter contract with fixed secure configuration, authored-config/interaction/style rejection, budgets, and mandatory SVG re-sanitization
- [Done] Capability-minimized hidden Mermaid WebView with explicit Tauri application-command ACL, fail-closed runtime application-command and direct SQL canaries, event-only bounded transport, lazy renderer loading, timeout/backpressure, timeout-triggered WebView recreation, and mandatory SVG re-sanitization
- [Done] Mermaid Diagram NodeView integration retaining visible Canonical source, script-free static iframe output, localized fail-closed Web fallback, and responsive layout
- [Done] Isolated-profile packaged macOS Mermaid QA covering live static rendering, malformed and forbidden-source rejection, fail-closed application-command/SQL readiness canaries, full quit/relaunch recovery, and deterministic timeout → WebView recreation → post-recovery rendering
- [Done] Accepted-PNG static Descriptor foundation requiring inspected MIME, exact byte size, inspection-confirmed dimensions, 256 KiB encoded and 16 MP decoded budgets, data-only CSP, and an empty iframe sandbox
- [Done] Server-only decoder-backed PNG inspection with a 1 MiB complete-input budget, 16 MP libvips limit, full raw decode, persisted inspected dimensions, lease-safe completion, and opaque failure handling
- [Done] Authorized Cloud PNG preview-byte proxy and Desktop Resolver with Workspace membership, exact inspection policy, 256 KiB limit, immutable SHA-256 recheck, no-store binary response, no Object Storage URL exposure, and memory-only Session use
- [Done] Local SQLite accepted-PNG preview cache, byte length/SHA-256 revalidation, lazy Descriptor loading, and localized Image NodeView retaining visible Asset identity and alternative text on failure
- [Done] Decoder-verified local PNG insertion with capability-scoped native command, bounded full decode, atomic/idempotent SQLite cache write, required alternative text, and Canonical Image Node creation only after durable acceptance
- [Done] Centralized editor Workspace preview state selecting either the Local Resolver or a Cloud Resolver bound to one memory-only Session and Workspace, with no cross-authority fallback
- [Done] Isolated-profile packaged macOS Image QA covering decoder-verified native insertion, Yjs replication, explicit durable Canonical checkpoint, complete process quit, SQLite reopen, stable Image Node recovery, and restored static preview without Asset rewrite
- [Done] Atomic local document-to-Asset reference accounting with pending/active/quarantined/legacy lifecycle, 24-hour insertion grace, final-reference quarantine, stale-revision rollback, migration-era protection, and no destructive byte deletion
- [Done] Accessible Image Node metadata authoring with required alternative text, optional visible plain-text captions, stable-Node-ID ProseMirror transactions, Yjs replica synchronization, Canonical restart recovery, and rich-caption preservation
- [Done] Structured rich Image caption authoring for marked text, hard breaks, and stable-ID inline LaTeX, with bounded Canonical validation, reordering, Yjs synchronization, and exact restart recovery
- [Done] Authenticated Cloud PNG insertion with preallocated stable Node identity, exact-byte content-addressed upload, bounded asynchronous decoder inspection, accepted-only Canonical insertion, authorized static preview, and failed-staging reference release
- [Done] Authenticated Cloud immutable text-original insertion for TXT, Markdown, CSV, Mermaid, and JSON with stable File Node identity, 1 MiB complete-input inspection, multilingual display filenames, accepted-only Canonical insertion, and failed-staging reference release
- [Done] Revision-monotonic Cloud document-to-Asset checkpoint reconciliation with Document-bound upload references, deterministic digests, accepted-reference validation, transactional stale-reference release, idempotent replay, and multi-replica PostgreSQL locking
- [Done] Explicit local Asset quarantine management with a bounded metadata-only native list, localized responsive UI, required recovery alternative text, non-destructive reinsertion, and checkpoint-gated reactivation
- [Done] Packaged macOS Mermaid pressure/backpressure QA covering pre-IPC source rejection, permitted 200-edge rendering, exact eight-request reservation, ninth-request busy rejection, timeout-wide fail-closed cleanup, hidden WebView recreation, and post-pressure recovery
- [Later] Windows/Linux hosts required: WebView2/WebKitGTK packaged pressure passes and remaining platform-specific sensitive-command denial probes
- [Later] JPEG/WebP still-image policies, animated-image policy, and isolated PDF rasterization/viewing using the gates in `docs/architecture/isolated-content-previews.md`
- [Done] Structured editor feasibility view, validated Canonical local autosave, page/app restart recovery, and Japanese/English/Simplified Chinese UI
- [Done] Export-gated Asset retention safety with digest-bound verified export/archive evidence, evidence invalidation, publication/legal holds, fail-closed SQL claims, defense-in-depth purge capability, audited operator controls, and disabled automatic orphan deletion
- [Done] Automated open `.komyaku` v1 export with deterministic store-only ZIP, strict manifest, Canonical/Asset-set validation, immutable write, persisted reread, full CRC32/SHA-256 verification, automatic retention evidence, and localized Cloud workflow
- [Done] Authorized `.komyaku` export listing, 60-second forced download, transactional export/evidence invalidation, and fail-closed local Canonical recovery through the public Reader
- [Done] Atomic Cloud Archive Asset materialization with full reread verification, bounded media inspection, content-addressed Asset identity remapping, source/render references, transactional Document publication and audit, digest replay, and Document-ID conflict rejection
- [Done] Atomic Local SQLite Archive materialization with exact Asset-set verification, native SHA-256 and media reinspection, content-hash deduplication and ID remapping, transactional Document/Asset/reference publication, PNG preview adoption, lifecycle tracking, and digest replay
- [Done] Production Local Document Library workflow with bounded inventory, multi-document navigation, Canonical-aware rename, Archive/restore controls, source Archive digest inventory, and explicit import-conflict choices to open existing or create a fresh-identity copy
- [Later] Expand Generic File originals beyond inspected text after production malware scanning and format-specific parser/decoder policies
- [Done] Headless Yjs and `y-prosemirror` working-state foundation covering concurrent convergence, state-vector offline rejoin, stable Node IDs, deterministic Canonical checkpoints, bounded updates, and selective local undo
- [Done] Browser two-replica feasibility view with live Yjs synchronization, disconnect/reconnect lifecycle, Relative Position selection capture/restore path, composition-safe checkpoints, accessible labels, and responsive layouts
- [Done] Automated browser regression coverage for collaboration, composition lifecycle, restart recovery, and responsive layout
- [Done] Packaged Tauri Japanese IME composition, conversion, SQLite restart recovery, and exact Relative Position caret restoration pass on macOS
- [Done] Packaged Tauri Simplified Chinese Pinyin composition, candidate conversion, Yjs replication, SQLite autosave, full quit/relaunch recovery, and exact Relative Position caret restoration pass on macOS
- [Done] Canonical Schema migration boundary, ProseMirror adapters, and round-trip fixtures that preserve compatible metadata
- [Later] Reusable compact Math Palette with localized command registry, placeholder-aware LaTeX templates, selection wrapping, isolated preview, keyboard/focus accessibility, and Support App/Desktop Equation integration
- [Later] Local handwriting stroke canvas, reviewed LaTeX candidate flow, and provenance-preserving Equation insertion
- [Later] Benchmark UniMERNet Tiny/Small and alternative mathematical-expression-recognition models in an isolated normal-VPS Worker, then add explicit-consent Cloud recognition without direct Managed PostgreSQL access
- [Later] Academic submission export foundation with versioned destination profiles, deterministic LaTeX/BibTeX/Figure bundles, isolated reproducible PDF compilation, double-blind metadata checks, readiness reports, and user-controlled download without automatic final submission
- [Later] Verified destination-specific adapters for current official journal/conference requirements, followed by JATS XML, DOCX, MathML, camera-ready, and supplementary research packages
- [Later] Native table editing, full LaTeX documents, richer SVG authoring, and PDF inspection

## Stage 4 — Document Evolution and Diff (now prioritized by N1–N3)

- [Next] Immutable Document Version DAG and object snapshots
- [Later] Node lineage derived from stable Node IDs, with optional content hashes and materialized Node revision projections
- [Later] Change-kind metadata: TEXT, MATH, DIAGRAM, IMAGE, TABLE, CODE, ASSET, and STRUCTURE
- [Later] Version Graph with icon/shape labels that do not rely on color alone
- [Later] Diff dispatcher with Text, Math source, Diagram, Image, Table, Code, and Binary Asset engines
- [Next] Grapheme-safe Text/LaTeX/Mermaid Diff and binary added/replaced/deleted/hash/size comparison
- [Next] Local recovery snapshots and explicit alternative branches; see N0–N2
- [Later] Cloud offline sync queue execution and multi-device conflict branches; see N4
- [Done] Publish the open `.komyaku` Archive v1 specification, manifest schema, deterministic minimal fixture, security limits, and compatibility policy alongside its first writer/reader
- [Next] Specify and implement a new major history Archive with immutable Version DAG, branches, merges, and conformance fixtures; retain v1 import support and explicit unsupported-major rejection in old readers (N3)
- [Next] Account-free local export and empty-environment restoration of complete history and Assets (N1/N3)

## Collaborative Editing and Local-first Sync

- [Done] Define and test the explicit Yjs working-state to validated Canonical Document checkpoint boundary; keep immutable Version commits as a separate application-service operation
- [Done] Persist validated Canonical drafts locally with monotonic revisions, composition-safe autosave, fail-closed restoration, and browser restart tests
- [Done] Save the Tauri local document shell and validated Canonical draft through one Rust-side SQLite transaction with atomic stale-revision rejection
- [Later] Durable local working-state persistence and offline update queue with bounded recovery and compaction
- [Later] Authenticated Provider adapters with Workspace/Document authorization, state-vector differential sync, idempotent update persistence, quotas, and update-size/rate limits
- [Done] Origin-aware local UndoManager foundation that excludes remote, AI, import, migration, and system-normalization transactions by default
- [Next] Connect selective undo/redo to the editor UI with translated labels and accessibility announcements
- [Later] Relative Position cursors and selections plus durable comment anchors using stable Node IDs and quoted/context fallback
- [Later] Ephemeral privacy-minimized Awareness with TTL; exclude Presence from Versions, archives, backups, search, and analytics
- [Later] Multi-replica room routing, shared persistence, compaction workers, and collaboration load/failure tests without relying on sticky sessions for correctness
- [Later] Publish optional versioned session-recovery data only as a non-authoritative `.komyaku` extension; archives must remain readable without Yjs

## Stage 5 — Semantic and Visual Content History

- [Later] Editable Diagram canonical model with nodes, edges, labels, positions, styles, and SVG preview artifacts
- [Later] Math AST/MathML normalization and semantic Math Diff while preserving authored LaTeX
- [Later] Diagram node/edge Diff, SVG structural Diff, and image side-by-side/overlay comparison
- [Later] Original/preview relationships for layered illustrations and externally edited design assets
- [Later] Search and filtering by Node lineage, content type, Figure, Equation, and change kind

## Stage 6 — Specialized Design and Media

- [Later] Read-only preview and metadata adapters for selected CAD/3D formats without building a native CAD editor
- [Later] External-editor references and version provenance for DXF, DWG, STEP, GLTF, OBJ, PSD, and similar source files
- [Later] Audio, video, and specialized scientific-data nodes based on measured user demand

## Commercialization and Scale

- [Later] Free Cloud / Personal / Pro subscription flow
- [Later] Team seat billing, Enterprise contracts, and Long-term Archive
- [Later] Metered AI and Developer API billing
- [Later] Separate Worker process and durable queue adapter
- [Later] Horizontal API / Worker replicas behind a load balancer
- [Later] PostgreSQL HA, read replicas, and partitioning based on measured load

## User-owned External Providers

- [Later] Provider-neutral ExternalProviderConnection model separating Local, KOMYAKU Cloud, and user-owned targets
- [Later] Google Drive “My Google Cloud Project” wizard using a user-owned Desktop OAuth Client, system browser, PKCE, loopback callback, and `drive.file`
- [Later] Platform secure token storage, revocation, reconnect, scope-loss handling, redacted diagnostics, and security review
- [Later] Optional KOMYAKU-managed Google OAuth connection after product, policy, verification, and operational review
- [Later] Additional connectors such as WebDAV, user-owned S3, Dropbox, and OneDrive based on demand; do not generalize unlike credential types into one input
- [Later] Individually reviewed GCP capabilities beyond Drive; Service Accounts, API keys, and organization-wide access require separate threat models

## Conversation Archive and AI Handoff

- [Done] Raw conversation archive metadata verification job
- [Done] Authenticated, idempotent Generic JSON conversation import and status API
- [Done] Bounded Conversation Import orphan-object reconciliation with canonical-key validation, database ownership comparison, non-destructive quarantine/recovery records, pagination, operator audit, and maintenance CLI
- [Done] Versioned ChatGPT mapping, Claude chat_messages, structured Gemini, and Gemini My Activity adapter foundation with maintained synthetic export fixtures
- [Done] Atomic Cloud persistence and authenticated API for multi-conversation provider export bundles
- [Done] On-device Provider export selection UI with localized preview, provider override, provenance summary, and explicit partial-import warning review
- [Done] Authenticated Workspace connection and explicit confirmation that submits the reviewed exact bytes to the Cloud import API
- [Done] Opt-in durable Tauri session storage through OS credential stores, startup revalidation, revocation handling, and a persisted threat model
- [Done] Local/BYOK AI provider gateway foundation with single-branch selection, dual review hashes, bounded OpenAI-compatible transport, and immutable continuation branches
- [Done] Desktop AI Handoff review UI with exact single-branch disclosure, dual hashes, explicit one-send consent, Local/BYOK connection setup, and OS-secured Provider credential registration
- [Done] Bounded OpenAI-compatible Provider model discovery with send-time credential resolution, duplicate removal, localized selection UI, and manual Model ID fallback
- [Done] On-device selected-branch sensitive-data detection with value-free findings, explicit outbound-copy masking, immutable archive preservation, and localized review UI
- [Done] Bounded OpenAI-compatible SSE streaming with incremental Desktop display, Abort cancellation, strict event validation, and complete-response-only branch creation
- [Done] Packaged Tauri transactional persistence of completed AI Handoff, assistant Message, `ai_continuation` Edge, and Canonical Conversation in one SQLite commit, with idempotent replay and save-only retry
- [Done] Privacy-bounded Local Conversation library with startup enumeration, metadata-only summaries, explicit one-conversation loading, and validated Canonical restoration
- [Done] Cloud PostgreSQL transactional persistence foundation for completed Handoff, assistant Message, continuation Edge, dual hashes, Conversation timestamp, and ID-only Outbox event, with in-transaction authorization and Branch validation
- [Done] Authenticated, 1 MiB-bounded, no-store, idempotent Cloud Handoff API with workspace-scoped replay lookup and stable authorization/conflict errors
- [Done] Real PostgreSQL Cloud Handoff integration coverage for migration 0011, atomic Message／Edge／Handoff／Outbox commit, UUID array encoding, and idempotent replay
- [Done] Workspace-scoped deterministic UUIDv5 import identity v1 across Generic JSON, ChatGPT, Claude, structured Gemini, and Gemini My Activity, with Parser 1.1.0 and cross-Workspace collision isolation
- [Done] Desktop opt-in Cloud synchronization using an exact-byte Workspace-scoped reparse, explicit metadata-only Cloud Provider Connection selection, Local-first persistence, and idempotent Cloud save-only retry
- [Done] File-backed SQLite close/reopen regression for completed AI Handoff recovery, with metadata and Canonical Branch verification
- [Later] Interactive OS access required: packaged-app quit/relaunch and native credential-store QA on macOS, Windows, and Linux; use `docs/testing/ai-handoff-restart-recovery.md`
- [Later] Managed AI credits and Workspace AI connections
