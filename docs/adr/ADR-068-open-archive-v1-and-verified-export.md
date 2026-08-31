# ADR-068: Open Archive v1 and verified export workflow

## Status

Accepted

## Decision

The first `.komyaku` implementation is an unencrypted, store-only ZIP with a fixed mimetype entry, strict manifest, one Canonical Document v1, and unchanged SHA-256-addressed Assets. The Archive format version is independent from the Canonical schema and application version.

Cloud export accepts a validated Canonical checkpoint, authorizes the Workspace, loads only active inspection-accepted Assets, checks database size/hash/media metadata against exact Object Storage bytes, creates the Archive, verifies it, writes it immutably, reads it back, verifies it again, and atomically records the export plus retention evidence for every included Asset.

The response contains only bounded artifact metadata. It does not expose an Object Storage key. Any failure before the final transaction creates no retention evidence.

Version Graph, branches, merges, encryption, signatures, and multiple documents are deliberately excluded from v1 and remain future format work.
