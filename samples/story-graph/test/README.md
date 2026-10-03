# Validation

Run from `samples/story-graph/` after installing root Bun dependencies:

```sh
bun run build
bun test test
cargo test --workspace --locked
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo fmt --all -- --check
cargo test -p unge-render --test render --locked -- --ignored
```

GPU tests need desktop Metal access and system CJK fonts. Browser preview is read-only; it is not a substitute for Tauri persistence or native input QA. For isolated native QA:

```sh
STORY_GRAPH_DATA_DIR=/tmp/story-graph-qa cargo run --locked
```

Native cases still to complete: create/edit/delete through the UI, close/restart with an active text field, float/dock with an IME composition in progress, two-window conflicting edits, native pointer movement across DPI changes. Engine tests cover the underlying revision conflicts and undo contracts; they do not establish these UI paths.
