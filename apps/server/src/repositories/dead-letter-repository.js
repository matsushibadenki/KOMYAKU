import { v7 as uuidv7 } from "uuid";

export function createDeadLetterRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");
  return Object.freeze({
    async list({ limit = 50 } = {}) {
      const rows = await sql`
        SELECT id, job_type, partition_key, job_status, attempt_count, max_attempts,
               created_at, completed_at
        FROM jobs
        WHERE job_status IN ('failed', 'dead_letter')
        ORDER BY completed_at DESC NULLS LAST, created_at DESC
        LIMIT ${limit}
      `;
      return rows.map((row) => ({
        id: row.id,
        jobType: row.job_type,
        partitionKey: row.partition_key,
        status: row.job_status,
        attemptCount: row.attempt_count,
        maxAttempts: row.max_attempts,
        createdAt: new Date(row.created_at).toISOString(),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null
      }));
    },
    async retry({ jobId, operatorId, reason, additionalAttempts }) {
      return sql.begin(async (tx) => {
        const rows = await tx`
          UPDATE jobs
          SET job_status = 'queued', available_at = now(), completed_at = NULL,
              lease_owner = NULL, lease_expires_at = NULL,
              max_attempts = max_attempts + ${additionalAttempts}
          WHERE id = ${jobId} AND job_status IN ('failed', 'dead_letter')
          RETURNING id, job_type, attempt_count, max_attempts
        `;
        const job = rows[0];
        if (!job) return null;
        await tx`
          INSERT INTO operator_audit_events
            (id, operator_id, action, target_type, target_id, reason, metadata)
          VALUES
            (${uuidv7()}, ${operatorId}, 'job.retry', 'job', ${jobId}, ${reason},
             ${JSON.stringify({
               jobType: job.job_type,
               attemptCount: job.attempt_count,
               newMaxAttempts: job.max_attempts
             })}::text::jsonb)
        `;
        return {
          id: job.id, jobType: job.job_type,
          attemptCount: job.attempt_count, maxAttempts: job.max_attempts,
          status: "queued"
        };
      });
    }
  });
}
