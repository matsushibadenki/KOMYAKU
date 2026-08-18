import { v7 as uuidv7 } from "uuid";

export function createRetentionRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  async function counts(client, { now, completedJobsBefore, auditBefore }) {
    const [idempotency] = await client`
      SELECT count(*)::int AS count FROM idempotency_keys WHERE expires_at <= ${now}
    `;
    const [jobs] = await client`
      SELECT count(*)::int AS count FROM jobs
      WHERE job_status = 'completed' AND completed_at < ${completedJobsBefore}
    `;
    const [audits] = await client`
      SELECT count(*)::int AS count FROM operator_audit_events WHERE created_at < ${auditBefore}
    `;
    return {
      expiredIdempotencyKeys: idempotency.count,
      completedJobs: jobs.count,
      expiredOperatorAudits: audits.count
    };
  }

  return Object.freeze({
    preview(policy) { return counts(sql, policy); },
    async apply({ operatorId, reason, ...policy }) {
      return sql.begin(async (tx) => {
        const preview = await counts(tx, policy);
        await tx`DELETE FROM idempotency_keys WHERE expires_at <= ${policy.now}`;
        await tx`
          DELETE FROM job_attempts
          WHERE job_id IN (
            SELECT id FROM jobs WHERE job_status = 'completed' AND completed_at < ${policy.completedJobsBefore}
          )
        `;
        await tx`
          DELETE FROM jobs WHERE job_status = 'completed' AND completed_at < ${policy.completedJobsBefore}
        `;
        await tx`DELETE FROM operator_audit_events WHERE created_at < ${policy.auditBefore}`;
        const operationId = uuidv7();
        await tx`
          INSERT INTO operator_audit_events
            (id, operator_id, action, target_type, target_id, reason, metadata)
          VALUES
            (${uuidv7()}, ${operatorId}, 'retention.apply', 'maintenance', ${operationId},
             ${reason}, ${JSON.stringify(preview)}::text::jsonb)
        `;
        return { operationId, deleted: preview };
      });
    }
  });
}
