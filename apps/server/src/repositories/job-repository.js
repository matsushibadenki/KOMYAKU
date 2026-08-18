function mapJob(row) {
  return {
    id: row.id,
    jobType: row.job_type,
    schemaVersion: row.schema_version,
    partitionKey: row.partition_key,
    payload: row.payload,
    attemptCount: row.attempt_count,
    maxAttempts: row.max_attempts
  };
}

export function createJobRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  return Object.freeze({
    async claimBatch({ jobType, leaseOwner, leaseSeconds, batchSize }) {
      return sql.begin(async (tx) => {
        const exhausted = await tx`
          UPDATE jobs
          SET job_status = 'dead_letter', completed_at = now(),
              lease_owner = NULL, lease_expires_at = NULL
          WHERE job_type = ${jobType}
            AND job_status = 'processing'
            AND lease_expires_at <= now()
            AND attempt_count >= max_attempts
          RETURNING id, attempt_count
        `;
        for (const job of exhausted) {
          await tx`
            UPDATE job_attempts
            SET finished_at = now(), outcome = 'failed', error_code = 'lease_expired'
            WHERE job_id = ${job.id} AND attempt_number = ${job.attempt_count}
              AND finished_at IS NULL
          `;
        }
        const candidates = await tx`
          SELECT id, job_status, attempt_count
          FROM jobs
          WHERE job_type = ${jobType}
            AND attempt_count < max_attempts
            AND ((job_status = 'queued' AND available_at <= now())
              OR (job_status = 'processing' AND lease_expires_at <= now()))
          ORDER BY priority DESC, available_at, created_at
          FOR UPDATE SKIP LOCKED
          LIMIT ${batchSize}
        `;
        const claimed = [];
        for (const candidate of candidates) {
          if (candidate.job_status === "processing") {
            await tx`
              UPDATE job_attempts
              SET finished_at = now(), outcome = 'retry', error_code = 'lease_expired'
              WHERE job_id = ${candidate.id} AND attempt_number = ${candidate.attempt_count}
                AND finished_at IS NULL
            `;
          }
          const rows = await tx`
            UPDATE jobs
            SET job_status = 'processing',
                lease_owner = ${leaseOwner},
                lease_expires_at = now() + (${leaseSeconds} * interval '1 second'),
                attempt_count = attempt_count + 1,
                started_at = COALESCE(started_at, now())
            WHERE id = ${candidate.id}
            RETURNING *
          `;
          const job = mapJob(rows[0]);
          await tx`
            INSERT INTO job_attempts (job_id, attempt_number, worker_instance_id)
            VALUES (${job.id}, ${job.attemptCount}, ${leaseOwner})
            ON CONFLICT (job_id, attempt_number) DO UPDATE
            SET worker_instance_id = EXCLUDED.worker_instance_id,
                started_at = now(), finished_at = NULL, outcome = NULL, error_code = NULL
          `;
          claimed.push(job);
        }
        return claimed;
      });
    },

    async complete({ job, leaseOwner }) {
      return sql.begin(async (tx) => {
        const rows = await tx`
          UPDATE jobs
          SET job_status = 'completed', completed_at = now(),
              lease_owner = NULL, lease_expires_at = NULL
          WHERE id = ${job.id} AND job_status = 'processing' AND lease_owner = ${leaseOwner}
          RETURNING id
        `;
        if (rows.length !== 1) throw new Error("job_lease_lost");
        await tx`
          UPDATE job_attempts
          SET finished_at = now(), outcome = 'completed', error_code = NULL
          WHERE job_id = ${job.id} AND attempt_number = ${job.attemptCount}
        `;
      });
    },

    async fail({ job, leaseOwner, retryable, delaySeconds, errorCode }) {
      const exhausted = job.attemptCount >= job.maxAttempts;
      const status = retryable && !exhausted ? "queued" : retryable ? "dead_letter" : "failed";
      return sql.begin(async (tx) => {
        const rows = await tx`
          UPDATE jobs
          SET job_status = ${status},
              available_at = now() + (${status === "queued" ? delaySeconds : 0} * interval '1 second'),
              completed_at = CASE WHEN ${status} = 'queued' THEN NULL ELSE now() END,
              lease_owner = NULL, lease_expires_at = NULL
          WHERE id = ${job.id} AND job_status = 'processing' AND lease_owner = ${leaseOwner}
          RETURNING id
        `;
        if (rows.length !== 1) throw new Error("job_lease_lost");
        await tx`
          UPDATE job_attempts
          SET finished_at = now(), outcome = ${status === "queued" ? "retry" : "failed"},
              error_code = ${errorCode}
          WHERE job_id = ${job.id} AND attempt_number = ${job.attemptCount}
        `;
        return { status };
      });
    }
  });
}
