import { v7 as uuidv7 } from "uuid";

export function createConversationOrphanRepository(sql) {
  if (!sql?.begin) throw new Error("Conversation orphan SQL client is required");
  return Object.freeze({
    async listKnownStorageKeys({ workspaceId, storageKeys }) {
      if (storageKeys.length === 0) return [];
      const rows = await sql`SELECT storage_key FROM assets
        WHERE workspace_id = ${workspaceId} AND storage_key = ANY(${storageKeys})`;
      return rows.map((row) => row.storage_key);
    },
    async reconcile({ workspaceId, orphans, knownStorageKeys, observedAt, operatorId, reason, summary }) {
      return sql.begin(async (tx) => {
        for (const storageKey of knownStorageKeys) {
          await tx`UPDATE conversation_import_orphan_objects
            SET lifecycle_state = 'recovered', recovered_at = ${observedAt}, last_seen_at = ${observedAt}
            WHERE workspace_id = ${workspaceId} AND storage_key = ${storageKey}
              AND lifecycle_state = 'quarantined'`;
        }
        for (const orphan of orphans) {
          await tx`INSERT INTO conversation_import_orphan_objects
            (id, workspace_id, storage_key, byte_size, first_seen_at, last_seen_at)
            VALUES (${orphan.id}, ${workspaceId}, ${orphan.storageKey}, ${orphan.byteSize}, ${observedAt}, ${observedAt})
            ON CONFLICT (storage_key) DO UPDATE SET byte_size = EXCLUDED.byte_size,
              last_seen_at = EXCLUDED.last_seen_at
            WHERE conversation_import_orphan_objects.lifecycle_state = 'quarantined'`;
        }
        await tx`INSERT INTO operator_audit_events
          (id, operator_id, action, target_type, target_id, reason, metadata)
          VALUES (${uuidv7()}, ${operatorId}, 'conversation_import.orphan_reconcile', 'workspace', ${workspaceId},
                  ${reason}, ${JSON.stringify(summary)}::text::jsonb)`;
      });
    }
  });
}
