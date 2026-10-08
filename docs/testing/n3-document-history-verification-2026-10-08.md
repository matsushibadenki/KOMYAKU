# N3 Document history block verification — 2026-10-08

[Done] Available macOS Document-history implementation and native exit gates are complete. [Pending] Actual IME conversion, other native platforms and a pilot-user trial remain unverified. Composite Story Workspace runtime is a separate **N3S [Next]** requirement, still necessary for the combined public Alpha. This record verifies v2 Document history; it does not claim Graph/Path transport by v2.

## Environment and checks

The flow under test is: ordinary workspace → keyboard review/edit/diff/adoption → full-history export → full quit → previously unused receiver profile → file-picker import → full quit/relaunch → inspect every recovered Version and Asset.

| Check | Result |
| --- | --- |
| Page identity and meaningful content | [Done] `tauri://localhost/`, ordinary KOMYAKU Workflow QA / Archive Receiver QA editor/library/history controls |
| Framework overlay | [Done] None visible in inspected screens |
| Console audit | [Pending] Native console logs were not captured |
| Native keyboard adoption | [Done] Confirmed multilingual result, two ordered parents and usable focus after saving |
| Screenshot evidence | [Done] CUA displayed narrow export feedback and the recovered wide lineage graph with Branch badges/current position |
| Exact Archive/native recovery | [Done] Seven Version Snapshots/hashes, seven ordered parent rows, three Branch heads/names, every historical Asset byte |

macOS arm64 debug Tauri WebView; source window 390×844, receiver window 1000×900. Browser plugin not available; CUA operates native apps, and the repository Playwright suite supplies separate browser regression evidence. The native operations use production adapters/IPC/SQLite, not mock history storage. Profiles are `app.komyaku.desktop.workflow-qa` and `app.komyaku.desktop.archive-receiver-qa`; no existing profile or user-authored document was deleted. The receiver has no database before its first launch. Ordinary startup creates the demo draft before import, so “fresh receiver” does not mean zero rows after startup.

## Keyboard integration

The source contains the six-Version/three-Branch history from the N2 pass. Anchor focus on the ordinary alternative selector, dismiss its menu, and navigate by Tab/Return through integration preview and the whole-alternative Version choice. The selected source for the committed merge is `本文 / Main / 正文`; no attempt to select another Branch is counted without observing its changed value.

Tab from the whole-Version choice enters paragraph 1. Paste `N3 keyboard integration 日本語 English 简体中文`, Tab/Return to confirm the final diff. The diff reports one changed paragraph and the exact new text; focus automatically returns to that textarea. Tab skips the now-disabled diff confirmation and reaches adoption; Shift+Tab from the subsequent export control confirms the adoption button is focusable. Return saves the reviewed result through real Rust/SQLite. The editor shows the text, current Version is `e8659a76-8fd…`, and focus returns to the stable history heading; the next Tab enters the Version-name field.

The native database has seven Versions, seven parent rows, three Branches and four original operation receipts. The merge retains ordered parents `23e85dc3-396…` (current) and `8febad86-594…` (source), and the source Branch still points to its original head. The graph marks the merged head without removing earlier Versions.

After receiver recovery, independently test changing the selector to `別案 / Alternative / 备选`: native menu **End → Space** commits the changed value; Return alone in the earlier menu probe did not establish a selection change. Tab/Return then opens the chosen alternative's review, reporting a shared ancestor and one conflict. This read-only follow-up does not save another merge or change recovered immutable rows. Multilingual paste is not native IME evidence.

## Full-history portability and graceful restart

Use the ordinary `.komyaku 全履歴` control. It downloads `~/Downloads/本文 - Main - 正文.komyaku`; verified SHA-256:

```text
d097d23ccf975c6bef0dddb7ea843a0c4f2b6f0b3a848a28256ee191cd5f7972
```

The independent v2 reader verifies seven exact Snapshots, three Branches and the historical-only Markdown Asset. Read-only native comparison proves the source Snapshot strings/hashes, ordered parents and Branch heads match the archive. Fully quit source and confirm `isRunning: false`.

Build/start Archive Receiver QA, whose separate database did not previously exist. Use its ordinary file picker to select that exact downloaded archive. The restored editor displays the merged multilingual text; library contains the imported Document plus startup's initial Document. Its history graph shows the seven Versions and three Branches, including the merged current position and common-ancestor route.

Compare every immutable Snapshot string/hash, ordered parent, Branch head/name and Asset bytes/size/hash/media type against the verified archive. The current draft matches the normalized Canonical current Version. A raw `JSON.stringify` comparison initially differed because of property ordering; parsing both with the Canonical contract confirms value equality. Immutable Snapshot byte comparisons remain exact and are not replaced by this normalization check.

Capture the recovered SQLite baseline, fully quit, confirm `isRunning: false`, relaunch the same bundle path, and explicitly open the imported Document from the library. The editor/history return ready with the same merged head. Read-only comparisons prove both draft strings, all Version/parent/Branch/operation rows, and Asset content/integrity/lifecycle fields survive. Startup/open checkpoints advance draft revisions. Asset `updated_at` also advances when the normal adapter resolves the historical Asset; this is **not** a no-write startup claim. No restored Asset bytes or immutable history changes.

CUA temporarily returned `noWindowsAvailable`/`timeoutReached` during the source download. Session reset initially did not recover it; a later inventory refresh and full bundle-path selection did. No incomplete action was promoted to evidence. The downloaded file, native database and subsequent receiver UI provide the completed evidence.

## Reproduction and validation

```sh
bun run --filter @komyaku/desktop test:workflow:package
bun run --filter @komyaku/desktop test:archive-receiver:package
bun run test:e2e
cargo test --lib --manifest-path apps/desktop/src-tauri/Cargo.toml
bun test
```

Launch the matching `.app` files in `apps/desktop/src-tauri/target/debug/bundle/macos/` through the native launcher. Use a previously unused receiver identity for a genuinely fresh first run; preserve existing QA profiles on repeat runs. The separate deterministic History Archive QA runner was not itself rerun here. This ordinary-control pass closes the v2 portability gate independently of that runner's earlier build-only record.

Final Rust suite: **61 passed / 1 ignored**; Bun repository run: **548 passed / 25 PostgreSQL-dependent skips**; Chrome Playwright: **57 passed**. The receiver package builds. A parallel QA unit run exposed temporary-directory timestamp collisions; test directories now include a process ID and atomic counter, and the final full Rust run passes. Tests include the newly added internal composite-history primitive, but that does not certify its runtime adoption.

## Block separation

N3 now covers reviewed Document integration and v2 portability, which have their own implementation and native exit evidence. N3S retains all prior unfinished Story Workspace requirements and adds the new internal composite history and v3 reference-contract results. Public Alpha continues to require **both** blocks. Moving that distinct state/format milestone to its own heading does not mark its runtime/migrations/Asset-lifecycle/import requirements Done or Later.
