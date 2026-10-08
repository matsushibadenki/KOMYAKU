# Packaged editor rename and document-switch QA

## Build and isolation

From `apps/desktop`, run:

```sh
bun run test:editing:package
```

Launch `src-tauri/target/debug/bundle/macos/KOMYAKU Editing QA.app`.

The bundle identifier is `app.komyaku.desktop.editing-qa`. Its profile is separate from both the normal application and the History QA fixture. It opens `/`, the ordinary single-editor product workspace, with no fixture runner, injected data, persistence mocks, or new native permissions. The configuration contains only the main window; isolated Mermaid rendering is outside this pass.

## Recorded macOS pass — 2026-09-09

The flow under test was: edit → rename using the library form → edit again → create another document → open the original → full Quit → relaunch → open the second document.

1. In a fresh Editing QA profile, the welcome document reached saved state at revision 1.
2. The editor received `UI-N0-before-rename`. The library form renamed the active document to `N0 実画面 改題`.
3. The editor received `UI-N0-after-rename`. Both markers remained visible, with the renamed title in the library and successful saved feedback.
4. The ordinary **新しい文書** control created an empty document. The editor received `UI-N0-second-document`.
5. The library **開く** control restored the original document. Both markers and the renamed title were present. The original showed revision 8, the second document revision 3; the original checkpoint hash prefix was `be747549a7e0`.
6. The app received normal macOS Quit. The native app inventory reported `isRunning: false` before relaunch.
7. Relaunch restored the original content, title, and the same checkpoint hash prefix. The startup checkpoint advanced its revision to 9; this is not a claim of revision equality across startup.
8. Opening the second document restored `UI-N0-second-document`, hash prefix `acb2e5a9abd2`, and advanced that document to revision 4. The library still contained exactly two documents.
9. Accessibility output confirmed the text and state throughout. A screenshot confirmed the two-entry library and normal application layout. The QA app was closed after the pass.

Some clicks first scrolled offscreen controls into view, then required another click to activate them. Autosave completed during the observed intervals. Therefore this pass **does not prove navigation during pending autosave**, nor is it a timing stress test.

## Coverage

- [Done] Buildable isolated profile using the normal editor and library handlers.
- [Done] Packaged macOS active-document rename followed by further editing.
- [Done] New-document creation and library navigation preserve separate text.
- [Done] Full graceful quit/relaunch preserves the observed two documents and title.
- [Next] Deterministic pending-autosave navigation/import and dirty export, with proof that the operation begins before autosave completes.
- [Next] Actual Japanese and Simplified Chinese IME composition during navigation.
- [Done] Failed native persistence → blocked new-document navigation → explicit UI retry → graceful restart; see the additional pass below.
- [Later] Windows/Linux native passes before distribution, plus narrow-window and keyboard-only coverage for these operations.

This pass makes no claim about arbitrary crash/power-loss recovery, attachment bytes, History DAG closure, archive import, or last-active-document selection at startup. The title and markers use direct text input; multilingual marker entry is not IME conversion evidence.

## Native save failure and retry — 2026-09-09

The ordinary macOS Editing QA app was rebuilt with `bun run test:editing:package`. Native computer-use accessibility actions exercised the UI at `tauri://localhost/`; no browser persistence mock was used. Browser plugin was unavailable; this native pass used CUA rather than Playwright. Console logs were not captured. Accessibility and screenshots confirmed meaningful content, no visible framework overlay, and readable failure/retry feedback at the configured 1200×900 window size; other widths were not tested.

A temporary Bun SQLite script opened only `~/Library/Application Support/app.komyaku.desktop.editing-qa/komyaku.db`. The following trigger injected an actual SQL transaction failure for the existing QA document only:

```sql
CREATE TRIGGER editing_qa_fail_draft BEFORE UPDATE ON local_drafts
WHEN NEW.document_id = '00000000-0000-4000-8000-000000000001'
BEGIN SELECT RAISE(ABORT, 'editing QA injected failure'); END;
```

The script and trigger were test instrumentation, not product capabilities. The trigger was removed with `DROP TRIGGER IF EXISTS editing_qa_fail_draft` before each UI retry; schema readback confirmed no trigger remained. Reproduce only in this separate QA profile and always remove the trigger, including after a failed test.

