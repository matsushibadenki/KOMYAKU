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
- [Next] Failed native persistence → blocked navigation → explicit UI retry, including stale displayed saved status checks.
- [Later] Windows/Linux native passes before distribution, plus narrow-window and keyboard-only coverage for these operations.

This pass makes no claim about arbitrary crash/power-loss recovery, attachment bytes, History DAG closure, archive import, or last-active-document selection at startup. The title and markers use direct text input; multilingual marker entry is not IME conversion evidence.
