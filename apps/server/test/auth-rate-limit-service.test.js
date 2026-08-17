import { describe, expect, test } from "bun:test";
import {
  AUTH_RATE_LIMIT_POLICIES,
  createAuthRateLimitService
} from "../src/services/auth-rate-limit-service.js";

describe("distributed authentication rate limit boundary", () => {
  test("keys identifiers with a secret HMAC before repository storage", async () => {
    const calls = [];
    const service = createAuthRateLimitService({
      secret: "a-development-secret-with-at-least-32-characters",
      repository: {
        async consume(input) { calls.push(input); return { allowed: true, remaining: 4, retryAfterSeconds: 0 }; },
        async clear(input) { calls.push(input); }
      }
    });

    const first = await service.consume("loginIdentifier", "user@example.com");
    await service.consume("loginIdentifier", "user@example.com");
    await service.consume("resetIdentifier", "user@example.com");

    expect(first.allowed).toBe(true);
    expect(calls[0]).toMatchObject(AUTH_RATE_LIMIT_POLICIES.loginIdentifier);
    expect(calls[0].keyHash).toHaveLength(64);
    expect(calls[0].keyHash).toBe(calls[1].keyHash);
    expect(calls[0].keyHash).not.toBe(calls[2].keyHash);
    expect(JSON.stringify(calls)).not.toContain("user@example.com");
  });

  test("rejects missing secrets and unknown policies", async () => {
    expect(() => createAuthRateLimitService({
      secret: "short",
      repository: { consume: async () => ({}) }
    })).toThrow("at least 32");

    const service = createAuthRateLimitService({
      secret: "a-development-secret-with-at-least-32-characters",
      repository: { consume: async () => ({}) }
    });
    await expect(service.consume("unknown", "key")).rejects.toThrow("Unknown");
  });
});
