# Packaged History Archive v2 QA — 2026-09-22

The dedicated `KOMYAKU History Archive QA` macOS bundle uses `app.komyaku.desktop.history-archive-qa` and a separate SQLite/WebView profile. Its runner checks that application identifier before any profile read or write. The normal app cannot start the fixture by adding a query parameter.

From `apps/desktop`, build with `bun run test:history-archive:package`, then launch `src-tauri/target/debug/bundle/macos/KOMYAKU History Archive QA.app` on an unlocked Mac.

On a fresh QA profile, the app creates a deterministic v2 archive with three exact Version Snapshots, two Branches with shared ancestry, and a Markdown Asset referenced only by historical Versions. It imports through the production v2 reader and Tauri command, then rereads the draft and complete history through production native adapters. Re-export with the original timestamp must be byte-identical to the input Archive. A passing first launch displays `imported-all-bytes-verified`.

Quit the app completely and confirm its process has exited. Relaunch the same bundle. A passing second launch displays `recovered-all-bytes-verified`; it reads and compares without writing. Any partial pre-existing fixture produces `failed: ...` and is not overwritten. A page reload is not process-restart evidence.

- [Done] The main-window Tauri capability now grants `import_local_history_archive_atomic`; the hidden Mermaid renderer does not. The command is included in `build.rs`, and the generated permission exists after a successful macOS bundle build.
- [Done] The dedicated bundle builds successfully, and three harness tests cover identifier isolation, first import plus readback, no-write recovery, and refusal of partial state.
- [Done] The bundle's `Info.plist` reports the isolated identifier `app.komyaku.desktop.history-archive-qa`. The repository suite now passes 407 Bun tests (25 PostgreSQL-dependent tests skipped), 31 Rust tests (one ignored), and 44 Desktop Playwright E2E tests. These checks do not replace a native WebView launch.
- [Next] Run first launch, complete quit, and second launch through the native WebView on an unlocked Mac. Capture the visible result, then inspect the separate profile's SQLite counts and hashes without altering it.
- [Next] Independently exercise the ordinary editor's visible full-history export and file-picker import into an empty profile, then inspect its lineage graph. The deterministic runner validates native IPC and bytes; it does not exercise those controls.

The app was not launched for this record because the macOS session was locked. Build and unit-test success do not count as packaged runtime evidence.
