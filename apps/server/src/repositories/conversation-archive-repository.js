export function createConversationArchiveRepository(sql) {
  if (typeof sql !== "function") throw new Error("SQL client is required");
  return Object.freeze({
    async findImportArchive(importId) {
      const rows = await sql`
        SELECT asset.storage_key, asset.byte_size, asset.content_hash
        FROM conversation_imports ci
        JOIN assets asset ON asset.id = ci.raw_asset_id
        WHERE ci.id = ${importId}
        LIMIT 1
      `;
      const row = rows[0];
      return row ? {
        storageKey: row.storage_key,
        byteSize: Number(row.byte_size),
        contentHash: row.content_hash
      } : null;
    }
  });
}
