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

  test("returns only an authorized hash-matching decoder-inspected PNG preview", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const contentHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
    const assetId = crypto.randomUUID();
    const service = createAssetDeliveryService({
      repository: {
        async findAuthorizedDownload() { return null; },
        async findAuthorizedPngPreview() {
          return {
            assetId, storageKey: "private-preview", contentHash,
            mediaType: "image/png", byteSize: bytes.byteLength,
            width: 1, height: 1, policyVersion: "decoder-backed-png-v1"
          };
        }
      },
      objectStore: {
        async createReadUrl() {},
        async getRange(key, start, end) {
          expect({ key, start, end }).toEqual({ key: "private-preview", start: 0, end: 3 });
          return { Body: bytes };
        }
      }
    });
    await expect(service.readPngPreview({
      workspaceId: crypto.randomUUID(), assetId, userId: crypto.randomUUID()
    })).resolves.toMatchObject({ assetId, bytes, width: 1, height: 1 });
  });

  test("rejects a PNG preview whose Object Storage bytes no longer match its hash", async () => {
    const service = createAssetDeliveryService({
      repository: {
        async findAuthorizedDownload() { return null; },
        async findAuthorizedPngPreview() {
          return {
            assetId: crypto.randomUUID(), storageKey: "private-preview",
            contentHash: "0".repeat(64), mediaType: "image/png", byteSize: 1,
            width: 1, height: 1, policyVersion: "decoder-backed-png-v1"
          };
        }
      },
      objectStore: {
        async createReadUrl() {}, async getRange() { return { Body: new Uint8Array([1]) }; }
      }
    });
    await expect(service.readPngPreview({
      workspaceId: crypto.randomUUID(), assetId: crypto.randomUUID(), userId: crypto.randomUUID()
    })).rejects.toThrow("PNG preview integrity mismatch");
  });
});
