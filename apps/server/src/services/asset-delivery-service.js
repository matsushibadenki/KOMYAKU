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

export function createAssetDeliveryService({ repository, objectStore, expiresIn = 60 }) {
  if (!repository?.findAuthorizedDownload) throw new Error("Asset delivery repository is required");
  if (!objectStore?.createReadUrl) throw new Error("Signed Object Storage reads are required");
  if (!Number.isInteger(expiresIn) || expiresIn < 30 || expiresIn > 300) {
    throw new Error("Asset read expiry must be between 30 and 300 seconds");
  }

  return Object.freeze({
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
    }
  });
}
