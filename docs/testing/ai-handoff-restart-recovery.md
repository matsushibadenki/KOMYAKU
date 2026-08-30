# AI Handoff Restart Recovery QA

- Updated: 2026-08-30
- Scope: packaged Tauri Desktop
- Authority: this checklist records native restart evidence; browser reload is not a substitute

## Required recovery contract

A successful AI continuation must survive a full application process exit without contacting the AI provider again. On relaunch, **Local Conversations** must enumerate metadata only. Opening the saved item must restore the validated Canonical Conversation, assistant Message, and `ai_continuation` Edge. Provider credentials and an opted-in Cloud session are verified separately through the operating-system credential store; neither may appear in SQLite or Web Storage.

An ambiguous or failed Cloud write must remain a save-only retry. Relaunch recovery of pending, not-yet-committed Cloud work is not implemented, so a release tester must record this limitation rather than infer recovery.

## Automated gates

Run from the repository root:

```text
bun test
bun run build
cd apps/desktop/src-tauri && cargo test
cd apps/desktop && bun run tauri build --debug --bundles app
```

The Rust regression `restores_completed_ai_handoff_after_database_reopen` creates a file-backed SQLite database, applies both local migrations, commits a Handoff, closes every database connection, reopens the file, and verifies the metadata summary and Canonical continuation. It models a process boundary without relying on the browser fallback.

## Native release procedure

Use a disposable test account and non-sensitive fixture text.

1. Install or launch the packaged artifact, not the Vite development page.
2. Import a fixture and complete one Local or BYOK Handoff.
3. Record the Conversation ID, title, Message count, and final assistant marker.
4. Confirm the UI reports durable local persistence.
5. Quit the whole application process. Closing only a window is insufficient.
6. Relaunch the same installed application and profile.
7. Confirm **Local Conversations** shows the expected title and Message count without exposing message text.
8. Open the item and confirm the assistant marker and continuation Branch are present.
9. Continue from the restored assistant Message and confirm that a second immutable Branch can be saved.
10. For BYOK, confirm the credential resolves after restart, then remove it through the application flow. Inspect Web Storage and SQLite for absence of the secret.
11. If durable Cloud Session was enabled, confirm startup session revalidation; then revoke or log out and verify that restart does not restore the revoked token.
12. Record artifact hash, OS version, WebView version, package type, result, and any stable error code. Never record fixture bodies, passwords, tokens, or API keys.

## Platform evidence matrix

| Platform | Package | Automated DB reopen | Package build | Interactive quit/relaunch | Credential store | Status |
| --- | --- | --- | --- | --- | --- | --- |
| macOS 26.6.2 (25G83) | debug `.app` | Pass on 2026-08-30 | Pass on 2026-08-30 | Pending interactive AI Handoff run | Keychain pending interactive run | [Next] |
| Windows | MSI or NSIS | Covered by portable Rust test, native run required | Not run on this host | Not run | Credential Manager not run | [Next] |
| Linux | AppImage or deb | Covered by portable Rust test, native run required | Not run on this host | Not run | Secret Service not run | [Next] |

Do not convert a platform row to `[Done]` from CI compilation alone. It requires the interactive quit/relaunch and native credential-store checks on that operating system.

Current macOS debug executable SHA-256:

```text
99019abfaf911f29ebe31f5f9153fd9125e5dcd1a7b78631ddc2de46b086c025
```

## macOS attempt log — 2026-08-30

The packaged debug `.app` was launched through its native WebKit/Tauri window. The process was terminated with the application Quit command and confirmed no longer running, then the same artifact was relaunched. SQLite migrations completed, the application returned to a validated local-save state, and the existing Canonical draft restored with the same displayed short SHA-256 (`4373c592c265`) and authored markers. This passes the package launch, full-process quit, database reopen, and existing Canonical draft recovery smoke boundary.

The AI Handoff interactive row remains `[Next]`. The native macOS file chooser closes the available Computer Use automation pipe before a selected fixture can be returned to the WebView. No test data was injected directly into the application database, because doing so would bypass the native save contract and could disturb the existing profile. The file-backed Rust regression remains the current evidence for completed Handoff close/reopen recovery; a human-operated file selection and Handoff run is still required for the complete macOS row.

## Localized expected meaning

- 日本語：再起動後も完成済みの会話分岐が復元され、AIへの再送信は発生しない。
- English: A completed conversation branch is restored after restart without sending to the AI provider again.
- 简体中文：重启后应恢复已完成的会话分支，并且不得再次向AI提供商发送请求。
