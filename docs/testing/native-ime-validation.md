# Native Tauri IME and Caret Validation

- Updated: 2026-09-01
- Platform: macOS, packaged local debug `.app`
- Status: Japanese IME, Simplified Chinese Pinyin IME, restart recovery, and exact caret restoration passed

## Build under test

```text
bun run --filter @komyaku/desktop tauri build --debug --bundles app
```

Bundle:

```text
apps/desktop/src-tauri/target/debug/bundle/macos/KOMYAKU.app
```

The test used the packaged WebKit/Tauri application and its SQLite database, not the Vite browser fallback.

## Japanese IME result

The enabled macOS Kotoeri Romaji input source was used with individual keyboard events.

1. Entered `nihongo`; the editor displayed `にほんご`.
2. Confirmed that the status changed to `IME入力中—保存を保留` while composition was active.
3. Requested conversion; the editor displayed `日本語` while checkpointing remained paused.
4. Confirmed the conversion.
5. Confirmed that Canonical validation completed and SQLite status returned to local autosave complete.
6. Repeated conversion with `変換テスト` and restarted the application.
7. Confirmed both converted strings were restored from SQLite.

Both live Yjs replicas showed the composing and committed text. No authored text was transmitted over the network.

## Exact caret restoration result

1. Placed the caret immediately after `日本語` in the second replica.
2. Disconnected and unmounted the second editor.
3. Reconnected it.
4. Reached the restored editor through keyboard focus without clicking its content.
5. Inserted `《復元》`.
6. Confirmed the resulting text was exactly `日本語《復元》` and autosaved successfully.

This verifies the Relative Position capture/restore path in packaged Tauri for the tested disconnect/reconnect case.

## Defects found and fixed

### New blocks lacked Stable Node IDs

Pressing Return created a paragraph without a `nodeId`, so the Canonical checkpoint correctly failed with `missing_stable_node_id`. A ProseMirror append-transaction plugin now assigns IDs to missing or duplicated identity-bearing nodes. The EditorView dispatch path now uses `applyTransaction` so append transactions execute.

### Shared metadata was mistaken for a cycle

IME and paragraph splitting can reuse JSON-compatible empty metadata objects across nodes. The Document Schema preflight used one global `WeakSet`, which classified any shared reference as a cycle. It now tracks only active DFS ancestors: shared references are accepted, while real ancestor cycles remain rejected.

Stable internal failure codes are shown in the local persistence status. They contain no authored content.

## Simplified Chinese Pinyin result

The user provisioned the macOS Simplified Chinese Pinyin input source before this pass. The application did not change System Settings. The packaged WebKit/Tauri application was then tested with individual keyboard events rather than direct text injection.

1. Entered `jiantizhongwen` through individual Pinyin key events; the editor exposed the active composition as `jian ti zhong wen`.
2. Confirmed that the persistence status changed to `IME入力中—保存を保留` while composition was active.
3. Selected the first candidate and confirmed the committed result was exactly `简体中文` in both Yjs replicas.
4. Confirmed Canonical validation and local SQLite autosave completed with short hash `18d4061f85db`.
5. Quit the complete packaged application and confirmed no `KOMYAKU` process remained.
6. Relaunched the same `.app` and confirmed `简体中文`, the validated checkpoint, and the same short hash were restored from SQLite.
7. Placed the caret immediately after the restored Chinese phrase in the second replica, disconnected and unmounted that editor, then reconnected it.
8. Reached the second editor by keyboard focus without clicking its content and inserted `《光标复原》`.
9. Confirmed both replicas contained exactly `简体中文《光标复原》`, followed by a validated local checkpoint with short hash `ce1c689cf0df`.

This completes the native macOS Simplified Chinese Pinyin gate. Windows and Linux remain separate platform validation targets rather than blockers for this macOS result.

## Atomic local-save regression

After moving Tauri draft persistence into one Rust-side SQLite transaction, the packaged application was rebuilt and tested again on 2026-08-24:

1. A unique test paragraph was added through the native editor.
2. The checkpoint returned to the validated and locally saved state without an error code.
3. A read-only SQLite query found the marker in the same joined `local_documents` / `local_drafts` record at local revision 15.
4. The application was quit and relaunched.
5. The marker was restored, the UI reported local autosave, and no persistence error was present.

The Rust suite separately proves that stale-revision rejection rolls back document metadata and that a mismatched Canonical identity creates no document shell.

## Regression commands

```text
bun test
bun run test:e2e
bun run build
cd apps/desktop/src-tauri && cargo test
cd apps/desktop && bun run tauri build --debug --bundles app
```
