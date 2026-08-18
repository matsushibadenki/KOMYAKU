import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createDeadLetterRepository } from "../../src/repositories/dead-letter-repository.js";

const integration = Bun.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration("dead-letter PostgreSQL operations", () => {
  const sql = new SQL(Bun.env.DATABASE_URL ?? "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku");
  const jobId = crypto.randomUUID();

  afterAll(async () => {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM operator_audit_events WHERE target_id = ${jobId}`;
      await tx`DELETE FROM jobs WHERE id = ${jobId}`;
    });
    await sql.close();
  });

  test("requeues an exact terminal job and writes operator audit atomically", async () => {
    await sql`
      INSERT INTO jobs
        (id, job_type, schema_version, partition_key, idempotency_key, payload,
         job_status, attempt_count, max_attempts, completed_at)
      VALUES
        (${jobId}, 'integration.dead', 1, ${jobId}, ${`dead:${jobId}`}, '{}'::jsonb,
         'dead_letter', 3, 3, now())
    `;
    const repository = createDeadLetterRepository(sql);
    expect((await repository.list()).some((job) => job.id === jobId)).toBe(true);
    expect(await repository.retry({
      jobId, operatorId: "integration-operator", reason: "Dependency restored", additionalAttempts: 2
    })).toMatchObject({ status: "queued", attemptCount: 3, maxAttempts: 5 });

    const audits = await sql`
      SELECT operator_id, action, reason FROM operator_audit_events WHERE target_id = ${jobId}
    `;
    expect(audits[0]).toEqual({
      operator_id: "integration-operator", action: "job.retry", reason: "Dependency restored"
    });
  });
});
