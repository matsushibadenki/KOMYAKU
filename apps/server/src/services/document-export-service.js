import { collectAssetIds, parseCanonicalDocument } from "@komyaku/document-schema";
import { createKomyakuArchive, verifyKomyakuArchive } from "@komyaku/archive-core";
import { buildArchiveObjectKey } from "@komyaku/storage-core";
import { v7 as uuidv7 } from "uuid";

async function bodyBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (typeof body?.transformToByteArray === "function") return new Uint8Array(await body.transformToByteArray());
  if (typeof body?.arrayBuffer === "function") return new Uint8Array(await body.arrayBuffer());
  throw new Error("Export object has no readable body");
}

export function createDocumentExportService({ repository, objectStore, now = () => new Date(), idFactory = uuidv7 }) {
  if (!repository?.findExportAssets || !repository?.recordVerifiedExport || !repository?.listVerifiedExports
    || !repository?.findAuthorizedExport || !repository?.invalidateVerifiedExport) throw new Error("Document export repository is required");
  if (!objectStore?.get || !objectStore?.putImmutable || !objectStore?.createReadUrl) throw new Error("Document export Object Storage is required");
  return Object.freeze({
    async createVerifiedExport({ workspaceId, documentId, actorId, document: input }) {
      const document = parseCanonicalDocument(input);
      if (document.id !== documentId) throw new Error("Document export identity mismatch");
      const assetIds = collectAssetIds(document).sort();
      const descriptors = await repository.findExportAssets({ workspaceId, actorId, assetIds });
      if (descriptors.length !== assetIds.length || descriptors.some((asset) => !assetIds.includes(asset.id))) {
        throw new Error("Document export contains an unavailable Asset");
      }
      const assets = [];
      for (const descriptor of descriptors) {
        const bytes = await bodyBytes((await objectStore.get(descriptor.storageKey)).Body);
        if (bytes.byteLength !== descriptor.byteSize) throw new Error("Document export Asset size mismatch");
        assets.push({ id: descriptor.id, mediaType: descriptor.mediaType, bytes });
      }
      const verifiedAt = now().toISOString();
      const archive = await createKomyakuArchive({ document, assets, createdAt: verifiedAt });
      const firstVerification = await verifyKomyakuArchive(archive);
      for (const asset of firstVerification.manifest.assets) {
        const descriptor = descriptors.find(({ id }) => id === asset.id);
        if (!descriptor || descriptor.contentHash !== asset.sha256 || descriptor.mediaType !== asset.mediaType) {
          throw new Error("Document export Asset integrity mismatch");
        }
      }
      const artifactId = idFactory();
      const storageKey = buildArchiveObjectKey({
        workspaceId, documentId, artifactId, contentHash: firstVerification.archiveDigest
      });
      await objectStore.putImmutable({
        key: storageKey, body: archive, contentType: "application/vnd.komyaku.archive+zip",
        metadata: { "workspace-id": workspaceId, "document-id": documentId, "archive-format-version": "1" }
      });
      const persisted = await bodyBytes((await objectStore.get(storageKey)).Body);
      const verification = await verifyKomyakuArchive(persisted);
      if (verification.archiveDigest !== firstVerification.archiveDigest) throw new Error("Persisted export integrity mismatch");
      await repository.recordVerifiedExport({
        workspaceId, documentId, actorId, artifactId,
        archiveDigest: verification.archiveDigest, byteSize: verification.byteSize,
        storageKey, manifest: verification.manifest, verifiedAt
      });
      return Object.freeze({
        artifactId, documentId, archiveDigest: verification.archiveDigest,
        byteSize: verification.byteSize, assetCount: verification.manifest.assets.length,
        formatVersion: verification.manifest.formatVersion, verifiedAt
      });
    },

    async listVerifiedExports({ workspaceId, documentId, actorId, limit = 50 }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw new Error("Invalid export list limit");
      return repository.listVerifiedExports({ workspaceId, documentId, actorId, limit });
    },

    async createDownload({ workspaceId, documentId, artifactId, actorId }) {
      const artifact = await repository.findAuthorizedExport({ workspaceId, documentId, artifactId, actorId });
      if (!artifact) return null;
      const url = await objectStore.createReadUrl(artifact.storageKey, 60, {
        contentDisposition: `attachment; filename="document-${documentId}.komyaku"`,
        contentType: "application/vnd.komyaku.archive+zip",
        cacheControl: "private, no-store"
      });
      return { artifactId, archiveDigest: artifact.archiveDigest, byteSize: artifact.byteSize, expiresIn: 60, url };
    },

    async invalidateVerifiedExport({ workspaceId, documentId, artifactId, actorId }) {
      return repository.invalidateVerifiedExport({
        workspaceId, documentId, artifactId, actorId, invalidatedAt: now().toISOString()
      });
    }
  });
}
