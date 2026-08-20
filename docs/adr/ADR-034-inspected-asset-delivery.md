# ADR-034: Inspected-only Asset Delivery

- Status: Accepted
- Date: 2026-08-20

## Context

An Asset's declared media type is untrusted input. Returning a raw Object Storage URL before authorization and inspection can disclose private bytes, enable content-type confusion, cache sensitive documents, or execute active SVG/HTML in a first-party browser context. Inspection work must also recover safely when a Worker stops.

## Decision

- Store inspection as a durable leased state machine: `pending -> inspecting -> accepted|rejected|error`.
- Claim bounded work with PostgreSQL row locks and recover expired inspection leases across Worker replicas.
- Read at most 64 KiB for the baseline signature policy. Require complete content before accepting text or JSON. Match PNG, JPEG, GIF, WebP, and PDF signatures to the declared media type.
- Reject SVG from direct delivery until an isolated renderer and sanitizer policy exist. Reject unsupported and ambiguous binary types by default.
- Treat the baseline policy as format validation, not antivirus certification. A production malware-scanning adapter remains required before broad file-type support.
- Issue a signed URL only when the requester is a non-revoked member with a verified account, the Asset is `active`, and inspection is `accepted`.
- Return the same not-available response for unauthorized, missing, non-active, and non-accepted Assets.
- Limit URLs to 60 seconds by default and 300 seconds maximum. Force `Content-Disposition: attachment`, `Content-Type: application/octet-stream`, and `Cache-Control: private, no-store` at the Object Storage response.
- Never expose the storage key or content hash in the API response. Do not use direct signed delivery for inline editor previews.

## Consequences

Private Workspace members can download accepted files without proxying their full bytes through the API server. The permission decision remains in PostgreSQL and the URL is narrowly time-bounded. Uninspected, rejected, quarantined, deleted, and cross-Workspace Assets remain unavailable.

The current policy intentionally rejects some legitimate content, including SVG and large text files. Secure preview rendering, production malware scanning, public/unlisted publication delivery, and richer inspection adapters remain later work.

## Rejected alternatives

- Trust the client-supplied media type: permits content-type confusion.
- Return the original S3 URL: bypasses authorization and leaks storage topology.
- Serve accepted SVG inline from the application origin: creates an active-content boundary before isolation exists.
- Label signature checks as malware scanning: overstates the security guarantee.
