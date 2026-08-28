import { describe, expect, test } from "bun:test";
import { createSecureSessionStore, SecureSessionError } from "../src/services/secure-session.js";

describe("OS secure cloud session adapter", () => {
  test("does not emulate secure storage with browser storage", async () => {
    const store = createSecureSessionStore({ available: () => false });
    expect(await store.load()).toBeNull();
    await expect(store.save("token")).rejects.toMatchObject({
      name: "SecureSessionError", code: "secure_session_unavailable"
    });
    await expect(store.clear()).resolves.toBeUndefined();
  });

  test("uses only bounded native commands and returns the opaque token", async () => {
    const calls = [];
    const store = createSecureSessionStore({
      available: () => true,
      invokeImpl: async (command, payload) => {
        calls.push([command, payload]);
        return command === "load_cloud_session" ? "opaque-token" : undefined;
      }
    });
    expect(await store.load()).toBe("opaque-token");
    await store.save("opaque-token");
    await store.clear();
    expect(calls).toEqual([
      ["load_cloud_session", undefined],
      ["store_cloud_session", { token: "opaque-token" }],
      ["delete_cloud_session", undefined]
    ]);
  });

  test("does not expose native error detail", async () => {
    const store = createSecureSessionStore({
      available: () => true,
      invokeImpl: async () => { throw new Error("secret platform detail"); }
    });
    await expect(store.load()).rejects.toEqual(expect.any(SecureSessionError));
    await expect(store.load()).rejects.toMatchObject({ code: "secure_session_unavailable" });
  });
});
