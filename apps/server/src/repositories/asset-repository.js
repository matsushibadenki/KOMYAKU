export function createAssetRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  return Object.freeze({
    async claimContentAddressedAsset({ candidate, reference }) {
      return sql.begin(async (tx) => {
        await tx`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`${candidate.workspaceId}:${candidate.contentHash}`}, 0)
          )
        `;
        const orphanRows = await tx`
          SELECT lifecycle_state
          FROM asset_orphan_objects
          WHERE workspace_id = ${candidate.workspaceId} AND storage_key = ${candidate.storageKey}
          FOR UPDATE
        `;
        if (orphanRows[0]?.lifecycle_state === "purging") {
          throw new Error("Content-addressed Asset orphan purge is in progress; retry the write");
        }
        if (orphanRows[0]) {
          await tx`
            UPDATE asset_orphan_objects
            SET lifecycle_state = 'recovered', recovered_at = now()
            WHERE workspace_id = ${candidate.workspaceId} AND storage_key = ${candidate.storageKey}
          `;
        }
        const assets = await tx`
          INSERT INTO assets
            (id, workspace_id, media_type, byte_size, content_hash, storage_key, storage_mode, created_by)
          VALUES
            (${candidate.id}, ${candidate.workspaceId}, ${candidate.mediaType}, ${candidate.byteSize},
             ${candidate.contentHash}, ${candidate.storageKey}, 'content-addressed', ${candidate.createdBy})
          ON CONFLICT (storage_key)
          DO UPDATE SET
            content_hash = EXCLUDED.content_hash,
            lifecycle_state = 'active',
            quarantined_at = NULL,
            purge_after = NULL,
            deleted_at = NULL
          WHERE assets.lifecycle_state <> 'purging'
          RETURNING id, workspace_id, media_type, byte_size, content_hash, storage_key,
                    (id = ${candidate.id}) AS created
        `;
        const asset = assets[0];
        if (!asset) throw new Error("Content-addressed Asset purge is in progress; retry the write");
        if (asset.workspace_id !== candidate.workspaceId
          || asset.content_hash !== candidate.contentHash
          || asset.storage_key !== candidate.storageKey
          || Number(asset.byte_size) !== candidate.byteSize
          || asset.media_type !== candidate.mediaType) {
          throw new Error("Content-addressed Asset metadata conflict");
        }

        const insertedReferences = await tx`
          INSERT INTO asset_references
            (id, workspace_id, asset_id, referrer_type, referrer_id, relation, created_by)
          VALUES
            (${reference.id}, ${candidate.workspaceId}, ${asset.id}, ${reference.referrerType},
             ${reference.referrerId}, ${reference.relation}, ${candidate.createdBy})
          ON CONFLICT (workspace_id, asset_id, referrer_type, referrer_id, relation)
            WHERE released_at IS NULL
          DO NOTHING
          RETURNING id
        `;
        const counts = await tx`
          SELECT count(*)::bigint AS active_count
          FROM asset_references
          WHERE workspace_id = ${candidate.workspaceId}
            AND asset_id = ${asset.id}
            AND released_at IS NULL
        `;
        return {
          assetId: asset.id,
          assetCreated: asset.created,
          referenceCreated: insertedReferences.length === 1,
          activeReferenceCount: Number(counts[0]?.active_count ?? 0),
          mediaType: asset.media_type,
          byteSize: Number(asset.byte_size),
          contentHash: asset.content_hash,
          storageKey: asset.storage_key
        };
      });
    },

    async releaseAssetReference({ workspaceId, referenceId }) {
      return sql.begin(async (tx) => {
        const released = await tx`
          UPDATE asset_references
          SET released_at = now()
          WHERE id = ${referenceId}
            AND workspace_id = ${workspaceId}
            AND released_at IS NULL
          RETURNING asset_id
        `;
        if (!released[0]) return null;
        const counts = await tx`
          SELECT count(*)::bigint AS active_count
          FROM asset_references
          WHERE workspace_id = ${workspaceId}
            AND asset_id = ${released[0].asset_id}
            AND released_at IS NULL
        `;
        return {
          assetId: released[0].asset_id,
          activeReferenceCount: Number(counts[0]?.active_count ?? 0)
        };
      });
    }
  });
}
