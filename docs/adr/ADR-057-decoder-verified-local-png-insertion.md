# ADR-057: Decoder-verified local PNG insertion

## Status

Accepted

## Context

An Image Node must never make untrusted file bytes part of a document merely because a browser file picker reported `image/png`. Local insertion also needs a stable Asset identity, required alternative text, and a durable preview that survives restart.

## Decision

The first local insertion slice accepts PNG files up to 256 KiB. The frontend performs only an early size and required-alt-text check. A capability-scoped Tauri command is the authority: it fully decodes the supplied bytes with Rust `image`, applies a 16 MP decoded-pixel and 64 MiB decoder-allocation budget, derives dimensions and SHA-256 itself, and writes the accepted inspection envelope and bytes to `local_asset_previews` in one SQLite transaction.

Asset IDs are lowercase UUID-shaped values generated before the command. Repeating the same Asset ID and bytes is idempotent. Reusing an Asset ID with different bytes, dimensions, or hash fails closed. The command returns derived metadata; the frontend verifies its shape and identity before inserting a Canonical Image Node at the current editor selection. Alternative text is mandatory in this workflow and is never derived from a filename.

This is deliberately a two-phase boundary:

1. decoder verification and durable cache commit;
2. Canonical Image Node insertion into the Yjs working state.

The phases cannot share a database transaction because Yjs is an in-memory collaborative state. If phase two fails, an unreferenced cache row may remain for later bounded orphan cleanup; the document never points at unverified or uncommitted bytes.

## Consequences

Local Desktop users can now author a real Image Node whose stable Asset reference resolves after restart. Web builds expose the control as Desktop-only and cannot simulate acceptance. This initial workflow treats the bounded PNG representation as the local preview asset; immutable original-file storage, captions, broader formats, Cloud insertion, quota accounting, and orphan reclamation remain separate work.

