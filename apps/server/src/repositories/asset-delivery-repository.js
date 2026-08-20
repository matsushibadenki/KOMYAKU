export function createAssetDeliveryRepository(sql) {
  if (typeof sql !== "function") throw new Error("SQL client is required");

  return Object.freeze({
    async findAuthorizedDownload({ workspaceId, assetId, userId }) {
      const rows = await sql`
        SELECT asset.id, asset.media_type, asset.detected_media_type,
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
        byteSize: Number(row.byte_size),
        storageKey: row.storage_key
      } : null;
    }
  });
}
