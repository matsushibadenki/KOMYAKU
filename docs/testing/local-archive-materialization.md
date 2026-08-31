# Local Archive Materialization Verification

Run `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml`, `bun test`, and `bun run build`.

Native tests must prove that one accepted Archive creates exactly one original Asset, reference, and Draft; same-digest replay creates no duplicates; and a hash mismatch creates neither a Document nor an Asset. JavaScript boundary tests verify that exact Reader-returned bytes and metadata are passed to only `import_local_komyaku_archive_atomic`.

For packaged QA, import an Archive containing Markdown and PNG, quit the process completely, reopen the Document, and confirm the text original remains accounted for and the PNG preview renders from SQLite. Remove both Nodes, create a durable checkpoint, and confirm their lifecycle changes to quarantined without deleting bytes.
