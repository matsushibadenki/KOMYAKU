# Consolidated verification — 2026-09-09

This records actual results for the current working tree, including uncommitted fixes. It does not certify completion of all Roadmap milestones or production release readiness.

## Automated results

| Status | Check | Result and scope |
| --- | --- | --- |
| [Done] | `bun test` with isolated PostgreSQL | 397 pass, 0 fail, no skipped DB suite, 1,174 assertions, 102 files |
| [Done] | `cargo test --lib` | 26 pass; the explicit performance fixture is ignored in the ordinary run and was separately executed successfully |
| [Done] | Desktop Playwright | 41 pass, Chrome, 40.3 seconds; includes initial/named/alternative/restore/comparison keyboard flows and existing editor/import/save regressions |
| [Done] | Workspace `bun run check` | Successful; desktop build and server checks |
| [Done] | Final macOS Editing QA bundle | Successful debug `.app` build after focus fixes |
| [Done] | `git diff --check` | Successful |

The default non-DB run reported 384 pass / 25 skip. Some skipped entries are suite hooks, so enabling the DB suite yields 397 tests, not 409. The final PostgreSQL run used a newly created `postgres:17-alpine` container, bound only to localhost with a random port and tmpfs storage, after applying all current migrations. It did not use existing application or production data. The container was stopped after the successful run and automatically removed.

### Defects exposed and corrected

- The Asset lifecycle integration fixture still expected purge without preservation evidence and expected orphan purge. Current production code deliberately requires verified preservation evidence, no active retention hold, and retains orphan objects. The fixture now proves refusal without evidence, refusal with a hold, eligibility after release, and continued orphan quarantine. No deletion protection was weakened.
- An initial Version button disappears after success, and restore remounts history controls. Restoring focus only to that removed button left keyboard users at the document root. The mutation gate now captures a stable history-heading fallback and restores focus on the next animation frame after `inert` is removed, accounting for WebKit timing. A new mutation cancels an outstanding focus frame; focus outside the locked workspace is not taken over.

## Packaged macOS observations

Environment: Apple M4 / arm64, Japanese product UI, dedicated `app.komyaku.desktop.editing-qa` profile, ordinary `tauri://localhost/` workspace. CUA controlled real native UI. Browser plugin was unavailable; Playwright provided browser regressions, not native UI control. Screenshots and accessibility state confirmed content and controls; native console logs were not captured.

- [Done] Create a document with `QA final 日本語 简体中文 A`, save its initial Version, append ` B`, and save a named `QA B` Version using Tab/Return submission. Saved button focus remains usable.
- [Done] Select initial/QA B comparison through native controls; comparison reports exactly one changed paragraph and added ` B`.
- [Done] Restore initial content as a new Version; previous Versions remain listed and the editor returns to the original text. Quit/relaunch and library-open preserve the saved document/history. During an unsuccessful IME-switch probe, literal `ni` was added; it also survived restart and was subsequently removed by restoring the initial Version. This was not counted as IME evidence.
- [Done] On the final artifact, Tab to **最初の版を作成**, press Return, observe focus on **文書の版と別案**, then Tab to **版の名前（任意）**. This specifically verifies the removed-button fallback in WebKit.
- [Done] On the final artifact, use Tab/Return to save a named Version and restore an earlier Version; focus returns to the history heading after restore.
- [Done] Use Tab/Return for Archive and then Return for unarchive. The button changes Archive → 復元 → Archive and retains focus through both operations.
- [Done] Final native screenshot shows readable history controls and saved history status at the normal QA window size. This is not an all-size/all-language native layout pass.

The QA profile remains available with test documents; no user-authored normal-profile documents were reset. A v1 snapshot was downloaded while exercising the comparison/export controls; this pass does not count that file as independently byte-verified export evidence. Earlier verified export evidence remains in [export-packaged-files.md](export-packaged-files.md).

## Performance baseline

These are diagnostic measurements, not acceptance against a previously fixed budget. They exclude app rendering, account/network traffic and full-history Archive construction.

### Native SQLite, 100k ASCII graphemes / 1,000 Versions / 20 Branches

Run explicitly from the repository root:

```sh
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib history_performance_fixture -- --ignored --nocapture
```

The file-backed fixture writes 1,000 immutable snapshots using the real Rust transaction, checks the persisted count and 20 Branches, closes/reopens SQLite, and verifies all 20 branch-head snapshot lengths/hash-checked reads. Version titles vary; body text is 100,000 ASCII graphemes. Times exclude fixture construction/hash preparation before native save.

| Measurement | p50 | p95 |
| --- | ---: | ---: |
| Native save, 1,000 samples | 7.03 ms | 14.73 ms |
| Native history list, 20 samples | 22.20 ms | 25.32 ms |

Database file: 103,776,256 bytes. Reopen plus first list: 23.03 ms (one sample, not p95). **The current API returns only the latest 500 of the 1,000 stored Versions.** This is a known browsing limit, not data loss; pagination and older-Version UI access remain unfinished. The temporary successful and failed-run fixture files were removed.

### Multilingual Canonical / Diff / v1 Archive, 100k graphemes

```sh
bun apps/desktop/scripts/benchmark-document-history.js
```

Apple M4, Bun 1.4.0, 20 samples, mixture of Japanese/Chinese characters, ASCII, decomposed accents and family emoji. Every v1 Archive round trip is compared with the input Canonical encoding.

| Measurement | p50 | p95 |
| --- | ---: | ---: |
| Snapshot encoding | 0.51 ms | 1.16 ms |
| Document comparison | 9.76 ms | 12.83 ms |
| v1 Archive creation | 10.95 ms | 11.82 ms |
| v1 Archive verification | 11.27 ms | 13.00 ms |

Archive: 701,192 bytes. Peak RSS observed at sampling points: 138,559,488 bytes; this is not an OS-measured maximum or packaged-app memory figure. The SQLite and multilingual fixtures are separate workloads.

## Remaining gates — not silently completed

| Status | Gate | Required next evidence |
| --- | --- | --- |
| [Next] | Controlled pending-save native navigation/import/export; native failure UI beyond covered paths | Deterministic real IPC timing/fault harness plus ordinary UI, not only browser substitutes or Rust calls |
| [Next] | Current editor IME navigation/Version/export matrix | Actual Japanese/Pinyin candidate composition with current controls; the input-menu automation timed out in this run. Earlier native IME editing evidence remains valid only for its recorded scope |
| [Next] | Native credential-store / AI handoff / live Cloud retry | Disposable opt-in credentials and controlled services; do not substitute fake secrets as credential-store evidence |
| [Next] | Complete history browsing and performance acceptance | Paging beyond 500 results, predeclared budgets and packaged UI startup/memory measurements |
| [Later] | Windows/Linux packaged QA | Actual target hosts and native WebView/input-method runs |
| [Later] | Production topology, restoration, SMTP/proxy failure, independent security review | Isolated representative staging and an independent evaluator; local PostgreSQL tests are insufficient |
| [Later] | Target-user trial and two-week pilot | Consenting participants and elapsed real use; an implementation agent cannot stand in for target users |
| [Later] | Full-history Archive / merge verification | Implement N3 contracts first; v1 snapshot round trips cannot prove missing full-history functionality |

There are no remaining failures in the automated suites executed here. The table above means **all verification is not yet complete**. Completion requires the listed environment/input/implementation-dependent evidence, rather than changing those entries to Done.
