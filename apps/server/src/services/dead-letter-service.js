import { z } from "zod";

const retrySchema = z.object({
  jobId: z.string().uuid(),
  operatorId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1000),
  additionalAttempts: z.number().int().min(1).max(10).default(3)
});

export function createDeadLetterService(repository) {
  if (!repository?.list || !repository?.retry) throw new Error("Dead-letter repository is required");
  return Object.freeze({
    async list({ limit = 50 } = {}) {
      return repository.list({ limit: z.number().int().min(1).max(100).parse(limit) });
    },
    async retry(input) {
      const parsed = retrySchema.parse(input);
      const result = await repository.retry(parsed);
      if (!result) throw Object.assign(new Error("Dead-letter job not found"), { code: "job_not_retryable" });
      return result;
    }
  });
}
