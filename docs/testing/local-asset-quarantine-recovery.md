# Local Asset quarantine recovery verification

## Automated boundary coverage

The Rust test `lists_bounded_quarantined_metadata_and_reactivates_only_after_checkpoint` exercises the complete database lifecycle:

1. decoder-verified PNG bytes enter `pending`;
2. a Canonical document checkpoint activates the reference;
3. a later checkpoint without the Image Node moves the final reference to `quarantined` without deleting bytes;
4. the bounded list returns only metadata for that quarantined record;
5. reinserting the same Asset ID in a later Canonical checkpoint returns it to `active` and removes it from the quarantine list.

Desktop service tests additionally reject malformed, duplicate, oversized, or byte-bearing native response shapes and require new alternative text before constructing an Image Node insertion. The main-window capability test confirms that the list command is not granted to the hidden Mermaid renderer.

## UI and package verification

Playwright runs the complete Web workbench at 320, 375, 414, 768, and 1024 CSS pixels. The quarantine controls remain inside the viewport and show a disabled Desktop-only boundary outside Tauri.

On 2026-08-31 the isolated `KOMYAKU Preview QA` macOS application built successfully with the generated `allow-list-quarantined-local-assets` permission at:

```text
apps/desktop/src-tauri/target/debug/bundle/macos/KOMYAKU Preview QA.app
```

The package build proves that the Rust command, generated ACL manifest, main-window capability, JavaScript client, localized UI, and Tauri bundle compile together. Interactive quarantine recovery on Windows WebView2 and Linux WebKitGTK remains platform-specific QA rather than an implementation blocker.
