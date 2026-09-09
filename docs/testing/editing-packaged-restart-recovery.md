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
