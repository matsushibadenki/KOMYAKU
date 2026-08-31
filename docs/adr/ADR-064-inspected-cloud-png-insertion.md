# ADR-064: Inspected Cloud PNG insertion

## Status

Accepted

## Context

Cloud image authoring must not create a Canonical Image Node merely because Object Storage accepted bytes. The declared media type can be false, decoding can fail, and inspection runs asynchronously. An upload can also fail after reserving a logical Asset reference but before the document receives its node.

## Decision

The editor generates the stable Image Node ID before upload and sends it as `X-KOMYAKU-Node-ID`. The authenticated API authorizes an owner, admin, or editor in one Workspace, accepts only `image/png`, and applies a 256 KiB body limit before storing exact bytes through the existing Workspace-scoped content-addressed Asset service. The Node ID becomes the idempotent logical `document_node/source` reference.

The upload response contains only Asset/reference identity and bounded inspection metadata. It never exposes an Object Storage key or URL. A client polls the authenticated inspection endpoint while status is `pending` or `inspecting`. It may create the Canonical Image Node only when all of these fields agree:

- status `accepted`;
- detected media type `image/png`;
- policy `decoder-backed-png-v1`;
- positive inspected width and height.

Rejected, errored, or timed-out insertion releases the exact Workspace/Asset/reference tuple. Physical deletion remains asynchronous retention work. Successful previews continue through the authorized byte proxy, immutable SHA-256 recheck, static Descriptor, and empty iframe sandbox.

Single-server mode runs the inspection polling worker in the server process. API-only replicas never run it; Worker and single modes share PostgreSQL lease/`SKIP LOCKED` correctness and can scale horizontally without sticky sessions.

## Consequences

An uploaded but uninspected object cannot enter authored Canonical state. Upload replay with the same Node ID converges on one active logical reference. Failed client staging is recoverable without directly deleting immutable bytes. Generic files, larger originals, resumable upload, Cloud document-reference reconciliation, and quota accounting remain later work.
