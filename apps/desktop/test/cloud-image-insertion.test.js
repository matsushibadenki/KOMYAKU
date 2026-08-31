import { describe, expect, test } from "bun:test";
import { prepareCloudPngInsertion } from "../src/services/cloud-image-insertion.js";

const identity = {
  token: "session",
  workspaceId: crypto.randomUUID(),
  documentId: crypto.randomUUID(),
  nodeId: crypto.randomUUID(),
  assetId: crypto.randomUUID(),
  referenceId: crypto.randomUUID()
};

describe("Cloud PNG insertion boundary", () => {
  test("inserts only after decoder-backed acceptance", async () => {
    const calls = [];
    const result = await prepareCloudPngInsertion({
      ...identity,
      bytes: new Uint8Array([1, 2, 3]),
      altText: "  cloud image  ",
      pollIntervalMs: 0,
      wait: async () => {},
      apiClient: {
        async uploadPngAsset(input) {
          calls.push(["upload", input]);
          return { ...identity, mediaType: "image/png", byteSize: 3, inspectionStatus: "pending" };
        },
        async assetInspection(input) {
          calls.push(["inspect", input]);
          return {
            assetId: identity.assetId, mediaType: "image/png", byteSize: 3,
            inspectionStatus: "accepted", detectedMediaType: "image/png",
            policyVersion: "decoder-backed-png-v1", width: 640, height: 480
          };
        }
      }
    });
    expect(calls.map(([name]) => name)).toEqual(["upload", "inspect"]);
    expect(result).toEqual({
      nodeId: identity.nodeId, assetId: identity.assetId, mediaType: "image/png",
      altText: "cloud image", width: 640, height: 480
    });
  });

  test("releases the staging reference after rejection", async () => {
    let released = null;
    await expect(prepareCloudPngInsertion({
      ...identity,
      bytes: new Uint8Array([1]),
      altText: "unsafe image",
      pollIntervalMs: 0,
      wait: async () => {},
      apiClient: {
        async uploadPngAsset() {
          return { ...identity, mediaType: "image/png", byteSize: 1, inspectionStatus: "rejected" };
        },
        async releaseAssetReference(input) { released = input; }
      }
    })).rejects.toThrow("cloud_png_rejected");
    expect(released).toEqual({
      token: identity.token, workspaceId: identity.workspaceId,
      assetId: identity.assetId, referenceId: identity.referenceId
    });
  });
});
