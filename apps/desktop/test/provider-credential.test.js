import { describe, expect, test } from "bun:test";
import { createProviderCredentialStore } from "../src/services/provider-credential.js";

describe("OS provider credential adapter", () => {
  test("never falls back to Web Storage", async () => {
    const store = createProviderCredentialStore({ available: () => false });
    expect(await store.load(crypto.randomUUID())).toBeNull();
    await expect(store.save(crypto.randomUUID(), "secret")).rejects.toMatchObject({
      code: "provider_credential_unavailable"
    });
  });

  test("uses fixed native commands with an opaque reference", async () => {
    const calls = [];
    const reference = crypto.randomUUID();
    const store = createProviderCredentialStore({
      available: () => true,
      invokeImpl: async (command, payload) => {
        calls.push([command, payload]);
        return command === "load_provider_credential" ? "secret" : undefined;
      }
    });
    expect(await store.load(reference)).toBe("secret");
    await store.save(reference, "secret");
    await store.clear(reference);
    expect(calls.map(([command]) => command)).toEqual([
      "load_provider_credential", "store_provider_credential", "delete_provider_credential"
    ]);
  });
});
