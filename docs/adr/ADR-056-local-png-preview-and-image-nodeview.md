# ADR-056: Local PNG preview Resolver and Image NodeView

## Status

Accepted

## Context

Local-first documents need image previews without placing arbitrary filesystem paths, `file:` URLs, or uninspected original bytes in Canonical document data. Preview failure must not erase the Image Node's stable identity, Asset reference, MIME declaration, or alternative text.

## Decision

Tauri SQLite migration `0003_local_asset_previews.sql` creates a dedicated cache table keyed by Asset UUID. Database constraints permit only:

- `accepted` `image/png` records under `decoder-backed-png-v1`;
- 1 through 256 KiB with exact BLOB length;
- lowercase 64-character SHA-256;
- positive inspected width and height totaling at most 16 million pixels.

The Local Resolver selects one record by Asset ID, normalizes the SQLite BLOB to `Uint8Array`, rechecks byte length and SHA-256, and passes the inspection envelope to `renderAcceptedPngPreview`. It never resolves an authored filesystem path or network URL. Preview-core is dynamically imported only after a valid local record is found so its Mermaid dependency remains outside the initial Desktop bundle.

The Image NodeView always displays the Canonical MIME, Asset ID, and alternative text. Its React preview root asynchronously calls the injected Resolver and accepts only the fixed static Descriptor through `SandboxedStaticPreview`. Loading or failure affects only the disposable preview region. NodeView teardown remains deferred to avoid the React Strict Mode cross-root race identified during Mermaid integration.

## Consequences

The read and display path is implemented, including localized Japanese, English, and Simplified Chinese states. Asset insertion still needs an atomic native write path that performs decoder-backed inspection before creating the SQLite cache row and Canonical Image Node. Cloud workspaces can inject the ADR-055 Resolver through the same NodeView contract once editor session/workspace state is centralized.
