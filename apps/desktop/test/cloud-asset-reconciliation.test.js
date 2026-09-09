import { describe, expect, test } from "bun:test";
import { collectCanonicalAssetReferences, reconcileCloudDocumentAssets } from "../src/services/cloud-asset-reconciliation.js";
import { createEmptyDocument, createCanonicalNode } from "@komyaku/document-schema";

describe("Cloud Canonical Asset reconciliation", () => {
  test("returns the saved checkpoint while cleanup is still pending", async () => {
    let release;
    let scheduled = false;
    const pending = new Promise((resolve) => { release = resolve; });
    const receipt = { revision: 1 };
    try {
      const result = await reconcileCloudDocumentAssets({ token: "token", workspaceId: crypto.randomUUID(),
        document: createEmptyDocument(), revision: 1,
        apiClient: { reconcileDocumentAssets: async () => receipt },
        scheduleReleaseCleanup: () => { scheduled = true; return pending; }
      });
      expect(scheduled).toBe(true);
      expect(result).toBe(receipt);
    } finally { release(); }
  });

  test("does not schedule cleanup after a failed authorized checkpoint", async () => {
    let scheduled = false;
    await expect(reconcileCloudDocumentAssets({ token: "token", workspaceId: crypto.randomUUID(),
      document: createEmptyDocument(), revision: 1,
      apiClient: { reconcileDocumentAssets: async () => { throw new Error("unauthorized"); } },
      scheduleReleaseCleanup: () => { scheduled = true; }
    })).rejects.toThrow("unauthorized");
    expect(scheduled).toBe(false);
  });

  test("collects stable Node-to-Asset pairs without original bytes", async () => {
    const document = createEmptyDocument();
    const file = createCanonicalNode("file", {
      assetId: crypto.randomUUID(), mediaType: "text/plain", fileName: "notes.txt", title: null, description: null
    });
    document.content.push(file);
    expect(collectCanonicalAssetReferences(document)).toEqual([{ nodeId: file.id, assetId: file.assetId }]);
    let request;
    await reconcileCloudDocumentAssets({
      token: "token", workspaceId: crypto.randomUUID(), document, revision: 3,
      apiClient: { async reconcileDocumentAssets(input) { request = input; return { revision: 3 }; } }
    });
    expect(request).toMatchObject({ documentId: document.id, revision: 3, references: [{ nodeId: file.id, assetId: file.assetId }] });
    expect(JSON.stringify(request)).not.toContain("notes.txt contents");
  });
});
