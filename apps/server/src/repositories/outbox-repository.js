function mapEvent(row) {
  return {
    id: row.id,
    aggregateType: row.aggregate_type,
    aggregateId: row.aggregate_id,
    eventType: row.event_type,
    schemaVersion: row.schema_version,
    partitionKey: row.partition_key,
    idempotencyKey: row.idempotency_key,
    payload: row.payload,
    attemptCount: row.attempt_count
  };
}

export function createOutboxRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  return Object.freeze({
    async claimBatch({ leaseOwner, leaseSeconds, batchSize }) {
      const rows = await sql`
        WITH candidates AS (
          SELECT id
          FROM outbox_events
          WHERE (event_status = 'pending' AND available_at <= now())
             OR (event_status = 'processing' AND lease_expires_at <= now())
          ORDER BY available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${batchSize}
        )
        UPDATE outbox_events AS event
        SET event_status = 'processing',
            lease_owner = ${leaseOwner},
            lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
            attempt_count = event.attempt_count + 1
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING event.*
      `;
      return rows.map(mapEvent);
    },

    async publishAsJob({ event, leaseOwner }) {
      return sql.begin(async (tx) => {
        const inserted = await tx`
          INSERT INTO jobs
            (id, outbox_event_id, job_type, schema_version, partition_key,
             idempotency_key, payload)
          VALUES
            (${event.id}, ${event.id}, ${event.eventType}, ${event.schemaVersion},
             ${event.partitionKey}, ${`outbox:${event.id}`},
             ${JSON.stringify(event.payload)}::text::jsonb)
          ON CONFLICT (idempotency_key) DO NOTHING
          RETURNING id
        `;
        const updated = await tx`
          UPDATE outbox_events
          SET event_status = 'published', published_at = COALESCE(published_at, now()),
              lease_owner = NULL, lease_expires_at = NULL
          WHERE id = ${event.id}
            AND event_status = 'processing'
            AND lease_owner = ${leaseOwner}
          RETURNING id
        `;
        if (updated.length !== 1) throw new Error("outbox_lease_lost");
        return { jobCreated: inserted.length === 1 };
      });
    },

    async releaseForRetry({ eventId, leaseOwner, delaySeconds, failed }) {
      const rows = await sql`
        UPDATE outbox_events
        SET event_status = ${failed ? "failed" : "pending"},
            available_at = now() + (${delaySeconds} * interval '1 second'),
            lease_owner = NULL,
            lease_expires_at = NULL
        WHERE id = ${eventId}
          AND event_status = 'processing'
          AND lease_owner = ${leaseOwner}
        RETURNING id
      `;
      return rows.length === 1;
    }
  });
}
