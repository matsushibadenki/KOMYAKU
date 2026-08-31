import { v7 as uuidv7 } from "uuid";

export function createAssetRetentionSafetyRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");
  return Object.freeze({
    async recordEvidence({ workspaceId, assetId, evidenceType, artifactId, artifactDigest, operatorId, verifiedAt }) {
      return sql.begin(async (tx) => {
        const assets = await tx`
          SELECT id FROM assets
          WHERE workspace_id = ${workspaceId} AND id = ${assetId}
            AND storage_mode = 'content-addressed'
            AND inspection_status = 'accepted'
            AND lifecycle_state <> 'deleted'
          FOR UPDATE
        `;
        if (!assets[0]) throw new Error("Asset is not eligible for preservation evidence");
        const rows = await tx`
          INSERT INTO asset_preservation_evidence
            (id, workspace_id, asset_id, evidence_type, artifact_id, artifact_digest, verified_by, verified_at)
          VALUES (${uuidv7()}, ${workspaceId}, ${assetId}, ${evidenceType}, ${artifactId},
                  ${artifactDigest}, ${operatorId}, ${verifiedAt})
          ON CONFLICT (workspace_id, asset_id, evidence_type, artifact_id) DO UPDATE SET
            artifact_digest = EXCLUDED.artifact_digest,
            verified_by = EXCLUDED.verified_by,
            verified_at = EXCLUDED.verified_at,
            invalidated_at = NULL
          RETURNING id
        `;
        return { evidenceId: rows[0].id };
      });
    },

    async placeHold({ workspaceId, assetId, holdType, scopeId, reason, operatorId, placedAt }) {
      const rows = await sql`
        INSERT INTO asset_retention_holds
          (id, workspace_id, asset_id, hold_type, scope_id, reason, placed_by, placed_at)
        VALUES (${uuidv7()}, ${workspaceId}, ${assetId}, ${holdType}, ${scopeId},
                ${reason}, ${operatorId}, ${placedAt})
        ON CONFLICT (workspace_id, asset_id, hold_type, scope_id) DO UPDATE SET
          reason = EXCLUDED.reason,
          placed_by = EXCLUDED.placed_by,
          placed_at = EXCLUDED.placed_at,
          released_by = NULL,
          released_at = NULL
        RETURNING id
      `;
      return { holdId: rows[0].id };
    },

    async invalidateEvidence({ workspaceId, assetId, evidenceType, artifactId, invalidatedAt }) {
      const rows = await sql`
        UPDATE asset_preservation_evidence
        SET invalidated_at = ${invalidatedAt}
        WHERE workspace_id = ${workspaceId} AND asset_id = ${assetId}
          AND evidence_type = ${evidenceType} AND artifact_id = ${artifactId}
          AND invalidated_at IS NULL
        RETURNING id
      `;
      return rows[0] ? { evidenceId: rows[0].id } : null;
    },

    async releaseHold({ workspaceId, assetId, holdType, scopeId, operatorId, releasedAt }) {
      const rows = await sql`
        UPDATE asset_retention_holds
        SET released_by = ${operatorId}, released_at = ${releasedAt}
        WHERE workspace_id = ${workspaceId} AND asset_id = ${assetId}
          AND hold_type = ${holdType} AND scope_id = ${scopeId} AND released_at IS NULL
        RETURNING id
      `;
      return rows[0] ? { holdId: rows[0].id } : null;
    },

    async audit({ operatorId, action, operationId, reason, metadata }) {
      await sql`
        INSERT INTO operator_audit_events
          (id, operator_id, action, target_type, target_id, reason, metadata)
        VALUES (${uuidv7()}, ${operatorId}, ${action}, 'asset_retention', ${operationId},
                ${reason}, ${JSON.stringify(metadata)}::text::jsonb)
      `;
    }
  });
}
