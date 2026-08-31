import { describe, expect, test } from "bun:test";
import { prepareCloudFileInsertion } from "../src/services/cloud-file-insertion.js";

describe("Cloud File insertion boundary", () => {
  test("returns a File Node only after complete-input inspection acceptance", async () => {
    const nodeId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const referenceId = crypto.randomUUID();
    let polls = 0;
    const result = await prepareCloudFileInsertion({
      token: "token", workspaceId: crypto.randomUUID(), documentId: crypto.randomUUID(), nodeId,
      bytes: new TextEncoder().encode("# 稿脈"), fileName: "notes.md", mediaType: "text/markdown",
      wait: async () => {},
      apiClient: {
        async uploadFileAsset() {
          return { assetId, referenceId, nodeId, fileName: "notes.md", mediaType: "text/markdown", byteSize: 10, inspectionStatus: "pending" };
        },
        async assetInspection() {
          polls += 1;
          return { assetId, mediaType: "text/markdown", byteSize: 10, inspectionStatus: "accepted", detectedMediaType: "text/markdown", policyVersion: "baseline-signature-v1", width: null, height: null };
        },
        async releaseAssetReference() { throw new Error("unexpected release"); }
      }
    });
    expect(polls).toBe(1);
    expect(result).toMatchObject({ nodeId, assetId, fileName: "notes.md", mediaType: "text/markdown" });
  });

  test("releases rejected staging without creating insertion data", async () => {
    const released = [];
    await expect(prepareCloudFileInsertion({
      token: "token", workspaceId: crypto.randomUUID(), documentId: crypto.randomUUID(), nodeId: crypto.randomUUID(),
      bytes: new TextEncoder().encode("bad"), fileName: "data.json", mediaType: "application/json",
      wait: async () => {},
      apiClient: {
        async uploadFileAsset({ nodeId }) { return { assetId: crypto.randomUUID(), referenceId: crypto.randomUUID(), nodeId, fileName: "data.json", mediaType: "application/json", byteSize: 3, inspectionStatus: "rejected" }; },
        async assetInspection() { throw new Error("unexpected poll"); },
        async releaseAssetReference(value) { released.push(value); return { released: true }; }
      }
    })).rejects.toThrow("cloud_file_not_accepted");
    expect(released).toHaveLength(1);
  });
});
