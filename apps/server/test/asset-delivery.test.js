import { describe, expect, test } from "bun:test";
import { createAssetDeliveryService } from "../src/services/asset-delivery-service.js";

describe("authorized Asset delivery", () => {
  test("creates a short-lived forced attachment URL for an accepted Asset", async () => {
    const calls = [];
    const assetId = crypto.randomUUID();
    const service = createAssetDeliveryService({
      repository: {
        async findAuthorizedDownload() {
          return {
            assetId, storageKey: "private-storage-key", mediaType: "image/png",
            detectedMediaType: "image/png", byteSize: 42
          };
        }
      },
      objectStore: {
        async createReadUrl(...input) { calls.push(input); return "https://signed.invalid/value"; }
      }
    });
    expect(await service.createDownload({
      workspaceId: crypto.randomUUID(), assetId, userId: crypto.randomUUID()
    })).toEqual({
      assetId, mediaType: "image/png", byteSize: 42, expiresIn: 60,
      url: "https://signed.invalid/value"
    });
    expect(calls[0]).toEqual([
      "private-storage-key", 60,
      {
        contentDisposition: `attachment; filename="asset-${assetId}.png"`,
        contentType: "application/octet-stream",
        cacheControl: "private, no-store"
      }
    ]);
  });

  test("does not call Object Storage when authorization or inspection fails", async () => {
    let signed = false;
    const service = createAssetDeliveryService({
      repository: { async findAuthorizedDownload() { return null; } },
      objectStore: { async createReadUrl() { signed = true; } }
    });
    expect(await service.createDownload({
      workspaceId: crypto.randomUUID(), assetId: crypto.randomUUID(), userId: crypto.randomUUID()
    })).toBeNull();
    expect(signed).toBe(false);
  });
});
