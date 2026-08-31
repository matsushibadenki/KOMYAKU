import { parseCanonicalDocument } from "@komyaku/document-schema";
import { verifyKomyakuArchive } from "@komyaku/archive-core";
import { v7 as uuidv7 } from "uuid";

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
const SAFE_MEDIA_TYPES = new Set([
  "image/png", "text/plain", "text/markdown", "text/csv", "text/vnd.mermaid", "application/json"
]);

export function createArchiveImportService({ repository, objectStore, inspector, now = () => new Date(), idFactory = uuidv7 }) {
  if (!repository?.materialize) throw new Error("Archive import repository is required");
  if (!objectStore?.putContentAddressed) throw new Error("Archive import Object Storage is required");
  if (!inspector?.inspect) throw new Error("Archive import media inspector is required");
  return Object.freeze({
    async importArchive({ workspaceId, actorId, bytes }) {
      if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_IMPORT_BYTES) {
        throw new Error("Invalid Archive import size");
      }
      const verified = await verifyKomyakuArchive(bytes, {
        maxArchiveBytes: MAX_IMPORT_BYTES, maxEntryBytes: 1024 * 1024, maxEntries: 5000
      });
      const candidates = [];
      for (const asset of verified.assets) {
        if (!SAFE_MEDIA_TYPES.has(asset.mediaType)) throw new Error("Archive Asset media type is not supported");
        const inspection = await inspector.inspect({
          declaredMediaType: asset.mediaType, bytes: asset.bytes, complete: true
        });
        if (inspection.decision !== "accepted" || inspection.detectedMediaType !== asset.mediaType) {
          throw new Error("Archive Asset inspection rejected");
        }
        const stored = await objectStore.putContentAddressed({
          workspaceId, body: asset.bytes, contentType: asset.mediaType,
          metadata: { "workspace-id": workspaceId, "archive-digest": verified.archiveDigest }
        });
        if (stored.contentHash !== asset.sha256 || stored.byteSize !== asset.byteSize) {
          throw new Error("Archive Asset storage integrity mismatch");
        }
        candidates.push({
          id: asset.id, mediaType: asset.mediaType, byteSize: asset.byteSize,
          contentHash: asset.sha256, storageKey: stored.key,
          detectedMediaType: inspection.detectedMediaType, policyVersion: inspection.policyVersion,
          width: inspection.width ?? null, height: inspection.height ?? null
        });
      }
      const result = await repository.materialize({
        workspaceId, actorId, importId: idFactory(), archiveDigest: verified.archiveDigest,
        document: verified.document, assets: candidates, importedAt: now().toISOString()
      });
      if (result.document) parseCanonicalDocument(result.document);
      return { ...result, archiveDigest: verified.archiveDigest, formatVersion: verified.manifest.formatVersion };
    }
  });
}
