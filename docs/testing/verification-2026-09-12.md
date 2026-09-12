# Older-Version paging verification — 2026-09-12

This record covers the cursor-paging implementation added after the 2026-09-09 consolidated verification. It does not replace external native-host, credential-store, production-topology, target-user, or N3 full-history Archive gates.

## [Done] Implemented boundary

- Native SQLite returns at most 100 Version summaries per call and exposes the last returned `(createdAt, versionId)` as an opaque continuation cursor only when another row exists.
- Ordering is `created_at DESC, id DESC`; migration 0008 aligns the compound index with that ordering. A same-timestamp 105-Version test proves page 1 returns 100, page 2 returns five, and no boundary item repeats.
- The Desktop adapter validates cursor/result envelopes and rejects duplicate or out-of-order appended pages.
- The history view initially renders 10 items, reveals another 10 per action, and requests another native page only after the loaded page is exhausted. Exact Snapshot loading still verifies Document ownership and SHA-256, so Versions outside the newest page can be compared and restored.
- English, Japanese, and Simplified Chinese labels were added. The 390 × 844 Playwright pass had no horizontal document overflow.
- The history list now overlays a document-lineage graph derived from persisted ordered parent IDs and Branch heads. Real row measurement keeps nodes aligned when translated labels wrap; the current position and Branch-head names remain visible in the semantic list. Display coordinates and colors are bounded to six reusable lanes so a many-Branch history cannot draw over the Version content. The paging browser regression asserts two distinct visible lanes, 10 nodes/9 edges before loading, and 12 nodes/11 edges afterward.

## [Done] Automated results

| Check | Result |
| --- | --- |
| Rust same-timestamp paging test | 1 pass |
| `cargo test --lib` | 27 pass, 1 explicitly ignored performance fixture, including parent-edge history readback |
| `bun test` without PostgreSQL opt-in | 385 pass, 25 skipped DB entries, 0 fail |
| Targeted Version Playwright | 16 pass, including paging and 390 px width |
| Full Desktop Playwright | 42 pass, 0 fail |
| Workspace `bun run check` | pass |
| macOS Editing QA packaged build | pass, including migration 0008 and the paged Tauri command |
| `git diff --check` | pass |

Browser plugin was unavailable, so the rendered interaction used the repository Playwright flow with the native history boundary substituted. Native SQLite behavior was verified separately in Rust; a packaged Tauri paging interaction remains useful native evidence but is not required to prove the query boundary.

## [Done] Fixed performance budgets and result

Fixture: Apple M4, debug Rust build, file-backed SQLite, one 100,000-ASCII-grapheme Snapshot per Version, 1,000 Versions, 20 Branches, 100 summaries per page.

| Measurement | Budget | Observed |
| --- | ---: | ---: |
| Version save p95 | ≤ 25 ms | 8.20 ms |
| First history page p95 | ≤ 10 ms | 4.50 ms |
| Reopen plus first page | ≤ 25 ms | 3.36 ms |
| Complete 10-page traversal | ≤ 100 ms | 31.58 ms |
| SQLite file | ≤ 128 MiB | 103,862,272 bytes |

The fixture was rerun after parent-edge metadata was added to every history page. It asserts all five budgets and deletes its temporary database only after success. These budgets cover native persistence and metadata paging. They exclude React rendering, packaged startup/RSS, full-history Archive construction, and network work.

## [Done] Packaged macOS startup and RSS

Command:

```sh
bun run --cwd apps/desktop benchmark:startup:macos
```

The harness launched the dedicated `app.komyaku.desktop.editing-qa` debug bundle five times. Startup ends at the first on-screen layer-0 window. After three idle seconds, RSS sums the main process and process rows carrying that dedicated bundle identifier. Each launched app is terminated with a bounded fallback, and no QA process remained after the run.

| Measurement | Budget | p50 | p95 |
| --- | ---: | ---: | ---: |
| Process start to visible window | ≤ 3,000 ms p95 | 249.34 ms | 275.29 ms |
| Settled process-family RSS | ≤ 512 MiB p95 | 130,285,568 bytes | 131,186,688 bytes |

This is a repeatable Apple M4 debug-bundle baseline after build and filesystem warm-up. It is not a cold-boot, peak-memory, signed release, Windows, or Linux result.

## [Next] Remaining evidence

- Repeat the paging interaction through real Tauri IPC in the packaged app, together with the remaining native language/keyboard/viewport matrix.
- Run the target-user task trial and the later two-week pilot with consenting participants.
- Implement and verify the N3 full-history Archive and merge contracts.
