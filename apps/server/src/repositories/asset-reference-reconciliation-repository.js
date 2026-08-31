export function createAssetReferenceReconciliationRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");
  return Object.freeze({
    async reconcile({ workspaceId, documentId, actorId, revision, referenceDigest, references }) {
      return sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${documentId}`}, 0))`;
        const authorized = await tx`
          SELECT 1
          FROM workspace_members member
          JOIN users actor ON actor.id = member.user_id
          WHERE member.workspace_id = ${workspaceId}
            AND member.user_id = ${actorId}
            AND member.member_role IN ('owner', 'admin', 'editor')
            AND member.revoked_at IS NULL
            AND actor.email_verified_at IS NOT NULL
            AND actor.deleted_at IS NULL
          LIMIT 1
        `;
        if (!authorized[0]) throw new Error("Document Asset reconciliation is not authorized");
        const checkpoints = await tx`
          SELECT revision, reference_digest, asset_reference_count
          FROM cloud_document_asset_checkpoints
          WHERE workspace_id = ${workspaceId} AND document_id = ${documentId}
          FOR UPDATE
        `;
        const current = checkpoints[0];
        if (current && Number(current.revision) > revision) throw new Error("Stale document Asset checkpoint");
        if (current && Number(current.revision) === revision) {
          if (current.reference_digest !== referenceDigest) throw new Error("Conflicting document Asset checkpoint");
          return { revision, activeReferenceCount: Number(current.asset_reference_count), releasedReferenceCount: 0, replayed: true };
        }
        const referenceJson = JSON.stringify(references);
        const matched = await tx`
          WITH desired AS (
            SELECT node_id, asset_id
            FROM jsonb_to_recordset(${referenceJson}::jsonb) AS item(node_id uuid, asset_id uuid)
          )
          SELECT count(*)::integer AS count
          FROM desired
          JOIN asset_references ref
            ON ref.workspace_id = ${workspaceId}
           AND ref.document_id = ${documentId}
           AND ref.referrer_type = 'document_node'
           AND ref.referrer_id = desired.node_id
           AND ref.asset_id = desired.asset_id
           AND ref.relation = 'source'
           AND ref.released_at IS NULL
          JOIN assets asset
            ON asset.workspace_id = ref.workspace_id AND asset.id = ref.asset_id
           AND asset.lifecycle_state = 'active' AND asset.inspection_status = 'accepted'
        `;
        if (Number(matched[0]?.count ?? 0) !== references.length) {
          throw new Error("Document Asset checkpoint contains an unavailable reference");
        }
        const released = await tx`
          WITH desired AS (
            SELECT node_id, asset_id
            FROM jsonb_to_recordset(${referenceJson}::jsonb) AS item(node_id uuid, asset_id uuid)
          )
          UPDATE asset_references ref
          SET released_at = now()
          WHERE ref.workspace_id = ${workspaceId}
            AND ref.document_id = ${documentId}
            AND ref.referrer_type = 'document_node'
            AND ref.relation = 'source'
            AND ref.released_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM desired
              WHERE desired.node_id = ref.referrer_id AND desired.asset_id = ref.asset_id
            )
          RETURNING ref.id
        `;
        await tx`
          INSERT INTO cloud_document_asset_checkpoints
            (workspace_id, document_id, revision, reference_digest, asset_reference_count, checkpointed_by)
          VALUES (${workspaceId}, ${documentId}, ${revision}, ${referenceDigest}, ${references.length}, ${actorId})
          ON CONFLICT (workspace_id, document_id) DO UPDATE SET
            revision = EXCLUDED.revision,
            reference_digest = EXCLUDED.reference_digest,
            asset_reference_count = EXCLUDED.asset_reference_count,
            checkpointed_by = EXCLUDED.checkpointed_by,
            checkpointed_at = now()
        `;
        return { revision, activeReferenceCount: references.length, releasedReferenceCount: released.length, replayed: false };
      });
    }
  });
}
