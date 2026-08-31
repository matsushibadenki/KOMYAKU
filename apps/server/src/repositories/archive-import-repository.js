import { v7 as uuidv7 } from "uuid";

function remapAssets(value, mapping) {
  if (Array.isArray(value)) return value.map((item) => remapAssets(item, mapping));
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    output[key] = key === "assetId" && typeof child === "string" && mapping.has(child)
      ? mapping.get(child) : remapAssets(child, mapping);
  }
  return output;
}

function collectNodeAssetPairs(document) {
  const pairs = [];
  const stack = [...document.content];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.assetId) pairs.push({ nodeId: node.id, assetId: node.assetId, relation: "source" });
    for (const artifact of node.renderArtifacts ?? []) {
      if (artifact.assetId) pairs.push({ nodeId: node.id, assetId: artifact.assetId, relation: "render" });
    }
    const children = node.content ?? node.caption ?? [];
    if (Array.isArray(children)) stack.push(...children);
  }
  return pairs;
}

export function createArchiveImportRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");
  return Object.freeze({
    async materialize({ workspaceId, actorId, importId, archiveDigest, document, assets, importedAt }) {
      return sql.begin(async (tx) => {
        const members = await tx`
          SELECT 1 FROM workspace_members member JOIN users actor ON actor.id = member.user_id
          WHERE member.workspace_id = ${workspaceId} AND member.user_id = ${actorId}
            AND member.member_role IN ('owner', 'admin', 'editor') AND member.revoked_at IS NULL
            AND actor.email_verified_at IS NOT NULL AND actor.deleted_at IS NULL LIMIT 1
        `;
        if (!members[0]) throw new Error("Archive import is not authorized");
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${archiveDigest}`}, 0))`;
        const replay = await tx`
          SELECT imported.id, imported.document_id, imported.asset_count, document.canonical_json
          FROM cloud_archive_imports imported
          JOIN cloud_documents document ON document.workspace_id = imported.workspace_id
            AND document.id = imported.document_id
          WHERE imported.workspace_id = ${workspaceId} AND imported.archive_digest = ${archiveDigest} LIMIT 1
        `;
        if (replay[0]) return {
          importId: replay[0].id, documentId: replay[0].document_id,
          assetCount: Number(replay[0].asset_count), replayed: true, document: replay[0].canonical_json
        };
        const mapping = new Map();
        for (const asset of assets) {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${asset.contentHash}`}, 0))`;
          const rows = await tx`
            INSERT INTO assets
              (id, workspace_id, media_type, byte_size, content_hash, storage_key, storage_mode,
               created_by, inspection_status, detected_media_type, inspection_policy_version,
               inspected_width, inspected_height, inspected_at)
            VALUES (${asset.id}, ${workspaceId}, ${asset.mediaType}, ${asset.byteSize}, ${asset.contentHash},
                    ${asset.storageKey}, 'content-addressed', ${actorId}, 'accepted', ${asset.detectedMediaType},
                    ${asset.policyVersion}, ${asset.width}, ${asset.height}, ${importedAt})
            ON CONFLICT (storage_key) DO UPDATE SET lifecycle_state = 'active', quarantined_at = NULL,
              purge_after = NULL, deleted_at = NULL
            WHERE assets.lifecycle_state <> 'purging'
            RETURNING id, media_type, byte_size, content_hash
          `;
          const row = rows[0];
          if (!row || row.media_type !== asset.mediaType || Number(row.byte_size) !== asset.byteSize
            || row.content_hash !== asset.contentHash) throw new Error("Archive Asset metadata conflict");
          mapping.set(asset.id, row.id);
        }
        const remapped = remapAssets(document, mapping);
        const pairs = collectNodeAssetPairs(remapped);
        for (const pair of pairs) {
          await tx`
            INSERT INTO asset_references
              (id, workspace_id, asset_id, referrer_type, referrer_id, relation, document_id, created_by)
            VALUES (${uuidv7()}, ${workspaceId}, ${pair.assetId}, 'document_node', ${pair.nodeId},
                    ${pair.relation}, ${remapped.id}, ${actorId})
            ON CONFLICT (workspace_id, asset_id, referrer_type, referrer_id, relation)
              WHERE released_at IS NULL DO NOTHING
          `;
        }
        const documents = await tx`
          INSERT INTO cloud_documents
            (workspace_id, id, schema_version, canonical_json, revision, imported_from_digest,
             created_by, created_at, updated_at)
          VALUES (${workspaceId}, ${remapped.id}, ${remapped.schemaVersion},
                  ${JSON.stringify(remapped)}::text::jsonb, 1, ${archiveDigest}, ${actorId}, ${importedAt}, ${importedAt})
          ON CONFLICT (workspace_id, id) DO NOTHING
          RETURNING id
        `;
        if (!documents[0]) throw new Error("Archive Document identity conflict");
        const inserted = await tx`
          INSERT INTO cloud_archive_imports
            (id, workspace_id, document_id, archive_digest, asset_count, imported_by, imported_at)
          VALUES (${importId}, ${workspaceId}, ${remapped.id}, ${archiveDigest}, ${assets.length}, ${actorId}, ${importedAt})
          RETURNING id
        `;
        if (!inserted[0]) throw new Error("Archive import could not be recorded");
        await tx`
          INSERT INTO operator_audit_events
            (id, operator_id, action, target_type, target_id, reason, metadata)
          VALUES (${uuidv7()}, ${actorId}, 'archive.import_materialized', 'archive_import', ${importId},
                  'Atomic verified .komyaku Cloud materialization',
                  ${JSON.stringify({ workspaceId, documentId: remapped.id, archiveDigest, assetCount: assets.length })}::text::jsonb)
        `;
        return { importId, documentId: remapped.id, assetCount: assets.length, replayed: false, document: remapped };
      });
    }
  });
}
