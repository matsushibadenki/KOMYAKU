function mapRecord(row) {
  return {
    status: row.operation_status,
    requestHash: row.request_hash_hex,
    responseStatus: row.response_status,
    responseReference: row.response_reference
  };
}

export function createIdempotencyRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");
  return Object.freeze({
    async acquire({ id, scope, keyHash, requestHash, expiresAt }) {
      return sql.begin(async (tx) => {
        await tx`
          DELETE FROM idempotency_keys
          WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex') AND expires_at <= now()
        `;
        const inserted = await tx`
          INSERT INTO idempotency_keys
            (id, scope, key_hash, request_hash, operation_status, expires_at)
          VALUES
            (${id}, ${scope}, decode(${keyHash}, 'hex'), decode(${requestHash}, 'hex'),
             'processing', ${expiresAt})
          ON CONFLICT (scope, key_hash) DO NOTHING
          RETURNING operation_status, encode(request_hash, 'hex') AS request_hash_hex,
                    response_status, response_reference
        `;
        if (inserted[0]) return { acquired: true, record: mapRecord(inserted[0]) };
        const rows = await tx`
          SELECT operation_status, encode(request_hash, 'hex') AS request_hash_hex,
                 response_status, response_reference
          FROM idempotency_keys
          WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
          LIMIT 1
        `;
        return { acquired: false, record: mapRecord(rows[0]) };
      });
    },
    async complete({ scope, keyHash, requestHash, responseStatus, responseReference }) {
      const rows = await sql`
        UPDATE idempotency_keys
        SET operation_status = 'completed', response_status = ${responseStatus},
            response_reference = ${responseReference}
        WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
          AND request_hash = decode(${requestHash}, 'hex') AND operation_status = 'processing'
        RETURNING id
      `;
      if (rows.length !== 1) throw new Error("idempotency_ownership_lost");
    },
    async fail({ scope, keyHash, requestHash }) {
      await sql`
        UPDATE idempotency_keys SET operation_status = 'failed'
        WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
          AND request_hash = decode(${requestHash}, 'hex') AND operation_status = 'processing'
      `;
    }
  });
}
