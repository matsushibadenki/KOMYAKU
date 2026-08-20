import { v7 as uuidv7 } from "uuid";

function assetCandidate(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    storageKey: row.storage_key,
    contentHash: row.content_hash,
    byteSize: Number(row.byte_size)
  };
}

export function createAssetLifecycleRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  return Object.freeze({
    async listKnownStorageKeys({ workspaceId, storageKeys }) {
      if (storageKeys.length > 100) throw new Error("Asset reconciliation page exceeds 100 keys");
      return sql.begin(async (tx) => {
        const known = [];
        for (const storageKey of storageKeys) {
          const rows = await tx`
            SELECT storage_key
            FROM assets
            WHERE workspace_id = ${workspaceId}
              AND storage_key = ${storageKey}
              AND storage_mode = 'content-addressed'
              AND lifecycle_state <> 'deleted'
          `;
          if (rows[0]) known.push(rows[0].storage_key);
        }
        return known;
      });
    },

    async reconcileOrphanObjects({ workspaceId, orphans, knownStorageKeys, observedAt, purgeAfter }) {
      return sql.begin(async (tx) => {
        for (const storageKey of knownStorageKeys) {
          await tx`
            UPDATE asset_orphan_objects
            SET lifecycle_state = 'recovered', recovered_at = ${observedAt}, last_seen_at = ${observedAt}
            WHERE workspace_id = ${workspaceId}
              AND storage_key = ${storageKey}
              AND lifecycle_state = 'quarantined'
          `;
        }
        for (const orphan of orphans) {
          await tx`
            INSERT INTO asset_orphan_objects
              (id, workspace_id, storage_key, content_hash, byte_size,
               first_seen_at, last_seen_at, purge_after)
            VALUES
              (${orphan.id}, ${workspaceId}, ${orphan.storageKey}, ${orphan.contentHash},
               ${orphan.byteSize}, ${observedAt}, ${observedAt}, ${purgeAfter})
            ON CONFLICT (storage_key) DO UPDATE SET
              byte_size = EXCLUDED.byte_size,
              last_seen_at = EXCLUDED.last_seen_at,
              purge_after = CASE
                WHEN asset_orphan_objects.lifecycle_state = 'quarantined'
                  THEN LEAST(asset_orphan_objects.purge_after, EXCLUDED.purge_after)
                ELSE EXCLUDED.purge_after
              END,
              lifecycle_state = 'quarantined',
              recovered_at = NULL,
              purged_at = NULL
            WHERE asset_orphan_objects.lifecycle_state <> 'purging'
          `;
        }
        return { orphaned: orphans.length, recoveredCandidatesChecked: knownStorageKeys.length };
      });
    },

    async quarantineReferenceZero({ inactiveBefore, quarantinedAt, purgeAfter, limit }) {
      const rows = await sql`
        WITH candidates AS (
          SELECT asset.id
          FROM assets asset
          WHERE asset.storage_mode = 'content-addressed'
            AND asset.lifecycle_state = 'active'
            AND asset.created_at < ${inactiveBefore}
            AND NOT EXISTS (
              SELECT 1 FROM asset_references reference
              WHERE reference.workspace_id = asset.workspace_id
                AND reference.asset_id = asset.id
                AND reference.released_at IS NULL
            )
          ORDER BY asset.created_at, asset.id
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE assets asset
        SET lifecycle_state = 'quarantined', quarantined_at = ${quarantinedAt}, purge_after = ${purgeAfter}
        FROM candidates
        WHERE asset.id = candidates.id
        RETURNING asset.id, asset.workspace_id, asset.storage_key, asset.content_hash, asset.byte_size
      `;
      return rows.map(assetCandidate);
    },

    async claimDueAssetPurges({ now, limit }) {
      const rows = await sql`
        WITH candidates AS (
          SELECT id
          FROM assets
          WHERE storage_mode = 'content-addressed'
            AND lifecycle_state = 'quarantined'
            AND purge_after <= ${now}
          ORDER BY purge_after, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE assets asset
        SET lifecycle_state = 'purging', purge_attempts = purge_attempts + 1
        FROM candidates
        WHERE asset.id = candidates.id
        RETURNING asset.id, asset.workspace_id, asset.storage_key, asset.content_hash, asset.byte_size
      `;
      return rows.map(assetCandidate);
    },

    async completeAssetPurge({ id, workspaceId, purgedAt }) {
      const rows = await sql`
        UPDATE assets
        SET lifecycle_state = 'deleted', deleted_at = ${purgedAt}, last_purge_error_at = NULL
        WHERE id = ${id} AND workspace_id = ${workspaceId} AND lifecycle_state = 'purging'
        RETURNING id
      `;
      return rows.length === 1;
    },

    async retryAssetPurge({ id, workspaceId, retryAt, failedAt }) {
      await sql`
        UPDATE assets
        SET lifecycle_state = 'quarantined', purge_after = ${retryAt}, last_purge_error_at = ${failedAt}
        WHERE id = ${id} AND workspace_id = ${workspaceId} AND lifecycle_state = 'purging'
      `;
    },

    async claimDueOrphanPurges({ now, limit }) {
      const rows = await sql`
        WITH candidates AS (
          SELECT id
          FROM asset_orphan_objects orphan_candidate
          WHERE lifecycle_state = 'quarantined' AND purge_after <= ${now}
            AND NOT EXISTS (
              SELECT 1 FROM assets asset
              WHERE asset.workspace_id = orphan_candidate.workspace_id
                AND asset.storage_key = orphan_candidate.storage_key
                AND asset.lifecycle_state <> 'deleted'
            )
          ORDER BY purge_after, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE asset_orphan_objects orphan
        SET lifecycle_state = 'purging', purge_attempts = purge_attempts + 1
        FROM candidates
        WHERE orphan.id = candidates.id
        RETURNING orphan.id, orphan.workspace_id, orphan.storage_key,
                  orphan.content_hash, orphan.byte_size
      `;
      return rows.map(assetCandidate);
    },

    async completeOrphanPurge({ id, workspaceId, purgedAt }) {
      const rows = await sql`
        UPDATE asset_orphan_objects
        SET lifecycle_state = 'purged', purged_at = ${purgedAt}, last_purge_error_at = NULL
        WHERE id = ${id} AND workspace_id = ${workspaceId} AND lifecycle_state = 'purging'
        RETURNING id
      `;
      return rows.length === 1;
    },

    async retryOrphanPurge({ id, workspaceId, retryAt, failedAt }) {
      await sql`
        UPDATE asset_orphan_objects
        SET lifecycle_state = 'quarantined', purge_after = ${retryAt}, last_purge_error_at = ${failedAt}
        WHERE id = ${id} AND workspace_id = ${workspaceId} AND lifecycle_state = 'purging'
      `;
    },

    async audit({ operatorId, action, operationId, reason, metadata }) {
      await sql`
        INSERT INTO operator_audit_events
          (id, operator_id, action, target_type, target_id, reason, metadata)
        VALUES
          (${uuidv7()}, ${operatorId}, ${action}, 'asset_maintenance', ${operationId},
           ${reason}, ${JSON.stringify(metadata)}::text::jsonb)
      `;
    }
  });
}
