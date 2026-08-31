# ADR-065: Inspected immutable text File Nodes

## Status

Accepted

## Context

The Canonical schema already models Generic File nodes, but accepting arbitrary binary attachments before production malware scanning would create an unsafe authoring and download path. Text originals can be completely inspected within a strict size budget while preserving their exact authored bytes.

## Decision

KOMYAKU Cloud initially accepts `text/plain`, `text/markdown`, `text/csv`, `text/vnd.mermaid`, and `application/json` originals up to 1 MiB. The client preallocates a stable File Node ID and sends exact bytes, a declared media type, and a percent-encoded display filename. The server rejects path separators, NUL, unsupported types, empty input, and oversized bodies before Object Storage.

Storage remains Workspace-scoped, content-addressed, immutable, and deduplicated. The upload creates one idempotent `document_node/source` reference. The asynchronous inspector must receive the complete input, validate UTF-8 without NUL, and additionally parse JSON when declared as JSON. A Canonical File Node is created only after `accepted`, matching detected/declared media type, and `baseline-signature-v1` policy. Rejection, error, or client timeout releases the exact staging reference.

Filenames are presentation metadata only. They never form Object Storage keys and are not trusted as media detection. Original bytes never enter Yjs or Canonical JSON.

## Consequences

Authors can attach useful source material without weakening immutable-original or structured-document boundaries. Executables, archives, office files, PDF, SVG, raster formats other than the separately inspected PNG path, and unknown binaries remain rejected. Expanding those types requires a dedicated parser/decoder policy and production malware scanning. Cloud checkpoint reconciliation remains required to recover references left by process termination or deleted document nodes.
