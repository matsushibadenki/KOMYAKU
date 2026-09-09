# Packaged export file verification

## Reproduce

Build `bun run test:editing:package` from `apps/desktop` and launch the isolated Editing QA application. Create a Version in the normal history panel, then edit the working draft without creating another Version. Export TXT, Markdown, and `.komyaku Snapshot` using the visible controls. Record the actual download paths: macOS may add numeric suffixes for repeated names.

Stop editing and changing Versions while verifying. From `apps/desktop`, run:

```sh
bun scripts/verify-packaged-exports.js DB_PATH DOCUMENT_ID TXT_PATH MD_PATH KOMYAKU_PATH
```

The script opens SQLite read-only. It compares TXT/Markdown **bytes** against the renderer output for the persisted draft, verifies the downloaded Archive through the public reader, checks the native current Version snapshot hash, and compares its Canonical content with the archived document. It neither resets a profile nor removes downloaded files. Use only known QA files; this is a developer verification script, not an untrusted-input import endpoint.

## Recorded macOS result — 2026-09-09

- [Done] Latest Editing QA bundle built successfully and opened the ordinary history controls.
- [Done] Created the first Version of `N0 実画面 改題`, then appended `EXPORT-AFTER-VERSION--` to the working draft. The observed marker is exactly this ASCII string; this pass does not claim native IME conversion.
- [Done] Clicked TXT, Markdown and `.komyaku Snapshot`; actual files appeared in Downloads and the app reported completion.
- [Done] The post-edit TXT and Markdown files contained the marker. TXT omitted the heading marker and Markdown retained `#`, as expected.
- [Done] The downloaded `.komyaku` v1 passed CRC/hash/manifest validation and matched the current native immutable Version, which excluded the later draft edit. It contained zero Assets.
- [Done] The verification script returned `verified` for all three final files. Substituting the earlier, pre-edit TXT produced `qa_txt_bytes_mismatch` and exit code 1.

Archive digest: `8d3c331b843e4c406cd43cb28c3890aa7615250806a2f5ae40f8aa5dbe6d49be`.

The local QA downloads were named `N0 実画面 改題 (1).txt`, `N0 実画面 改題.md`, and `N0 実画面 改題.komyaku`. A repeated Markdown click also created a numbered copy. Files were retained for inspection; the QA app was closed after verification.

## Remaining gates

- [Next] Prove export dispatch before autosave finishes using controlled native timing; the observed UI actions here allowed autosave to finish.
- [Next] Native IME-active export refusal, failed-save refusal and filesystem/download failure feedback.
- [Next] Attachment-byte comparison, complete history export and empty-profile restoration.
- [Later] Windows/Linux packaged download behavior.

This proves the tested successful download path, not that a browser anchor click alone guarantees disk persistence or detects a cancelled/failed download.
