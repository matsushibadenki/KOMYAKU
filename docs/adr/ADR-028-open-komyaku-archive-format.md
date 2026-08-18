# ADR-028: Open `.komyaku` Archive Format

- Status: Accepted
- Date: 2026-08-18

## Context

The `.komyaku` Archive is intended to preserve complete documents, Assets, Versions, and branch/merge history. If its behavior exists only in application code, users remain dependent on KOMYAKU for recovery even when the container uses a standard archive algorithm.

## Decision

- Define `.komyaku` as an open, publicly documented, implementation-independent format.
- Use a widely implemented archive container and ordinary inspectable files. The final container choice will be made during implementation and recorded in the normative format specification.
- Publish the normative specification at `docs/formats/komyaku-archive-format.md` with the first implementation.
- Publish machine-readable schemas and deterministic conformance fixtures for a minimum archive, branches, merges, Assets, and unknown compatible extensions.
- Version the archive format independently from the application and Canonical Document Schema.
- Document required/optional fields, forward-compatibility behavior, integrity verification, resource limits, path safety, and failure behavior.
- Require export/import round-trip and independent offline inspection as release acceptance criteria.
- Do not require a KOMYAKU account, cloud service, secret proprietary library, or active subscription to inspect or restore an unencrypted Archive.
- If encrypted Archives are added later, document the envelope and algorithms openly while keeping user keys outside the Archive where appropriate.

## Consequences

Third parties can build readers, validators, migration tools, and recovery software. Format evolution requires compatibility tests and cannot be changed solely for internal convenience. A file extension alone does not establish interoperability; the specification, schemas, fixtures, and reference behavior must remain synchronized with implementation.

## Deferred details

The exact container, media type, manifest fields, schema identifiers, canonical serialization rules, and compatibility matrix are intentionally deferred until the export/import implementation is designed and tested. Deferring these details avoids publishing an unstable pseudo-standard while making publication a non-optional implementation deliverable.
