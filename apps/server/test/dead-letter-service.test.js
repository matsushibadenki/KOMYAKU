import { describe, expect, test } from "bun:test";
import { createDeadLetterService } from "../src/services/dead-letter-service.js";

describe("dead-letter operations", () => {
  test("bounds listings and requires an auditable retry reason", async () => {
    const calls = [];
    const service = createDeadLetterService({
      async list(input) { calls.push(["list", input]); return []; },
      async retry(input) { calls.push(["retry", input]); return { id: input.jobId, status: "queued" }; }
    });
    expect(await service.list({ limit: 25 })).toEqual({ items: [], nextCursor: null });
    const jobId = crypto.randomUUID();
    expect(await service.retry({
      jobId, operatorId: "operator@example.com", reason: "Storage outage resolved"
    })).toMatchObject({ id: jobId, status: "queued" });
    expect(calls[1][1]).toMatchObject({ additionalAttempts: 3 });
    await expect(service.retry({ jobId, operatorId: "operator", reason: "" })).rejects.toBeDefined();
  });

  test("returns an opaque cursor without exposing payload data", async () => {
    const first = {
      id: crypto.randomUUID(), jobType: "archive.verify", partitionKey: "workspace",
      status: "dead_letter", attemptCount: 3, maxAttempts: 3,
      createdAt: "2026-08-17T00:00:00.000Z", completedAt: "2026-08-18T00:00:00.000Z"
    };
    const second = { ...first, id: crypto.randomUUID(), completedAt: "2026-08-16T00:00:00.000Z" };
    const calls = [];
    const service = createDeadLetterService({
      async list(input) { calls.push(input); return calls.length === 1 ? [first, second] : []; },
      retry: async () => null
    });
    const page = await service.list({ limit: 1 });
    expect(page.items).toEqual([first]);
    expect(page.nextCursor).toBeString();
    await service.list({ limit: 1, cursor: page.nextCursor });
    expect(calls[1]).toMatchObject({ cursorTime: first.completedAt, cursorId: first.id });
  });

  test("does not retry a job that is no longer terminal", async () => {
    const service = createDeadLetterService({ list: async () => [], retry: async () => null });
    await expect(service.retry({
      jobId: crypto.randomUUID(), operatorId: "operator", reason: "Reviewed"
    })).rejects.toMatchObject({ code: "job_not_retryable" });
  });
});
