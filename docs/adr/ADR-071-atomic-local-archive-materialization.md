# ADR-071: Atomic Local Archive Materialization

## Status

Accepted — 2026-08-31

## Decision

The packaged Desktop materializes a verified `.komyaku` Archive through one capability-scoped Tauri command. JavaScript performs the public Archive verification, then the native boundary independently checks the exact Document Asset set, UUIDs, byte limits, SHA-256 values, UTF-8/JSON rules, SVG masquerading, and PNG decoding before opening a SQLite transaction.

The transaction stores generic Archive originals in `local_archive_assets`, deduplicates by content hash, remaps every `assetId` in Canonical JSON, creates Document references, writes the local Document and Draft, and records the Archive digest. PNG originals additionally populate the existing decoder-accepted preview table so restored Image Nodes render without another import. Same-digest replay returns the committed Draft; another Archive using an existing Document UUID is rejected rather than overwritten.

## Failure model

Validation occurs before mutation and all persistent writes share one SQLite transaction. A rejected or interrupted import leaves no Document shell, Asset row, or reference. Subsequent Canonical checkpoints maintain Archive Asset references and quarantine originals no longer referenced by any Document; bytes are not automatically deleted.

## Compatibility

The browser build lacks a trusted SQLite/native boundary and therefore remains verification-only. Local materialization accepts the same text/JSON profile as Cloud and decoder-verified PNG up to 256 KiB. Other format-valid Assets remain rejected until an appropriate native decoder or scanner is available.
