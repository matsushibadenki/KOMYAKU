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
    async list({ limit = 50, cursor = null } = {}) {
      const parsedLimit = z.number().int().min(1).max(100).parse(limit);
      let decoded = null;
      if (cursor) {
        try {
          decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
          z.object({ time: z.string().datetime({ offset: true }), id: z.string().uuid() }).parse(decoded);
        } catch {
          throw Object.assign(new Error("Invalid dead-letter cursor"), { code: "invalid_cursor" });
        }
      }
      const rows = await repository.list({
        limit: parsedLimit + 1,
        cursorTime: decoded?.time ?? null,
        cursorId: decoded?.id ?? null
      });
      const hasMore = rows.length > parsedLimit;
      const items = rows.slice(0, parsedLimit);
      const last = items.at(-1);
      return {
        items,
        nextCursor: hasMore && last
          ? Buffer.from(JSON.stringify({ time: last.completedAt ?? last.createdAt, id: last.id })).toString("base64url")
          : null
      };
    },
    async retry(input) {
      const parsed = retrySchema.parse(input);
      const result = await repository.retry(parsed);
      if (!result) throw Object.assign(new Error("Dead-letter job not found"), { code: "job_not_retryable" });
      return result;
    }
  });
}
