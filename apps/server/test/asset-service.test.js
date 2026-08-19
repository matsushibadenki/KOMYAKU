import { describe, expect, test } from "bun:test";
import { createAssetService } from "../src/services/asset-service.js";

function ids() {
  const values = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  return { values, next: () => values.shift() };
}

function request(overrides = {}) {
  return {
    workspaceId: crypto.randomUUID(),
    actorId: crypto.randomUUID(),
    mediaType: "image/png",
    body: new Uint8Array([1, 2, 3]),
    reference: {
      referrerType: "document_node",
      referrerId: crypto.randomUUID(),
      relation: "source"
    },
    ...overrides
  };
}

describe("content-addressed Asset service", () => {
  test("authorizes before storage and atomically claims a logical reference", async () => {
    const generated = ids();
    const calls = [];
    const service = createAssetService({
      idFactory: generated.next,
      authorizeAsset: async (input) => { calls.push(["authorize", input]); return true; },
      objectStore: {
        async putContentAddressed(input) {
          calls.push(["store", input]);
          return { key: "workspaces/w/assets/sha256/00/hash", contentHash: "a".repeat(64), byteSize: 3, created: true };
        }
      },
      repository: {
        async claimContentAddressedAsset(input) {
          calls.push(["claim", input]);
          return { assetId: input.candidate.id, assetCreated: true, referenceCreated: true, activeReferenceCount: 1 };
        },
        async releaseAssetReference() {}
      }
    });
    const input = request();
    const result = await service.storeAndReference(input);

    expect(calls.map(([name]) => name)).toEqual(["authorize", "store", "claim"]);
    expect(calls[0][1]).toEqual({ workspaceId: input.workspaceId, actorId: input.actorId, action: "asset:write" });
    expect(calls[2][1].candidate).toMatchObject({
      workspaceId: input.workspaceId, mediaType: "image/png",
      byteSize: 3, contentHash: "a".repeat(64), createdBy: input.actorId
    });
    expect(calls[2][1].candidate.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result).toMatchObject({ assetCreated: true, referenceCreated: true, objectCreated: true });
  });

  test("does not reveal or write storage state to an unauthorized actor", async () => {
    let stored = false;
    const service = createAssetService({
      authorizeAsset: async () => false,
      objectStore: { async putContentAddressed() { stored = true; } },
      repository: { async claimContentAddressedAsset() {}, async releaseAssetReference() {} }
    });
    await expect(service.storeAndReference(request())).rejects.toThrow("not authorized");
    expect(stored).toBe(false);
  });

  test("enforces size limits before sending bytes to object storage", async () => {
    let stored = false;
    const service = createAssetService({
      maxAssetBytes: 2,
      authorizeAsset: async () => true,
      objectStore: { async putContentAddressed() { stored = true; } },
      repository: { async claimContentAddressedAsset() {}, async releaseAssetReference() {} }
    });
    await expect(service.storeAndReference(request())).rejects.toThrow("byte limit");
    expect(stored).toBe(false);
  });

  test("releases only the logical reference and leaves physical cleanup to retention", async () => {
    const input = { workspaceId: crypto.randomUUID(), actorId: crypto.randomUUID(), referenceId: crypto.randomUUID() };
    const calls = [];
    const service = createAssetService({
      authorizeAsset: async (authorization) => { calls.push(authorization); return true; },
      objectStore: { async putContentAddressed() {} },
      repository: {
        async claimContentAddressedAsset() {},
        async releaseAssetReference(reference) {
          calls.push(reference);
          return { assetId: crypto.randomUUID(), activeReferenceCount: 0 };
        }
      }
    });
    const result = await service.releaseReference(input);
    expect(calls).toEqual([
      { workspaceId: input.workspaceId, actorId: input.actorId, action: "asset:unlink" },
      { workspaceId: input.workspaceId, referenceId: input.referenceId }
    ]);
    expect(result.activeReferenceCount).toBe(0);
  });
});
