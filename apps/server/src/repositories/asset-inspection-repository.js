function inspectionCandidate(row) {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    storageKey: row.storage_key,
    declaredMediaType: row.media_type,
    byteSize: Number(row.byte_size),
    contentHash: row.content_hash,
    attempt: row.inspection_attempts
  };
}

export function createAssetInspectionRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  return Object.freeze({
    async claim({ instanceId, now, leaseExpiresAt, limit, maxAttempts }) {
      const rows = await sql`
        WITH candidates AS (
          SELECT id
          FROM assets
          WHERE storage_mode = 'content-addressed'
            AND lifecycle_state = 'active'
            AND inspection_attempts < ${maxAttempts}
            AND (
              (inspection_status = 'pending' AND inspection_available_at <= ${now})
              OR (inspection_status = 'inspecting' AND inspection_lease_expires_at <= ${now})
            )
          ORDER BY inspection_available_at, id
          FOR UPDATE SKIP LOCKED
          LIMIT ${limit}
        )
        UPDATE assets asset
        SET inspection_status = 'inspecting',
            inspection_attempts = inspection_attempts + 1,
            inspection_lease_owner = ${instanceId},
            inspection_lease_expires_at = ${leaseExpiresAt}
        FROM candidates
        WHERE asset.id = candidates.id
        RETURNING asset.id, asset.workspace_id, asset.storage_key, asset.media_type,
                  asset.byte_size, asset.content_hash, asset.inspection_attempts
      `;
      return rows.map(inspectionCandidate);
    },

    async complete({ id, workspaceId, instanceId, decision, detectedMediaType, policyVersion, inspectedAt }) {
      const rows = await sql`
        UPDATE assets
        SET inspection_status = ${decision},
            detected_media_type = ${detectedMediaType},
            inspection_policy_version = ${policyVersion},
            inspected_at = ${inspectedAt},
            inspection_lease_owner = NULL,
            inspection_lease_expires_at = NULL
        WHERE id = ${id}
          AND workspace_id = ${workspaceId}
          AND lifecycle_state = 'active'
          AND inspection_status = 'inspecting'
          AND inspection_lease_owner = ${instanceId}
        RETURNING id
      `;
      return rows.length === 1;
    },

    async fail({ id, workspaceId, instanceId, failedAt, retryAt, maxAttempts }) {
      const rows = await sql`
        UPDATE assets
        SET inspection_status = CASE
              WHEN inspection_attempts >= ${maxAttempts} THEN 'error'
              ELSE 'pending'
            END,
            inspection_available_at = ${retryAt},
            inspection_lease_owner = NULL,
            inspection_lease_expires_at = NULL,
            inspected_at = NULL,
            detected_media_type = NULL,
            inspection_policy_version = NULL
        WHERE id = ${id}
          AND workspace_id = ${workspaceId}
          AND inspection_status = 'inspecting'
          AND inspection_lease_owner = ${instanceId}
        RETURNING inspection_status
      `;
      return rows[0]?.inspection_status ?? null;
    }
  });
}
