export function createAssetDeliveryRepository(sql) {
  if (typeof sql !== "function") throw new Error("SQL client is required");

  return Object.freeze({
    async findAuthorizedInspection({ workspaceId, assetId, userId }) {
      const rows = await sql`
        SELECT asset.id, asset.media_type, asset.byte_size, asset.inspection_status,
               asset.detected_media_type, asset.inspection_policy_version,
               asset.inspected_width, asset.inspected_height
        FROM assets asset
        JOIN workspace_members member
          ON member.workspace_id = asset.workspace_id
         AND member.user_id = ${userId}
         AND member.revoked_at IS NULL
        JOIN users actor ON actor.id = member.user_id
        WHERE asset.id = ${assetId}
          AND asset.workspace_id = ${workspaceId}
          AND asset.storage_mode = 'content-addressed'
          AND asset.lifecycle_state = 'active'
          AND actor.email_verified_at IS NOT NULL
          AND actor.deleted_at IS NULL
        LIMIT 1
      `;
      const row = rows[0];
      return row ? {
        assetId: row.id,
        mediaType: row.media_type,
        byteSize: Number(row.byte_size),
        inspectionStatus: row.inspection_status,
        detectedMediaType: row.detected_media_type,
        policyVersion: row.inspection_policy_version,
        width: row.inspected_width == null ? null : Number(row.inspected_width),
        height: row.inspected_height == null ? null : Number(row.inspected_height)
      } : null;
    },

    async findAuthorizedDownload({ workspaceId, assetId, userId }) {
      const rows = await sql`
        SELECT asset.id, asset.media_type, asset.detected_media_type,
               asset.inspected_width, asset.inspected_height,
               asset.byte_size, asset.storage_key
        FROM assets asset
        JOIN workspace_members member
          ON member.workspace_id = asset.workspace_id
         AND member.user_id = ${userId}
         AND member.revoked_at IS NULL
        JOIN users actor ON actor.id = member.user_id
        WHERE asset.id = ${assetId}
          AND asset.workspace_id = ${workspaceId}
          AND asset.storage_mode = 'content-addressed'
          AND asset.lifecycle_state = 'active'
          AND asset.inspection_status = 'accepted'
          AND actor.email_verified_at IS NOT NULL
          AND actor.deleted_at IS NULL
        LIMIT 1
      `;
      const row = rows[0];
      return row ? {
        assetId: row.id,
        mediaType: row.media_type,
        detectedMediaType: row.detected_media_type,
        width: row.inspected_width == null ? null : Number(row.inspected_width),
        height: row.inspected_height == null ? null : Number(row.inspected_height),
        byteSize: Number(row.byte_size),
        storageKey: row.storage_key
      } : null;
    },

    async findAuthorizedPngPreview({ workspaceId, assetId, userId }) {
      const rows = await sql`
        SELECT asset.id, asset.detected_media_type, asset.byte_size,
               asset.storage_key, asset.content_hash, asset.inspected_width,
               asset.inspected_height, asset.inspection_policy_version
        FROM assets asset
        JOIN workspace_members member
          ON member.workspace_id = asset.workspace_id
         AND member.user_id = ${userId}
         AND member.revoked_at IS NULL
        JOIN users actor ON actor.id = member.user_id
        WHERE asset.id = ${assetId}
          AND asset.workspace_id = ${workspaceId}
          AND asset.storage_mode = 'content-addressed'
          AND asset.lifecycle_state = 'active'
          AND asset.inspection_status = 'accepted'
          AND asset.detected_media_type = 'image/png'
          AND asset.inspection_policy_version = 'decoder-backed-png-v1'
          AND asset.byte_size BETWEEN 1 AND 262144
          AND asset.inspected_width IS NOT NULL
          AND asset.inspected_height IS NOT NULL
          AND actor.email_verified_at IS NOT NULL
          AND actor.deleted_at IS NULL
        LIMIT 1
      `;
      const row = rows[0];
      return row ? {
        assetId: row.id,
        mediaType: row.detected_media_type,
        byteSize: Number(row.byte_size),
        storageKey: row.storage_key,
        contentHash: row.content_hash,
        width: Number(row.inspected_width),
        height: Number(row.inspected_height),
        policyVersion: row.inspection_policy_version
      } : null;
    }
  });
}
