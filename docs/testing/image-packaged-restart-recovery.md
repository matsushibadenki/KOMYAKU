# Packaged local image insertion and restart recovery

## Purpose

Validate the real Tauri command, SQLite cache, Canonical/Yjs insertion, local draft checkpoint, Image NodeView, complete application quit, and database reopen as one packaged Desktop path. The test uses the isolated `KOMYAKU Preview QA` application with Bundle ID `app.komyaku.desktop.preview-qa`; it does not read or modify the normal KOMYAKU profile.

## Build and fixture

From `apps/desktop`:

```sh
bun run test:preview:package
```

The QA URL dynamically loads a 68-byte, fully decodable 1 × 1 PNG fixture. It invokes the same `store_local_png_preview_atomic` command used by the user-facing insertion control, requires the native result, and then calls the same Canonical Image Node insertion helper. The fixture alternative text is `KOMYAKU packaged PNG restart fixture`.

The visible `data-preview-qa-image` state has the following contract:

| State | Meaning |
| --- | --- |
| `running` | Native inspection, cache commit, insertion, or preview resolution is in progress |
| `saving` | The Image Node rendered and an explicit Canonical draft checkpoint is being committed |
| `inserted-durable` | First-run preview rendered and the containing Canonical document was durably saved |
| `recovered` | A later process found the existing Image Node and rendered its cached accepted PNG without rewriting the Asset |
| `failed-*` | The packaged path failed closed at the named boundary |

Do not terminate the first run before `inserted-durable`. A valid restart pass requires a full application Quit, confirmation that the process stopped, and relaunch of the same packaged artifact.

## 2026-08-31 macOS result

The debug macOS application was built successfully at:

```text
apps/desktop/src-tauri/target/debug/bundle/macos/KOMYAKU Preview QA.app
```

Observed sequence:

1. The isolated profile launched and created one accepted local PNG cache row through the decoder-backed native command.
2. The local editor inserted the Image Node with a generated lowercase Asset UUID and the required fixture alternative text; the second Yjs replica received the same node.
3. The static Image NodeView completed, the explicit Canonical checkpoint committed, and the visible state reached `inserted-durable`.
4. The application received the normal macOS Quit command and `app.komyaku.desktop.preview-qa` was confirmed not running.
5. Relaunch restored the existing Canonical draft, retained the same fixture Image Node, read the accepted PNG from SQLite, and reached `recovered`.
6. The recovered accessibility tree contained the fixture alternative text and no longer contained the localized image-loading message.
7. The QA application was closed after validation.

This passes the packaged macOS insertion, durable checkpoint, complete process stop, database reopen, Image Node identity recovery, and static preview recovery boundary. Windows WebView2 and Linux WebKitGTK remain separate platform passes.

## Reference-lifecycle migration result

On 2026-08-31 the same persisted QA profile was upgraded in place through SQLite migration 4. The existing pre-lifecycle preview row was retained as protected `legacy` data. Relaunch restored the existing Image Node and reached `Preview QA image: recovered`; the Canonical checkpoint returned to the validated/saved state with no local-persistence error. A later checkpoint can activate that row through the new document reference table without rewriting its bytes.
