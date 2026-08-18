import { describe, expect, test } from "bun:test";
import { IdempotencyError, createIdempotencyService } from "../src/services/idempotency-service.js";

const secret = "idempotency-test-secret-that-is-long-enough";
const bytes = new TextEncoder().encode('{"title":"Draft"}');

function service(record = null) {
  const calls = [];
  const repository = {
    async acquire(input) {
      calls.push(["acquire", input]);
      return record ?? { acquired: true, record: { status: "processing", requestHash: input.requestHash } };
    },
    async complete(input) { calls.push(["complete", input]); },
    async fail(input) { calls.push(["fail", input]); }
  };
  return { calls, value: createIdempotencyService({ repository, secret }) };
}

describe("mutation idempotency boundary", () => {
  test("stores only hashes and a non-secret response reference", async () => {
    const { calls, value } = service();
    const result = await value.execute({
      scope: "conversation-import:user-1", key: "request-key-123", requestBytes: bytes,
      operation: async () => ({ status: 201, reference: "import-id", value: { created: true } })
    });
    expect(result).toMatchObject({ replayed: false, reference: "import-id" });
    expect(calls[0][1].keyHash).toHaveLength(64);
    expect(calls[0][1].requestHash).toHaveLength(64);
    expect(JSON.stringify(calls)).not.toContain("request-key-123");
    expect(calls.at(-1)[0]).toBe("complete");
  });

  test("replays a completed reference without executing the mutation", async () => {
    let executed = false;
    const requestHash = await crypto.subtle.digest("SHA-256", bytes);
    const hash = Array.from(new Uint8Array(requestHash), (value) => value.toString(16).padStart(2, "0")).join("");
    const { value } = service({
      acquired: false,
      record: { status: "completed", requestHash: hash, responseStatus: 201, responseReference: "import-id" }
    });
    const result = await value.execute({
      scope: "conversation-import:user-1", key: "request-key-123", requestBytes: bytes,
      operation: async () => { executed = true; }
    });
    expect(result).toEqual({ replayed: true, status: 201, reference: "import-id" });
    expect(executed).toBe(false);
  });

  test("rejects reuse with different request content", async () => {
    const { value } = service({
      acquired: false,
      record: { status: "completed", requestHash: "0".repeat(64), responseStatus: 201, responseReference: "old" }
    });
    await expect(value.execute({
      scope: "conversation-import:user-1", key: "request-key-123", requestBytes: bytes,
      operation: async () => ({ status: 201, reference: "new" })
    })).rejects.toBeInstanceOf(IdempotencyError);
  });

  test("marks failed operations without storing error details", async () => {
    const { calls, value } = service();
    await expect(value.execute({
      scope: "conversation-import:user-1", key: "request-key-123", requestBytes: bytes,
      operation: async () => { throw new Error("sensitive content"); }
    })).rejects.toThrow("sensitive content");
    expect(calls.at(-1)[0]).toBe("fail");
    expect(JSON.stringify(calls.at(-1))).not.toContain("sensitive content");
  });
});
