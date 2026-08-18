import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createJobRepository } from "../../src/repositories/job-repository.js";

const integration = Bun.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration("durable job PostgreSQL repository", () => {
  const sql = new SQL(Bun.env.DATABASE_URL ?? "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku");
  const jobId = crypto.randomUUID();
  const exhaustedJobId = crypto.randomUUID();

  afterAll(async () => {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM job_attempts WHERE job_id IN (${jobId}, ${exhaustedJobId})`;
      await tx`DELETE FROM jobs WHERE id IN (${jobId}, ${exhaustedJobId})`;
    });
    await sql.close();
  });

  test("leases once, records retry history, and completes a later attempt", async () => {
    await sql`
      INSERT INTO jobs
        (id, job_type, schema_version, partition_key, idempotency_key, payload, max_attempts)
      VALUES
        (${jobId}, 'integration.verify', 1, ${jobId}, ${`integration-job:${jobId}`},
         ${JSON.stringify({ resourceId: jobId })}::text::jsonb, 3)
    `;
    const repository = createJobRepository(sql);
    const [first, second] = await Promise.all([
      repository.claimBatch({ jobType: "integration.verify", leaseOwner: "worker-a", leaseSeconds: 30, batchSize: 1 }),
      repository.claimBatch({ jobType: "integration.verify", leaseOwner: "worker-b", leaseSeconds: 30, batchSize: 1 })
    ]);
    const claimed = [...first, ...second];
    expect(claimed).toHaveLength(1);
    const firstOwner = first.length ? "worker-a" : "worker-b";
    expect(await repository.fail({
      job: claimed[0], leaseOwner: firstOwner, retryable: true,
      delaySeconds: 0, errorCode: "temporary_unavailable"
    })).toEqual({ status: "queued" });

    const retried = await repository.claimBatch({
      jobType: "integration.verify", leaseOwner: "worker-c", leaseSeconds: 30, batchSize: 1
    });
    expect(retried[0]).toMatchObject({ id: jobId, attemptCount: 2 });
    await repository.complete({ job: retried[0], leaseOwner: "worker-c" });

    const jobs = await sql`SELECT job_status, attempt_count FROM jobs WHERE id = ${jobId}`;
    const attempts = await sql`
      SELECT attempt_number, outcome, error_code
      FROM job_attempts WHERE job_id = ${jobId} ORDER BY attempt_number
    `;
    expect(jobs[0]).toMatchObject({ job_status: "completed", attempt_count: 2 });
    expect(attempts).toEqual([
      { attempt_number: 1, outcome: "retry", error_code: "temporary_unavailable" },
      { attempt_number: 2, outcome: "completed", error_code: null }
    ]);
  });

  test("dead-letters an exhausted job whose worker lease expired", async () => {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO jobs
          (id, job_type, schema_version, partition_key, idempotency_key, payload,
           job_status, lease_owner, lease_expires_at, attempt_count, max_attempts)
        VALUES
          (${exhaustedJobId}, 'integration.expired', 1, ${exhaustedJobId},
           ${`integration-expired:${exhaustedJobId}`}, '{}'::jsonb,
           'processing', 'lost-worker', now() - interval '1 minute', 3, 3)
      `;
      await tx`
        INSERT INTO job_attempts (job_id, attempt_number, worker_instance_id)
        VALUES (${exhaustedJobId}, 3, 'lost-worker')
      `;
    });
    const repository = createJobRepository(sql);
    expect(await repository.claimBatch({
      jobType: "integration.expired", leaseOwner: "worker-d", leaseSeconds: 30, batchSize: 1
    })).toEqual([]);
    const jobs = await sql`SELECT job_status FROM jobs WHERE id = ${exhaustedJobId}`;
    const attempts = await sql`
      SELECT outcome, error_code FROM job_attempts
      WHERE job_id = ${exhaustedJobId} AND attempt_number = 3
    `;
    expect(jobs[0].job_status).toBe("dead_letter");
    expect(attempts[0]).toEqual({ outcome: "failed", error_code: "lease_expired" });
  });
});
