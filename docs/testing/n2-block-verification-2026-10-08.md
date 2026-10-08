# N2 workflow block verification — 2026-10-08

[Done] Development-environment implementation and verification are complete. [Pending] The target-user task trial and Windows/Linux native passes require participants/hosts that are unavailable here. This record does not establish the 4-of-5 unassisted completion target or certify those platforms.

The flow under test is: ordinary packaged workspace → import shared-ancestor history → save a named Version → create an alternative → compare → restore → graceful restart → inspect the retained lineage.

## Environment and isolation

- macOS arm64, debug Tauri WebView, `tauri://localhost/`, title `KOMYAKU Workflow QA`.
- New `tauri.workflow-qa.conf.json` uses identifier `app.komyaku.desktop.workflow-qa` and launches one ordinary main window at 390×844, with a 320×568 minimum. Native window Zoom also exercises the wide layout. No mock storage, special workflow page, extra IPC command or permission is used.
- SQLite profile: `~/Library/Application Support/app.komyaku.desktop.workflow-qa/komyaku.db`. Normal and existing QA profiles are not reset.
- Browser plugin not available. Native actions/screenshot inspection use CUA. Existing Chrome Playwright evidence complements the native pass; it does not replace it. Native console logs were not captured.

## Checks and results

| Check | Result |
| --- | --- |
| Page identity / meaningful content | [Done] Ordinary editor/library/history controls at the intended Tauri URL and window title |
| Framework error overlay | [Done] None visible in the inspected screens |
| Console health | [Pending] Native console logs unavailable in this pass; no claim of a console audit |
| Three-language layout | [Done] English, Japanese and 简体中文 initial screen/history forms/lineage; readable text and reachable controls at 390px |
| Lineage alignment | [Done] Colored edges connect measured row centers, common ancestor and alternatives remain visible; current position and branch names fit wrapped rows at narrow and zoomed-wide sizes |
| Keyboard continuation | [Done] Named save, alternative creation, comparison, restore and Archive/unarchive flows below |
| Restart fidelity | [Done] Exact Canonical content for two drafts and exact six Version, five parent, three Branch and three receipt rows |

The narrow screenshots show 16px outer margins, stacked forms and no visible horizontal clipping. English history heading wraps as “Document versions and / alternatives”; Chinese page heading wraps after its first clause. User-authored Version/Branch names are retained verbatim across language changes. Viewport claims cover the inspected screens, not every width/content combination. A drag-based resize attempt left the window unchanged and is not evidence; the native Zoom action produced the verified wide layout.

## Native interaction evidence

1. Build and launch the isolated Workflow QA bundle. Import the 6,345-byte v2 produced by `createHistoryArchiveQaFixture()` through the ordinary Archive file dialog. It contains an initial Version, main child, alternative child, two Branches and a historical-only file Asset. The library reaches two Documents and the graph renders shared ancestry.
2. Focus the Version-name field; Shift+Tab reaches the preceding Archive control. Tab returns to the field. Paste `N2 日本語 English 简体中文`, Tab/Return submits. The field clears and focus stays on the save button after the real SQLite write.
3. Shift+Tab returns to the empty name field; Tab through save into the alternative field. Paste `N2 別案 Alternative 备选`, Tab/Return submits. Current Branch changes, the graph gains the new current head and focus remains on the alternative button.
4. Focus the comparison From selector, dismiss its menu and Tab through To to the comparison button. Return produces “追加 1・削除 0・移動 0・変更 0”, including the added file Node. Shift+Tab reaches To afterward, proving keyboard continuation. No history write occurs during comparison.
5. Switch English/Japanese/简体中文 through the ordinary language selector. Inspect initial headings, history forms, Branch badges, current position and graph row wrapping. Existing comparison results translate; authored labels remain unchanged.
6. In Chinese, focus the alternative field and Tab twice to the first restore button. Return appends a restore Version. Focus falls back to the stable history heading; the next Tab reaches the Version-name field. The graph retains all earlier Versions and marks the new current position.
7. In Chinese at narrow width, focus the other Document's rename field and Tab through Rename/Open to Archive. Return changes the button to Restore and retains focus. A second Return unarchives, restoring the Archive button with focus still on it.
8. Use native window Zoom and inspect the graph after row widths/heights change. Branch edges, head badges, current position and ancestor alignment remain correct. Restore narrow size via the same native action.
9. Capture a read-only SQLite baseline; quit and verify `isRunning: false`; relaunch the same final artifact. Startup uses the default Japanese UI/initial Document, so explicitly open the imported history Document through the library. History returns ready with six Versions and the restored head. Read-only comparison proves both draft `content_json` strings and all Version/parent/Branch/receipt rows are exact. Startup/open checkpoints advance draft revisions without changing content. This does not claim persisted language or last-active-document selection.

## Reproduction

```sh
bun run --filter @komyaku/desktop test:workflow:package
```

Launch `apps/desktop/src-tauri/target/debug/bundle/macos/KOMYAKU Workflow QA.app` through the native app launcher. Generate the input using the existing exported fixture and archive writer (output belongs outside the repository):

```js
import { createHistoryArchiveQaFixture } from './apps/desktop/src/services/packaged-history-archive-qa.js';
import { createKomyakuHistoryArchive } from './packages/archive-core/src/index.js';
await Bun.write('/tmp/komyaku-n2-history.komyaku',
  await createKomyakuHistoryArchive(createHistoryArchiveQaFixture()));
```

Run the snippet as a temporary module with imports resolved to absolute repository paths. The profile remains available for repeat inspection; do not delete a profile to repeat this test. Reimport collision/replay behavior is covered separately by Archive tests.

## Other block evidence and limits

Existing browser keyboard, late-result ordering and narrow pagination regressions passed in the 57-test Chrome suite after the N0 history-session fix. Existing [performance verification](verification-2026-09-09.md) and packaged startup/RSS measurements remain evidence for their recorded fixtures; this packaging/configuration change does not alter runtime code or remeasure performance. The Workflow QA package build succeeds and `git diff --check` passes.

[Pending] Actual Japanese/Pinyin IME candidate conversion, Windows/Linux native WebViews, native console capture and a pilot-user trial remain unverified. Multilingual paste is not IME evidence. Earlier packaged full-size initial creation/restore/Archive keyboard results remain scoped to their [recorded native pass](verification-2026-09-09.md). No live Cloud or forced-process-termination claim is made.
