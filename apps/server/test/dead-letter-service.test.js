import { describe, expect, test } from "bun:test";
import { createDeadLetterService } from "../src/services/dead-letter-service.js";

describe("dead-letter operations", () => {
  test("bounds listings and requires an auditable retry reason", async () => {
    const calls = [];
    const service = createDeadLetterService({
      async list(input) { calls.push(["list", input]); return []; },
      async retry(input) { calls.push(["retry", input]); return { id: input.jobId, status: "queued" }; }
    });
    expect(await service.list({ limit: 25 })).toEqual([]);
    const jobId = crypto.randomUUID();
    expect(await service.retry({
      jobId, operatorId: "operator@example.com", reason: "Storage outage resolved"
    })).toMatchObject({ id: jobId, status: "queued" });
    expect(calls[1][1]).toMatchObject({ additionalAttempts: 3 });
    await expect(service.retry({ jobId, operatorId: "operator", reason: "" })).rejects.toBeDefined();
  });

  test("does not retry a job that is no longer terminal", async () => {
    const service = createDeadLetterService({ list: async () => [], retry: async () => null });
    await expect(service.retry({
      jobId: crypto.randomUUID(), operatorId: "operator", reason: "Reviewed"
    })).rejects.toMatchObject({ code: "job_not_retryable" });
  });
});
