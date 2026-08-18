import { describe, expect, test } from "bun:test";
import { JobExecutionError, createJobRunner } from "../src/services/job-runner.js";

function job(overrides = {}) {
  return {
    id: crypto.randomUUID(), jobType: "conversation.imported",
    attemptCount: 1, maxAttempts: 3, payload: {}, ...overrides
  };
}

describe("durable job runner", () => {
  test("claims only registered types and completes successful work", async () => {
    const claimed = job();
    const calls = [];
    const runner = createJobRunner({
      instanceId: "worker-a",
      handlers: { "conversation.imported": async (value) => calls.push(["handle", value.id]) },
      repository: {
        async claimBatch(input) { calls.push(["claim", input.jobType]); return [claimed]; },
        async complete(input) { calls.push(["complete", input.job.id]); },
        async fail(input) { calls.push(["fail", input.job.id]); return { status: "queued" }; }
      },
      log: () => {}
    });
    expect(await runner.runOnce()).toEqual({ claimed: 1, completed: 1, retried: 0, failed: 0 });
    expect(calls).toEqual([
      ["claim", "conversation.imported"], ["handle", claimed.id], ["complete", claimed.id]
    ]);
  });

  test("retries unexpected errors without logging their messages", async () => {
    const logs = [];
    const failures = [];
    const runner = createJobRunner({
      instanceId: "worker-a",
      handlers: { "conversation.imported": async () => { throw new Error("secret payload"); } },
      repository: {
        async claimBatch() { return [job({ attemptCount: 2 })]; },
        async complete() {},
        async fail(input) { failures.push(input); return { status: "queued" }; }
      },
      log: (value) => logs.push(value)
    });
    expect(await runner.runOnce()).toMatchObject({ retried: 1 });
    expect(failures[0]).toMatchObject({ retryable: true, delaySeconds: 10, errorCode: "unexpected_error" });
    expect(logs.join(" ")).not.toContain("secret payload");
  });

  test("marks explicit permanent failures without retry", async () => {
    const failures = [];
    const runner = createJobRunner({
      instanceId: "worker-a",
      handlers: {
        "conversation.imported": async () => {
          throw new JobExecutionError("invalid_job_payload", { retryable: false });
        }
      },
      repository: {
        async claimBatch() { return [job()]; },
        async complete() {},
        async fail(input) { failures.push(input); return { status: "failed" }; }
      },
      log: () => {}
    });
    expect(await runner.runOnce()).toMatchObject({ failed: 1 });
    expect(failures[0]).toMatchObject({ retryable: false, errorCode: "invalid_job_payload" });
  });
});
