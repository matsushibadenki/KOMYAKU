import { describe, expect, test } from "bun:test";
import {
  createSessionToken,
  hashSessionToken,
  readBearerToken
} from "../src/security/session-tokens.js";

describe("session token boundary", () => {
  test("creates 256-bit URL-safe one-time tokens and stable hashes", async () => {
    const first = createSessionToken();
    const second = createSessionToken();

    expect(first).toHaveLength(43);
    expect(first).not.toBe(second);
    expect(await hashSessionToken(first)).toHaveLength(64);
    expect(await hashSessionToken(first)).toBe(await hashSessionToken(first));
  });

  test("accepts only an exact Bearer token", () => {
    const token = createSessionToken();
    expect(readBearerToken(`Bearer ${token}`)).toBe(token);
    expect(readBearerToken(`bearer ${token}`)).toBeNull();
    expect(readBearerToken("Bearer invalid")).toBeNull();
  });
});
