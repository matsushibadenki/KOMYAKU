import { describe, expect, test } from "bun:test";
import { createRetentionService } from "../src/services/retention-service.js";

describe("operational retention policy", () => {
  test("defaults to dry-run-friendly 90-day jobs and seven-year audits", async () => {
    const calls = [];
    const service = createRetentionService({
      repository: {
        async preview(input) { calls.push(input); return { completedJobs: 2 }; },
        async apply() {}
      },
      now: () => new Date("2026-08-18T00:00:00.000Z")
    });
    expect(await service.preview()).toEqual({
      policy: { completedJobDays: 90, operatorAuditDays: 2555 },
      candidates: { completedJobs: 2 }
    });
    expect(calls[0].completedJobsBefore).toBe("2026-05-20T00:00:00.000Z");
  });

  test("requires operator identity and reason before applying deletion", async () => {
    const service = createRetentionService({
      repository: { preview: async () => ({}), apply: async (input) => input },
      now: () => new Date("2026-08-18T00:00:00.000Z")
    });
    await expect(service.apply({ operatorId: "", reason: "Routine" })).rejects.toBeDefined();
    const result = await service.apply({ operatorId: "operator", reason: "Approved retention run" });
    expect(result).toMatchObject({ operatorId: "operator", reason: "Approved retention run" });
  });
});
