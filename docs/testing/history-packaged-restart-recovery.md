# Packaged local history checkpoint QA

## Scope and isolation

The dedicated `KOMYAKU History QA` bundle uses `app.komyaku.desktop.history-qa` and its own SQLite profile. The fixture runner checks the native application identifier **before any database read or write**. Opening `?mode=history-qa` in the normal app cannot run the fixture. No extra Tauri command or capability is granted.

This harness calls the production Desktop persistence adapters through real Tauri IPC. It does not exercise the editor, toolbar, navigation handlers, IME, or failure/retry UI. It is not a full-history Archive test: the exported `.komyaku` is a v1 single-document snapshot with no Assets. Export bytes are verified in memory, not downloaded to disk.

## Run

From `apps/desktop`:

```sh
bun run test:history:package
```

Launch `src-tauri/target/debug/bundle/macos/KOMYAKU History QA.app`.

1. A fresh QA profile saves the fixed Canonical fixture at revision 1.
2. The native rename command updates the title and draft together to revision 2.
3. A delayed revision-2 save containing the old title is rejected with `stale_local_revision`. A native reread verifies that the renamed document is intact.
4. An edit containing Japanese, English, Simplified Chinese, a decomposed accent, and a family emoji is saved at revision 3 and reread exactly.
5. The saved document is exported through the local v1 writer, read back through the public Archive reader, and compared with the expected Canonical document. Wait for `saved-export-verified`.
6. Quit the application completely and verify that its process is gone.
7. Launch the **same artifact**. Wait for `recovered`, which means the persisted Canonical content and revision match exactly without another write. This second phase validates persistence only; the first phase is the export evidence.

`failed: ...` is never a pass. An incomplete or changed pre-existing fixture fails without overwriting evidence. Repeating first-run QA requires an explicitly disposable fresh QA profile; the harness does not delete or reset one automatically. A page reload alone is not process-restart evidence.

## Recorded result — 2026-09-09

- [Done] Debug macOS bundle built successfully with `bun run test:history:package`.
- [Done] Native WebView accessibility output reached `saved-export-verified` on first launch.
- [Done] Normal macOS Quit followed by an exact bundle-executable process lookup confirmed process termination.
- [Done] Relaunch of `app.komyaku.desktop.history-qa` reached `recovered`; screenshot and accessibility output confirmed the status. The QA application was then closed.
- [Done] Four automated harness tests cover normal-profile rejection before I/O, initial export plus recovery without rewrites, partial-state refusal, and distinguishing arbitrary storage failures from stale-write rejection.
- [Next] Exercise actual editor rename/navigation/import during pending autosave, real IME navigation, failed persistence retry controls, and dirty export controls in the packaged application.
- [Later] Repeat applicable packaged QA on Windows and Linux before distributing those builds.

Graceful application quit/relaunch is covered. Forced termination, power loss, full disk, attachment export, and complete Version/Branch history recovery are not established by this result.
