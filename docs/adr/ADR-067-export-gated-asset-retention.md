# ADR-067: Export-gated Asset retention

## Status

Accepted

## Context

Reference-zero quarantine and recovery windows are necessary but insufficient for permanent deletion. An original may still be required by a published Version, legal process, verified archive, or recovery export. Object Storage deletion is irreversible and must fail closed when preservation state is incomplete.

## Decision

A quarantined logical Asset becomes purge-claimable only when all conditions hold:

- its recovery deadline has passed;
- it has no active logical reference;
- at least one non-invalidated `verified_export` or `verified_archive` evidence record exists;
- it has no active `published_version` or `legal_hold` record;
- its Workspace-scoped canonical key and SHA-256 still agree.

Evidence is bound to an artifact UUID and SHA-256 digest, with verifier and verification time. Reverification can replace the digest for the same evidence identity; invalidation immediately removes its eligibility contribution. Holds are idempotently keyed by Asset, type, and scope, and retain placement/release actors and timestamps.

The database claim repeats every gate under `FOR UPDATE SKIP LOCKED`. It returns an explicit `retentionGateVerified` capability bit. The maintenance service refuses Object Storage deletion without that bit even if a repository adapter returns a candidate.

Objects classified only as storage orphans have no logical Asset identity against which preservation can be proven. Automatic orphan deletion is therefore disabled. Discovery and quarantine continue, but physical removal needs a future reviewed adoption or evidence workflow.

Operator commands require an explicit operator ID and reason and write metadata-only audit events. Recording evidence is an assertion that a separate verifier has already checked the artifact; it is not itself an export-verification engine.

## Consequences

Existing quarantined Assets do not become deletable merely because the deadline expires. Published and legally held material remains protected even with valid exports. Loss or invalidation of the last evidence closes the gate. The next implementation step is an automated export/archive verifier and production document-management workflow that creates these records without manual transcription.