1. Initial pass: append `N0-FAILURE-RETRY-20260909`, click **新しい文書**, observe the same editor and two library entries plus `local_persistence_blocked/local_draft_storage_failure` and **ローカル保存を再試行**. SQLite retained revision 19 and the previously saved content without the new marker. No saved-success feedback remained.
2. Remove the trigger and click the retry control. The UI reaches **この端末に自動保存済み** at revision 20. Quit and confirm `isRunning: false`.
3. This exposed misleading shared checkpoint copy: SQL write failure was labelled document validation failure. Update en/ja/zh-Hans to acknowledge validation **or saving** failure and rebuild.
4. Repeat on the final artifact: starting at revision 21, arm the same trigger, append `N0-RETRY-FINAL`, and click **新しい文書**. The editor retains both markers and the library still has two entries. The corrected Japanese checkpoint message appears; saved-success feedback is absent. Database readback before disarming still has revision 21 and lacks the final marker.
5. Remove the trigger, retry through the real control, and observe saved state at revision 22, 1,042 bytes, displayed SHA-256 prefix `1c6f46c1bb08`.
6. Quit, confirm the app is not running, and relaunch the same final artifact. Both markers, title and displayed hash prefix survive; the startup checkpoint advances to revision 23. This is not a read-only startup or full-hash byte comparison claim.

The failure is an injected SQLite abort, not an actual full disk, permission loss, or interrupted process. IME, pending-save timing, library-open/import/restore failure paths, and English/Chinese rendered layouts remain separate QA scope. The native screenshot shows the Japanese failure line without awkward wrapping and the retry button below the detailed error. The QA app was closed after verification.

## Native open/import/restore failure guards — 2026-10-08

[Done] Rebuilt the isolated `KOMYAKU Editing QA.app` debug bundle and used its ordinary WebView controls through native CUA at `tauri://localhost/`. The 1200×900 screen contained meaningful editor/history content without a visible framework overlay. Native console logs were not captured. Browser mocks were not used. Four existing QA Documents were preserved.

Saved one named Version (`N0 native guard verification`) to expose an older Version’s restore control. The profile then contained 10 Versions and 10 operation receipts. Armed the document-scoped `editing_qa_fail_draft` UPDATE trigger shown above; the initial Document was at revision 43. Appended `N0-native-blocked-20261008-日本語-English-简体中文` through the real editor.

[Done] Library Open kept the original editor and unsaved marker, showed saving failure with `local_persistence_blocked/local_draft_storage_failure`, and did not activate the other Document.

[Done] Clicking the older Version’s restore control kept the editor, showed failed history operation feedback, and created no Version or receipt.

[Done] Selected a valid disposable `/tmp/komyaku-n0-blocked.komyaku` through the macOS file dialog. Import was refused; the library remained at four Documents. A read-only Bun SQLite comparison proved every draft’s exact content/revision and the Version/receipt counts matched the armed baseline.

[Done] Removed the trigger. A further Library Open still refused adoption until clicking the explicit retry control. Retry saved the marker at revision 44, 1,100 bytes, hash prefix `47460a68b2d0`. Fully quit the app, confirmed `isRunning: false`, and reopened the same bundle. The marker and hash survived. Startup autosave advanced the initial Document to revision 45; all four exact draft strings and Version/receipt counts matched the post-retry baseline. No trigger remained.

[Done] Separately held a SQLite writer reservation while requesting Library Open after an edit. The UI remained on the original Document with saving feedback while the marker was absent from durable storage. The long hold exceeded the SQLite busy timeout, produced a safe persistence failure, and was recovered by explicit retry after release. A short four-second hold followed by Open saved and switched, but elapsed input timing was not established; this is not a successful delayed-save timing pass. Both reservations were rolled back without data mutation by the helper.

[Done] Appended `N0-native-dirty-export-20261008` and activated TXT in one native input sequence. The downloaded `~/Downloads/N0 実画面 改題.txt` included the latest marker and matched `renderLocalDocumentExport` of the durable revision-49 Document byte-for-byte. The UI reported download initiation. This establishes file fidelity after rapid editing/export; it does not prove the export event preceded background autosave. The app was fully quit after the pass, with no trigger left.

At the time of the failure-guard pass, successful pending-autosave Open/import and dirty-export ordering remained open. The deterministic pass below closes those local gates; the rapid-input and timeout observations above are not used as their evidence.

[Pending] Real Japanese IME conversion and Windows/Linux platform QA remain on hold under the environment limitations already recorded in the ROADMAP.

