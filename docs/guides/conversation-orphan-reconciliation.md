# Conversation Import Orphan Reconciliation

Conversation export bytes are written to immutable Object Storage before their PostgreSQL graph transaction. If that transaction fails, the original may exist without an `assets` row. Run the bounded reconciliation scan per Workspace:

```bash
OPERATOR_ID="operations@example.com" \
CONVERSATION_ORPHAN_REASON="Scheduled non-destructive reconciliation" \
bun run --filter @komyaku/server maintenance:conversation-orphans --workspace <workspace-uuid>
```

The scanner accepts only `workspaces/{workspace}/conversation-imports/{uuid}/source.bin`, processes 100 keys per page, compares them with Workspace-owned Asset records, and records unknown objects as quarantined. Discovery never deletes bytes. A later scan marks a quarantine record recovered when the corresponding database Asset appears. Every page is operator-audited.
