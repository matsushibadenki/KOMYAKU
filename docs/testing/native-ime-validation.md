# Native Tauri IME and Caret Validation

- Updated: 2026-08-24
- Platform: macOS, packaged local debug `.app`
- Status: Japanese IME and exact caret restoration passed; Simplified Chinese IME remains environment-blocked

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

## Simplified Chinese environment gate

The tested Mac currently enables ABC and Japanese Kotoeri input sources. No Simplified Chinese input source is installed. System input-source settings were not modified during this validation.

The browser suite already covers synthetic composition lifecycle and Simplified Chinese authored text. A native Pinyin pass remains required on a macOS/Windows/Linux test environment where a Simplified Chinese IME is already provisioned.

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