## Deterministic pending-save gates and N0 completion — 2026-10-08

[Done] The remaining local event-ordering gates were exercised in the packaged macOS Editing QA app through ordinary editor, library, import and export controls. `editing_qa_gate.rs` holds `save_local_draft_atomic` before opening its SQLite transaction. It writes a `before-transaction` receipt and waits for explicit release, with a 60-second fail-closed timeout. Only the exact `app.komyaku.desktop.editing-qa` identifier in debug macOS builds recognizes the gate. Other application identifiers bypass it before filesystem access; release builds compile the passthrough. No command, capability or production database schema was added.

| Operation | Evidence while the native save was held | Evidence after release |
| --- | --- | --- |
| Library Open | Original editor retains `N0-gated-open-confirmed`, shows saving; all four draft strings/revisions and Version/receipt counts exactly equal the revision-52 baseline | Original draft reaches revision 53 before the other Document opens; reopening the original retains the marker |
| Archive import | Valid fixture selected through the macOS file dialog; original editor retains `N0-gated-import-confirmed`, import stays in progress, library remains at four Documents; full database comparison equals the revision-54 baseline | Library reaches five Documents and imported fixture opens; original draft retains both markers when reopened |
| TXT export | Marker `N0-gated-TXT-confirmed-20261008` is visible, TXT action shows export in progress, ready receipt identifies revision 59; all draft strings/revisions and history counts equal the revision-58 baseline; existing TXT bytes remain unchanged | Save and export complete; the newly downloaded `~/Downloads/N0 実画面 改題 (1).txt` matches the durable draft's `renderLocalDocumentExport(..., 'txt')` bytes exactly |

The export comparison initially inspected the earlier unsuffixed download and correctly rejected it. WebKit preserved that file and created the `(1)` download; the new file is the one that passed. The first gate experiment used a different temporary-directory path and is excluded from the successful ordering evidence. The final gate uses the same fixed `/private/tmp/komyaku-editing-qa-save-gate` path in Rust and the CLI.

[Done] Import → return to original Document exposed a history initialization race: an old durable checkpoint could mark the new edit session as loaded even though history refresh rejected its Document ID. `shouldLoadSessionHistory` now requires matching Document/session identity before marking the session loaded, and the effect observes the session replicas. Two regressions verify stale checkpoints and local/durable/session requirements. On the final rebuilt app, opening the imported Document and returning restores the original history, Version actions and export controls, rather than leaving history at preparation pending.

[Done] Fully quit the final rebuilt bundle, verify `isRunning: false`, and reopen the same artifact. A read-only SQLite comparison verifies all five exact Canonical draft strings, 10 Versions and 10 operation receipts survive unchanged. The initial Document's startup checkpoint advances revision 62 → 63; content remains byte-identical, with hash prefix `d31a455ee8c2` (1,310 Canonical bytes). The editor displays all three timing markers and history is ready. No failure trigger remains and the timing gate is released. This verifies graceful full-process restart, not a forced kill or power loss.

Reproduce the timing gate from the repository root:

```sh
bun run --filter @komyaku/desktop test:editing:package
bun run --filter @komyaku/desktop test:editing:gate release
# Launch the Editing QA bundle and let the initial checkpoint complete.
# Capture a read-only SQLite baseline before arming.
bun run --filter @komyaku/desktop test:editing:gate arm
# Edit through the UI, then request Open, import or TXT export.
bun run --filter @komyaku/desktop test:editing:gate status
# Require held=true and phase=before-transaction; compare the full baseline.
bun run --filter @komyaku/desktop test:editing:gate release
# Verify adoption/output and compare the saved bytes.
```

Release within 60 seconds of the first held save. Always release during cleanup, including failed runs. A timeout remains a failed save requiring explicit retry; it is not successful timing evidence. The CLI rejects a symlinked gate directory, and Rust creates its receipt exclusively without overwriting an existing file.

[Done] Final automated validation: Rust 58 passed / 1 ignored; Bun 507 passed / 25 PostgreSQL-dependent skips; Chrome Playwright 57 passed. The Editing QA package builds with the final history fix. These suites complement native evidence rather than substituting for it.

[Pending] Actual Japanese/Simplified Chinese IME conversion, Windows/Linux native passes and live Cloud-dependent verification remain on hold. Pasted multilingual text and synthetic composition tests do not establish real IME conversion. N0's available local implementation and exit verification are complete; this is not a cross-platform release certification.
