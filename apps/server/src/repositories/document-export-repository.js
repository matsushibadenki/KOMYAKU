import { v7 as uuidv7 } from "uuid";

export function createDocumentExportRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");
  return Object.freeze({
    async findExportAssets({ workspaceId, actorId, assetIds }) {
      return sql.begin(async (tx) => {
        const members = await tx`
          SELECT 1 FROM workspace_members member
          JOIN users actor ON actor.id = member.user_id
          WHERE member.workspace_id = ${workspaceId} AND member.user_id = ${actorId}
            AND member.member_role IN ('owner', 'admin', 'editor')
            AND member.revoked_at IS NULL AND actor.email_verified_at IS NOT NULL
            AND actor.deleted_at IS NULL
          LIMIT 1
        `;
        if (!members[0]) throw new Error("Document export is not authorized");
        if (assetIds.length === 0) return [];
        const rows = await tx`
          WITH requested AS (
            SELECT asset_id FROM jsonb_to_recordset(${JSON.stringify(assetIds.map((assetId) => ({ assetId })))}::jsonb)
              AS item(asset_id uuid)
          )
          SELECT asset.id, asset.media_type, asset.byte_size, asset.content_hash, asset.storage_key
          FROM requested
          JOIN assets asset ON asset.id = requested.asset_id AND asset.workspace_id = ${workspaceId}
          WHERE asset.storage_mode = 'content-addressed' AND asset.lifecycle_state = 'active'
            AND asset.inspection_status = 'accepted'
        `;
        return rows.map((row) => ({
          id: row.id, mediaType: row.media_type, byteSize: Number(row.byte_size),
          contentHash: row.content_hash, storageKey: row.storage_key
        }));
      });
    },

    async recordVerifiedExport({ workspaceId, documentId, actorId, artifactId, archiveDigest, byteSize, storageKey, manifest, verifiedAt }) {
      return sql.begin(async (tx) => {
        await tx`
          INSERT INTO verified_document_exports
            (id, workspace_id, document_id, archive_digest, byte_size, storage_key, manifest, verified_by, verified_at)
          VALUES (${artifactId}, ${workspaceId}, ${documentId}, ${archiveDigest}, ${byteSize},
                  ${storageKey}, ${JSON.stringify(manifest)}::text::jsonb, ${actorId}, ${verifiedAt})
        `;
        for (const asset of manifest.assets) {
          await tx`
            INSERT INTO asset_preservation_evidence
              (id, workspace_id, asset_id, evidence_type, artifact_id, artifact_digest, verified_by, verified_at)
            VALUES (${uuidv7()}, ${workspaceId}, ${asset.id}, 'verified_export', ${artifactId},
                    ${archiveDigest}, ${actorId}, ${verifiedAt})
            ON CONFLICT (workspace_id, asset_id, evidence_type, artifact_id) DO UPDATE SET
              artifact_digest = EXCLUDED.artifact_digest, verified_by = EXCLUDED.verified_by,
              verified_at = EXCLUDED.verified_at, invalidated_at = NULL
          `;
        }
        await tx`
          INSERT INTO operator_audit_events
            (id, operator_id, action, target_type, target_id, reason, metadata)
          VALUES (${uuidv7()}, ${actorId}, 'document.export_verified', 'document_export', ${artifactId},
                  'Automated .komyaku export round-trip verification',
                  ${JSON.stringify({ workspaceId, documentId, archiveDigest, byteSize, assetCount: manifest.assets.length })}::text::jsonb)
        `;
        return { artifactId };
      });
    },

    async listVerifiedExports({ workspaceId, documentId, actorId, limit }) {
      const rows = await sql`
        SELECT export.id, export.archive_digest, export.byte_size, export.verified_at,
               jsonb_array_length(export.manifest->'assets') AS asset_count
        FROM verified_document_exports export
        JOIN workspace_members member ON member.workspace_id = export.workspace_id
          AND member.user_id = ${actorId} AND member.revoked_at IS NULL
        JOIN users actor ON actor.id = member.user_id
        WHERE export.workspace_id = ${workspaceId} AND export.document_id = ${documentId}
          AND export.invalidated_at IS NULL AND actor.email_verified_at IS NOT NULL
          AND actor.deleted_at IS NULL
        ORDER BY export.verified_at DESC, export.id DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => ({
        artifactId: row.id, archiveDigest: row.archive_digest, byteSize: Number(row.byte_size),
        assetCount: Number(row.asset_count), verifiedAt: row.verified_at
      }));
    },

    async findAuthorizedExport({ workspaceId, documentId, artifactId, actorId }) {
      const rows = await sql`
        SELECT export.id, export.archive_digest, export.byte_size, export.storage_key
        FROM verified_document_exports export
        JOIN workspace_members member ON member.workspace_id = export.workspace_id
          AND member.user_id = ${actorId} AND member.revoked_at IS NULL
        JOIN users actor ON actor.id = member.user_id
        WHERE export.workspace_id = ${workspaceId} AND export.document_id = ${documentId}
          AND export.id = ${artifactId} AND export.invalidated_at IS NULL
          AND actor.email_verified_at IS NOT NULL AND actor.deleted_at IS NULL
        LIMIT 1
      `;
      const row = rows[0];
      return row ? {
        artifactId: row.id, archiveDigest: row.archive_digest,
        byteSize: Number(row.byte_size), storageKey: row.storage_key
      } : null;
    },

    async invalidateVerifiedExport({ workspaceId, documentId, artifactId, actorId, invalidatedAt }) {
      return sql.begin(async (tx) => {
        const authorized = await tx`
          SELECT 1 FROM workspace_members member
          JOIN users actor ON actor.id = member.user_id
          WHERE member.workspace_id = ${workspaceId} AND member.user_id = ${actorId}
            AND member.member_role IN ('owner', 'admin', 'editor')
            AND member.revoked_at IS NULL AND actor.email_verified_at IS NOT NULL
            AND actor.deleted_at IS NULL LIMIT 1
        `;
        if (!authorized[0]) throw new Error("Document export invalidation is not authorized");
        const exports = await tx`
          UPDATE verified_document_exports
          SET invalidated_at = ${invalidatedAt}
          WHERE workspace_id = ${workspaceId} AND document_id = ${documentId}
            AND id = ${artifactId} AND invalidated_at IS NULL
          RETURNING archive_digest
        `;
        if (!exports[0]) return null;
        const evidence = await tx`
          UPDATE asset_preservation_evidence
          SET invalidated_at = ${invalidatedAt}
          WHERE workspace_id = ${workspaceId} AND artifact_id = ${artifactId}
            AND evidence_type = 'verified_export' AND invalidated_at IS NULL
          RETURNING id
        `;
        await tx`
          INSERT INTO operator_audit_events
            (id, operator_id, action, target_type, target_id, reason, metadata)
          VALUES (${uuidv7()}, ${actorId}, 'document.export_invalidated', 'document_export', ${artifactId},
                  'User invalidated verified .komyaku export',
                  ${JSON.stringify({ workspaceId, documentId, evidenceCount: evidence.length })}::text::jsonb)
        `;
        return { artifactId, invalidatedEvidenceCount: evidence.length };
      });
    }
  });
}
