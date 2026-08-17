import { describe, expect, test } from "bun:test";
import {
  PASSWORD_POLICY,
  assertAcceptablePassword,
  createPasswordHasher
} from "../src/security/passwords.js";

describe("password security boundary", () => {
  test("uses Argon2id with the documented work factors", async () => {
    const calls = [];
    const hasher = createPasswordHasher({
      hash: async (...args) => {
        calls.push(args);
        return "encoded";
      },
      verify: async () => true
    });

    await expect(hasher.hash("correct horse battery staple")).resolves.toBe("encoded");
    expect(calls[0][1]).toEqual({
      algorithm: "argon2id",
      memoryCost: 19_456,
      timeCost: 2
    });
  });

  test("counts Unicode code points and imposes no composition rule", () => {
    expect(assertAcceptablePassword("長い合言葉です安全な文字列abcde")).toBe("長い合言葉です安全な文字列abcde");
    expect(() => assertAcceptablePassword("短すぎます")).toThrow(`at least ${PASSWORD_POLICY.minimumCodePoints}`);
  });

  test("verifies a real Bun Argon2id hash", async () => {
    const hasher = createPasswordHasher();
    const password = "秘密の長い passphrase です";
    const hash = await hasher.hash(password);

    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await hasher.verify(password, hash)).toBe(true);
    expect(await hasher.verify("incorrect password", hash)).toBe(false);
  });
});
