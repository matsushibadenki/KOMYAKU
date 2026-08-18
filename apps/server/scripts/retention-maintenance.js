import { loadRuntimeConfig } from "../src/config.js";
import { createDatabase } from "../src/database/client.js";
import { createRetentionRepository } from "../src/repositories/retention-repository.js";
import { createRetentionService } from "../src/services/retention-service.js";

const apply = Bun.argv.includes("--apply");
const config = loadRuntimeConfig();
const database = createDatabase(config);
const service = createRetentionService({ repository: createRetentionRepository(database.sql) });
const policy = {
  completedJobDays: Number(Bun.env.COMPLETED_JOB_RETENTION_DAYS || 90),
  operatorAuditDays: Number(Bun.env.OPERATOR_AUDIT_RETENTION_DAYS || 2555)
};
try {
  const result = apply
    ? await service.apply({
        ...policy,
        operatorId: Bun.env.OPERATOR_ID,
        reason: Bun.env.RETENTION_REASON
      })
    : await service.preview(policy);
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...result }, null, 2));
} finally {
  await database.close();
}
