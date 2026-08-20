import { describe, expect, test } from "bun:test";
import { createAssetLifecycleService } from "../src/services/asset-lifecycle-service.js";

function repositoryFixture(overrides = {}) {
  const calls = [];
  const repository = {
    async listKnownStorageKeys() { return []; },
    async reconcileOrphanObjects(input) { calls.push(["reconcile", input]); },
    async quarantineReferenceZero(input) { calls.push(["quarantine", input]); return []; },
    async claimDueAssetPurges() { return []; },
    async completeAssetPurge(input) { calls.push(["complete-asset", input]); return true; },
    async retryAssetPurge(input) { calls.push(["retry-asset", input]); },
    async claimDueOrphanPurges() { return []; },
    async completeOrphanPurge(input) { calls.push(["complete-orphan", input]); return true; },
    async retryOrphanPurge(input) { calls.push(["retry-orphan", input]); },
    async audit(input) { calls.push(["audit", input]); },
    ...overrides
  };
  return { repository, calls };
}

describe("Asset lifecycle maintenance", () => {
  const workspaceId = crypto.randomUUID();
  const operator = { operatorId: "maintenance-test", reason: "Approved lifecycle test" };
  const fixedNow = () => new Date("2026-08-20T00:00:00.000Z");

  test("quarantines unknown canonical objects without deleting on discovery", async () => {
    const hash = "a".repeat(64);
    const knownHash = "b".repeat(64);
    const orphanKey = `workspaces/${workspaceId}/assets/sha256/aa/${hash}`;
    const knownKey = `workspaces/${workspaceId}/assets/sha256/bb/${knownHash}`;
    const { repository, calls } = repositoryFixture({
      async listKnownStorageKeys() { return [knownKey]; }
    });
    const deleted = [];
    const service = createAssetLifecycleService({
      repository,
      now: fixedNow,
      objectStore: {
        async listPrefix() {
          return {
            objects: [
              { key: orphanKey, byteSize: 12 },
              { key: knownKey, byteSize: 20 },
              { key: `workspaces/${workspaceId}/assets/not-canonical`, byteSize: 1 }
            ]
          };
        },
        async delete(key) { deleted.push(key); }
      }
    });

    const result = await service.reconcileWorkspace({ workspaceId, ...operator });
    expect(result).toMatchObject({ scanned: 3, known: 1, quarantinedOrphans: 1, unexpectedKeys: 1 });
    expect(deleted).toEqual([]);
    const reconcile = calls.find(([name]) => name === "reconcile")[1];
    expect(reconcile.orphans[0]).toMatchObject({ storageKey: orphanKey, contentHash: hash, byteSize: 12 });
    expect(reconcile.purgeAfter).toBe("2026-09-19T00:00:00.000Z");
  });

  test("uses a recovery window before reference-zero Assets become purgeable", async () => {
    const { repository, calls } = repositoryFixture({
      async quarantineReferenceZero(input) { calls.push(["quarantine", input]); return [{ id: crypto.randomUUID() }]; }
    });
    const service = createAssetLifecycleService({
      repository, now: fixedNow,
      objectStore: { async listPrefix() { return { objects: [] }; }, async delete() {} }
    });
    expect(await service.quarantineReferenceZero({
      ...operator, policy: { inactiveDays: 2, quarantineDays: 30, retryMinutes: 60, batchSize: 25 }
    })).toMatchObject({ quarantined: 1 });
    const input = calls.find(([name]) => name === "quarantine")[1];
    expect(input.inactiveBefore).toBe("2026-08-18T00:00:00.000Z");
    expect(input.purgeAfter).toBe("2026-09-19T00:00:00.000Z");
    expect(input.limit).toBe(25);
  });

  test("purges only canonical claimed keys and retries storage failures without error details", async () => {
    const hash = "c".repeat(64);
    const good = {
      id: crypto.randomUUID(), workspaceId,
      storageKey: `workspaces/${workspaceId}/assets/sha256/cc/${hash}`,
      contentHash: hash, byteSize: 10
    };
    const invalid = {
      id: crypto.randomUUID(), workspaceId,
      storageKey: `workspaces/${workspaceId}/other/private`, contentHash: hash, byteSize: 10
    };
    const { repository, calls } = repositoryFixture({
      async claimDueAssetPurges() { return [good, invalid]; }
    });
    const deletes = [];
    const service = createAssetLifecycleService({
      repository, now: fixedNow,
      objectStore: {
        async listPrefix() { return { objects: [] }; },
        async delete(key) { deletes.push(key); throw new Error("provider secret detail"); }
      }
    });
    expect(await service.purgeDue({ ...operator })).toEqual({ claimed: 2, purged: 0, retried: 2 });
    expect(deletes).toEqual([good.storageKey]);
    expect(calls.filter(([name]) => name === "retry-asset")).toHaveLength(2);
    expect(JSON.stringify(calls)).not.toContain("provider secret detail");
  });
});
