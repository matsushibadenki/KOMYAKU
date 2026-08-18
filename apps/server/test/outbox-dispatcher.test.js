import { describe, expect, test } from "bun:test";
import { createOutboxDispatcher } from "../src/services/outbox-dispatcher.js";

function event(attemptCount = 1) {
  return {
    id: crypto.randomUUID(),
    eventType: "identity.personal_account_created",
    attemptCount
  };
}

describe("transactional outbox dispatcher", () => {
  test("publishes every claimed event as an idempotent job", async () => {
    const events = [event(), event()];
    const calls = [];
    const dispatcher = createOutboxDispatcher({
      instanceId: "worker-a",
      repository: {
        async claimBatch(input) { calls.push(["claim", input]); return events; },
        async publishAsJob(input) { calls.push(["publish", input]); },
        async releaseForRetry(input) { calls.push(["retry", input]); }
      },
      log: () => {}
    });

    expect(await dispatcher.runOnce()).toEqual({ claimed: 2, published: 2, failed: 0 });
    expect(calls[0]).toEqual(["claim", {
      leaseOwner: "worker-a",
      leaseSeconds: 30,
      batchSize: 25
    }]);
    expect(calls.filter(([name]) => name === "publish")).toHaveLength(2);
  });

  test("releases transient failures with exponential backoff", async () => {
    const claimed = event(3);
    const retries = [];
    const dispatcher = createOutboxDispatcher({
      instanceId: "worker-a",
      repository: {
        async claimBatch() { return [claimed]; },
        async publishAsJob() { throw new TypeError("temporary database error"); },
        async releaseForRetry(input) { retries.push(input); }
      },
      log: () => {}
    });

    expect(await dispatcher.runOnce()).toEqual({ claimed: 1, published: 0, failed: 1 });
    expect(retries).toEqual([{
      eventId: claimed.id,
      leaseOwner: "worker-a",
      delaySeconds: 4,
      failed: false
    }]);
  });

  test("dead-letters an event after the configured attempt limit", async () => {
    const claimed = event(4);
    const retries = [];
    const dispatcher = createOutboxDispatcher({
      instanceId: "worker-a",
      maxAttempts: 4,
      repository: {
        async claimBatch() { return [claimed]; },
        async publishAsJob() { throw new Error("invalid event"); },
        async releaseForRetry(input) { retries.push(input); }
      },
      log: () => {}
    });

    await dispatcher.runOnce();
    expect(retries[0]).toMatchObject({ failed: true, delaySeconds: 0 });
  });
});
