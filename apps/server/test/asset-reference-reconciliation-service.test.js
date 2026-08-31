import { describe, expect, test } from "bun:test";
import { createAssetReferenceReconciliationService } from "../src/services/asset-reference-reconciliation-service.js";

describe("Cloud document Asset reconciliation service", () => {
  test("sorts references and derives a stable checkpoint digest", async () => {
    let received;
    const service = createAssetReferenceReconciliationService({
      repository: { async reconcile(input) { received = input; return { revision: input.revision }; } }
    });
    const first = { nodeId: crypto.randomUUID(), assetId: crypto.randomUUID() };
    const second = { nodeId: crypto.randomUUID(), assetId: crypto.randomUUID() };
    const input = {
      workspaceId: crypto.randomUUID(), documentId: crypto.randomUUID(), actorId: crypto.randomUUID(),
      revision: 7, references: [second, first]
    };
    await service.reconcile(input);
    expect(received.references).toEqual([first, second].sort((a, b) => a.nodeId.localeCompare(b.nodeId)));
    expect(received.referenceDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects duplicate Node identities before repository mutation", async () => {
    let called = false;
    const service = createAssetReferenceReconciliationService({
      repository: { async reconcile() { called = true; } }
    });
    const nodeId = crypto.randomUUID();
    await expect(service.reconcile({
      workspaceId: crypto.randomUUID(), documentId: crypto.randomUUID(), actorId: crypto.randomUUID(), revision: 1,
      references: [{ nodeId, assetId: crypto.randomUUID() }, { nodeId, assetId: crypto.randomUUID() }]
    })).rejects.toThrow("Duplicate document Asset Node identity");
    expect(called).toBe(false);
  });
});
