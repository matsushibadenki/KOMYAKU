const extensions = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/gif", ".gif"],
  ["image/webp", ".webp"],
  ["application/pdf", ".pdf"],
  ["application/json", ".json"],
  ["text/plain", ".txt"],
  ["text/markdown", ".md"],
  ["text/csv", ".csv"],
  ["text/vnd.mermaid", ".mmd"]
]);

async function responseBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (typeof body?.transformToByteArray === "function") {
    return new Uint8Array(await body.transformToByteArray());
  }
  if (typeof body?.arrayBuffer === "function") return new Uint8Array(await body.arrayBuffer());
  throw new Error("Object Storage response has no readable body");
}

export function createAssetDeliveryService({ repository, objectStore, expiresIn = 60 }) {
  if (!repository?.findAuthorizedDownload) throw new Error("Asset delivery repository is required");
  if (!objectStore?.createReadUrl) throw new Error("Signed Object Storage reads are required");
  if (!Number.isInteger(expiresIn) || expiresIn < 30 || expiresIn > 300) {
    throw new Error("Asset read expiry must be between 30 and 300 seconds");
  }

  return Object.freeze({
    async readInspection({ workspaceId, assetId, userId }) {
      if (!repository.findAuthorizedInspection) {
        throw new Error("Authorized Asset inspection reads are not configured");
      }
      return repository.findAuthorizedInspection({ workspaceId, assetId, userId });
    },

    async createDownload({ workspaceId, assetId, userId }) {
      const asset = await repository.findAuthorizedDownload({ workspaceId, assetId, userId });
      if (!asset) return null;
      const extension = extensions.get(asset.detectedMediaType) ?? ".bin";
      const url = await objectStore.createReadUrl(asset.storageKey, expiresIn, {
        contentDisposition: `attachment; filename="asset-${asset.assetId}${extension}"`,
        contentType: "application/octet-stream",
        cacheControl: "private, no-store"
      });
      return {
        assetId: asset.assetId,
        mediaType: asset.detectedMediaType,
        byteSize: asset.byteSize,
        expiresIn,
        url
      };
    },

    async readPngPreview({ workspaceId, assetId, userId }) {
      if (!repository.findAuthorizedPngPreview || !objectStore.getRange) {
        throw new Error("Authorized PNG preview reads are not configured");
      }
      const asset = await repository.findAuthorizedPngPreview({ workspaceId, assetId, userId });
      if (!asset) return null;
      const response = await objectStore.getRange(asset.storageKey, 0, asset.byteSize - 1);
      const bytes = await responseBytes(response.Body);
      if (bytes.byteLength !== asset.byteSize) throw new Error("PNG preview length mismatch");
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      const contentHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (contentHash !== asset.contentHash) throw new Error("PNG preview integrity mismatch");
      return { ...asset, bytes };
    }
  });
}
