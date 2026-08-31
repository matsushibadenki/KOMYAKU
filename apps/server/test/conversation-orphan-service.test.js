import { describe, expect, test } from "bun:test";
import { createConversationOrphanService } from "../src/services/conversation-orphan-service.js";

describe("Conversation import orphan reconciliation", () => {
  test("quarantines canonical unknown objects without deleting and reports unexpected keys", async () => {
    const workspaceId = crypto.randomUUID();
    const knownId = crypto.randomUUID();
    const orphanId = crypto.randomUUID();
    const prefix = `workspaces/${workspaceId}/conversation-imports/`;
    let reconciliation;
    const service = createConversationOrphanService({
      objectStore: {
        listPrefix: async () => ({ objects: [
          { key: `${prefix}${knownId}/source.bin`, byteSize: 10 },
          { key: `${prefix}${orphanId}/source.bin`, byteSize: 20 },
          { key: `${prefix}unexpected`, byteSize: 30 }
        ] })
      },
      repository: {
        listKnownStorageKeys: async () => [`${prefix}${knownId}/source.bin`],
        reconcile: async (value) => { reconciliation = value; }
      },
      now: () => new Date("2026-09-01T00:00:00.000Z"),
      idFactory: () => crypto.randomUUID()
    });
    const result = await service.reconcileWorkspace({ workspaceId, operatorId: "operator", reason: "scheduled scan" });
    expect(result).toMatchObject({ scanned: 3, known: 1, quarantinedOrphans: 1, unexpectedKeys: 1 });
    expect(reconciliation.orphans[0]).toMatchObject({ storageKey: `${prefix}${orphanId}/source.bin`, byteSize: 20 });
    expect(reconciliation.knownStorageKeys).toEqual([`${prefix}${knownId}/source.bin`]);
  });

  test("requires auditable operator input before listing storage", async () => {
    let listed = false;
    const service = createConversationOrphanService({
      objectStore: { listPrefix: async () => { listed = true; return { objects: [] }; } },
      repository: { listKnownStorageKeys: async () => [], reconcile: async () => {} }
    });
    await expect(service.reconcileWorkspace({ workspaceId: crypto.randomUUID(), operatorId: "", reason: "" })).rejects.toThrow();
    expect(listed).toBe(false);
  });
});
