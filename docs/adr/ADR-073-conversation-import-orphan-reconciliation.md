# ADR-073: Conversation Import Orphan Reconciliation

## Status

Accepted — 2026-09-01

## Decision

Raw Conversation imports use immutable Object Storage before PostgreSQL persistence, so the two systems cannot share one commit. A bounded per-Workspace scanner lists only the canonical Conversation Import prefix, validates exact `{uuid}/source.bin` suffixes, and compares those keys with Workspace-owned `assets` rows.

Unknown canonical objects are recorded in `conversation_import_orphan_objects` as quarantined. Discovery is non-destructive and does not expose download URLs or bytes. Unexpected keys are counted but not adopted. When a later scan finds a corresponding Asset record, the quarantine record becomes recovered. Each reconciliation page requires operator identity and reason and writes one audit event.

## Consequences

Failed imports no longer leave invisible storage cost without an inventory. Physical deletion is deliberately not part of this milestone: retention evidence, backup state, incident investigation, and an explicit purge policy must be evaluated before any destructive action is added.
