# Collaborative Editor Feasibility Guide

- Updated: 2026-08-24
- Scope: Browser implementation inside the Tauri frontend
- Status: Browser pass, local restart recovery, macOS Japanese IME, and exact caret restoration complete; native Simplified Chinese IME remains next

## What is implemented

The desktop frontend mounts two real ProseMirror `EditorView` instances over independent Yjs replicas of one collaborative document. An in-memory State Vector bridge simulates a Provider boundary. This is a local feasibility surface, not a production network room.

- Editing either view updates the other through Yjs.
- The second replica can be disconnected, edited around from the local replica, and reconnected through bounded differential updates.
- Its selection is captured as encoded Yjs Relative Positions and follows the restore path after remounting. Exact caret placement still requires manual native-app verification.
- `compositionstart` pauses Canonical checkpoint scheduling. `compositionend` resumes it after the composed text is committed.
- A 450 ms quiet period produces a validated, deterministically serialized Canonical checkpoint and displays its byte size and SHA-256 prefix.
- Validated checkpoints are autosaved with monotonic local revisions. Tauri uses SQLite; the Vite feasibility environment uses origin-local `localStorage`.
- Startup restores the last valid Canonical draft. Corrupt data blocks persistence rather than being silently overwritten.
- The view exposes Japanese, English, and Simplified Chinese UI labels.
- Asset content is not loaded or transmitted by this view.

## Run locally

```text
bun run --filter @komyaku/desktop dev
```

Open `http://127.0.0.1:1420/`.

Run the automated browser suite with:

```text
bun run test:e2e
```

## Manual verification

1. Enter text in the local editor and confirm the second editor converges.
2. Press **Disconnect second**, continue editing locally, and press **Reconnect**. Confirm both contents match.
3. Place the caret in the second editor, disconnect it, edit locally, and reconnect. Confirm the caret returns to a valid logical location.
4. Use Japanese and Chinese IME. While composition is active, confirm the status reads that checkpointing is paused. After confirming the conversion, confirm the checkpoint becomes validated.
5. Use `Cmd/Ctrl+Z` in one editor. Confirm it undoes that editor's local operation without unexpectedly removing remote content.
6. Switch the interface between Japanese, English, and Simplified Chinese.
7. Check widths 320, 375, 414, 768, and 1024 CSS pixels. Confirm there is no horizontal scrolling and interactive labels remain on one line.

## Verified browser results

On 2026-08-24, the Playwright suite and interactive browser pass verified:

- live convergence between both EditorViews;
- edit-while-disconnected followed by successful convergence on reconnect;
- Canonical checkpoint regeneration and hash change after edits;
- no horizontal overflow at 320, 375, 414, 768, and 1024 CSS pixels;
- one-column editor layout below 60 rem and asymmetric two-column layout at 1024 px;
- no new runtime errors after the EditorView initialization fix.
- Canonical draft autosave and restoration after a page restart;
- synthetic `compositionstart` / `compositionend` checkpoint suspension and resumption.

The packaged macOS Tauri application passed Japanese Kotoeri composition, conversion, SQLite restart recovery, and exact Relative Position caret restoration on 2026-08-24. Simplified Chinese remains untested natively because the test Mac has no Chinese input source installed. See `docs/testing/native-ime-validation.md`.

## Current boundaries

- Each view uses an independent in-memory `Y.Doc`; the bridge is a Provider-boundary simulation, not a WebSocket or authenticated Provider.
- Checkpoints are persisted as local drafts, but are not yet committed to the immutable Version DAG.
- Awareness/Presence and remote collaborator cursors are not enabled.
- Canonical restart recovery is implemented; keystroke-level Yjs update logging and compaction are not.
- The current screen is a feasibility workbench, not the final document-management information architecture.

## Multilingual summary

- 日本語: ブラウザ検証に加え、macOS Tauriで日本語変換、再起動復旧、正確なキャレット復元まで確認した。简体中文ネイティブIMEは次工程で検証する。
- English: Browser validation is complete, and macOS Tauri has passed Japanese conversion, restart recovery, and exact caret restoration. Native Simplified Chinese IME remains next.
- 简体中文：浏览器验证已完成，macOS Tauri也已通过日文转换、重启恢复和精确光标恢复。简体中文原生输入法仍待验证。
