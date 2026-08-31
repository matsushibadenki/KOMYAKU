# ADR-055: Authorized Cloud PNG preview resolver

## Status

Accepted

## Context

The normal Asset download API deliberately produces a short-lived forced-attachment Object Storage URL. Reusing it for inline preview would expose the storage URL to the document DOM and couple preview safety to provider response behavior. An iframe navigation also cannot attach KOMYAKU's Bearer Session safely.

## Decision

Cloud PNG preview bytes travel through an authenticated API boundary:

1. The API resolves the user and Workspace membership before locating the Asset.
2. The repository returns only active content-addressed Assets accepted under exactly `decoder-backed-png-v1`, with PNG MIME, persisted dimensions, and byte size from 1 through 256 KiB.
3. The service performs one exact ranged Object Storage read and verifies both returned length and SHA-256 against the immutable Asset record.
4. The response is `private, no-store`, `image/png`, `nosniff`, no-referrer, and carries only the inspection policy and dimensions in bounded headers. It never returns a storage key or signed URL.
5. The API client validates MIME, policy, dimensions, and byte budget before exposing a `Uint8Array` inspection envelope.
6. The Desktop resolver receives the Session only as a call argument and passes the bytes to `renderAcceptedPngPreview`. The Session is not included in the Descriptor, document, URL, Local Storage, or SQLite.

Unauthorized, unaccepted, policy-mismatched, oversized, and missing Assets share the opaque `asset_not_available` response. Integrity mismatch is an internal failure and does not return storage details.

## Consequences

Small preview bytes pass through the API server, which is acceptable under the 256 KiB budget and avoids granting the editor direct storage access. Larger originals require a generated immutable preview representation. A Local Asset resolver and an Image NodeView still need to implement the same byte-and-inspection contract before images appear in the editor.
