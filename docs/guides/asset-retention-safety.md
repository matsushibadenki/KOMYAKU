# Asset retention safety operations

All commands require `OPERATOR_ID` and `ASSET_MAINTENANCE_REASON`. Run migrations before using these controls.

Record evidence only after independently verifying the exported or archived artifact and its SHA-256:

```text
bun run --filter @komyaku/server maintenance:assets -- \
  --action evidence --workspace <uuid> --asset <uuid> \
  --type verified_export --artifact <uuid> --digest <sha256>
```

Invalidate evidence when the artifact is lost, corrupt, superseded without verification, or otherwise unavailable:

```text
bun run --filter @komyaku/server maintenance:assets -- \
  --action invalidate-evidence --workspace <uuid> --asset <uuid> \
  --type verified_export --artifact <uuid>
```

Place or release a publication/legal hold:

```text
bun run --filter @komyaku/server maintenance:assets -- \
  --action hold --workspace <uuid> --asset <uuid> \
  --type legal_hold --scope <uuid>

bun run --filter @komyaku/server maintenance:assets -- \
  --action release-hold --workspace <uuid> --asset <uuid> \
  --type legal_hold --scope <uuid>
```

Use `published_version` for a published-Version scope and `legal_hold` only from an authorized legal/compliance process. Never release a legal hold merely to make cleanup proceed.

`purge` still checks references, evidence, holds, recovery time, canonical key, and content hash. A successful command does not mean every due row was eligible. Storage-orphan objects remain quarantined and are never automatically deleted.
