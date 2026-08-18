import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createOutboxRepository } from "../../src/repositories/outbox-repository.js";

const integration = Bun.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration("transactional outbox PostgreSQL repository", () => {
  const sql = new SQL(Bun.env.DATABASE_URL ?? "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku");
  const eventId = crypto.randomUUID();
  const aggregateId = crypto.randomUUID();

  afterAll(async () => {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM jobs WHERE outbox_event_id = ${eventId}`;
      await tx`DELETE FROM outbox_events WHERE id = ${eventId}`;
    });
    await sql.close();
  });

  test("leases once and atomically publishes one idempotent job", async () => {
    await sql`
      INSERT INTO outbox_events
        (id, aggregate_type, aggregate_id, event_type, schema_version,
         partition_key, idempotency_key, payload)
      VALUES
        (${eventId}, 'integration', ${aggregateId}, 'integration.created', 1,
         ${aggregateId}, ${`integration:${eventId}`},
         ${JSON.stringify({ aggregateId })}::text::jsonb)
    `;
    const repository = createOutboxRepository(sql);
    const [first, second] = await Promise.all([
      repository.claimBatch({ leaseOwner: "worker-a", leaseSeconds: 30, batchSize: 1 }),
      repository.claimBatch({ leaseOwner: "worker-b", leaseSeconds: 30, batchSize: 1 })
    ]);
    const claimed = [...first, ...second];
    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({ id: eventId, attemptCount: 1 });

    const leaseOwner = first.length === 1 ? "worker-a" : "worker-b";
    expect(await repository.publishAsJob({ event: claimed[0], leaseOwner })).toEqual({ jobCreated: true });

    const rows = await sql`
      SELECT event.event_status, event.published_at IS NOT NULL AS published,
             count(job.id)::int AS job_count
      FROM outbox_events event
      LEFT JOIN jobs job ON job.outbox_event_id = event.id
      WHERE event.id = ${eventId}
      GROUP BY event.id
    `;
    expect(rows[0]).toMatchObject({ event_status: "published", published: true, job_count: 1 });
  });
});
