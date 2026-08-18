import { z } from "zod";

const policySchema = z.object({
  completedJobDays: z.number().int().min(30).max(3650).default(90),
  operatorAuditDays: z.number().int().min(365).max(3650).default(2555)
});

function before(now, days) {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

export function createRetentionService({ repository, now = () => new Date() }) {
  if (!repository?.preview || !repository?.apply) throw new Error("Retention repository is required");
  function policy(input) {
    const parsed = policySchema.parse(input ?? {});
    const current = now();
    return {
      now: current.toISOString(),
      completedJobsBefore: before(current, parsed.completedJobDays),
      auditBefore: before(current, parsed.operatorAuditDays),
      policy: parsed
    };
  }
  return Object.freeze({
    async preview(input) {
      const resolved = policy(input);
      return { policy: resolved.policy, candidates: await repository.preview(resolved) };
    },
    async apply({ operatorId, reason, ...input }) {
      const identity = z.string().trim().min(1).max(200).parse(operatorId);
      const explanation = z.string().trim().min(1).max(1000).parse(reason);
      const resolved = policy(input);
      return repository.apply({ ...resolved, operatorId: identity, reason: explanation });
    }
  });
}
