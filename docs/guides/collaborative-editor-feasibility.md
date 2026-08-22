# Collaborative Editor Feasibility Guide

- Updated: 2026-08-22
- Scope: Browser implementation inside the Tauri frontend
- Status: Browser pass complete; native Tauri IME and restart recovery remain next

## What is implemented

The desktop frontend mounts two real ProseMirror `EditorView` instances over independent Yjs replicas of one collaborative document. An in-memory State Vector bridge simulates a Provider boundary. This is a local feasibility surface, not a production network room.

- Editing either view updates the other through Yjs.
- The second replica can be disconnected, edited around from the local replica, and reconnected through bounded differential updates.
- Its selection is captured as encoded Yjs Relative Positions and follows the restore path after remounting. Exact caret placement still requires manual native-app verification.
- `compositionstart` pauses Canonical checkpoint scheduling. `compositionend` resumes it after the composed text is committed.
- A 450 ms quiet period produces a validated, deterministically serialized Canonical checkpoint and displays its byte size and SHA-256 prefix.
- The view exposes Japanese, English, and Simplified Chinese UI labels.
- Asset content is not loaded or transmitted by this view.

## Run locally

```text
bun run --filter @komyaku/desktop dev
```

Open `http://127.0.0.1:1420/`.

## Manual verification

1. Enter text in the local editor and confirm the second editor converges.
2. Press **Disconnect second**, continue editing locally, and press **Reconnect**. Confirm both contents match.
3. Place the caret in the second editor, disconnect it, edit locally, and reconnect. Confirm the caret returns to a valid logical location.
4. Use Japanese and Chinese IME. While composition is active, confirm the status reads that checkpointing is paused. After confirming the conversion, confirm the checkpoint becomes validated.
5. Use `Cmd/Ctrl+Z` in one editor. Confirm it undoes that editor's local operation without unexpectedly removing remote content.
6. Switch the interface between Japanese, English, and Simplified Chinese.
7. Check widths 320, 375, 414, 768, and 1024 CSS pixels. Confirm there is no horizontal scrolling and interactive labels remain on one line.

## Verified browser results

On 2026-08-22, the in-app Chromium browser verified:

- live convergence between both EditorViews;
- edit-while-disconnected followed by successful convergence on reconnect;
- Canonical checkpoint regeneration and hash change after edits;
- no horizontal overflow at 320, 375, 414, 768, and 1024 CSS pixels;
- one-column editor layout below 60 rem and asymmetric two-column layout at 1024 px;
- no new runtime errors after the EditorView initialization fix.

The browser automation cannot certify native operating-system IME behavior. Japanese and Chinese composition must still be repeated in the packaged Tauri application on macOS and other supported platforms.

## Current boundaries

- Each view uses an independent in-memory `Y.Doc`; the bridge is a Provider-boundary simulation, not a WebSocket or authenticated Provider.
- Checkpoints are validated in memory and are not yet committed to SQLite or the immutable Version DAG.
- Awareness/Presence and remote collaborator cursors are not enabled.
- Crash/restart recovery and update-log compaction are not implemented.
- The current screen is a feasibility workbench, not the final document-management information architecture.

## Multilingual summary

- 日本語: ブラウザ上の2画面同期、切断再接続、相対選択位置、IME中のcheckpoint停止を実装した。TauriネイティブIMEと再起動復旧は次工程で検証する。
- English: The browser now validates two-editor sync, reconnect, relative selections, and composition-safe checkpoints. Native Tauri IME and restart recovery remain next.
- 简体中文：浏览器版本已验证双编辑器同步、重新连接、相对选区和输入法组合期间暂停checkpoint。Tauri原生输入法与重启恢复仍待验证。
