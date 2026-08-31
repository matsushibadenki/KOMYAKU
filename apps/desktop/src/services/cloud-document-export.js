import { parseCanonicalDocument } from "@komyaku/document-schema";
import { cloudApiClient } from "./cloud-api.js";

export async function createVerifiedCloudDocumentExport({ token, workspaceId, document, apiClient = cloudApiClient }) {
  if (typeof token !== "string" || token.length < 1 || typeof workspaceId !== "string" || workspaceId.length < 1) {
    throw new Error("cloud_export_workspace_required");
  }
  const canonical = parseCanonicalDocument(document);
  const result = await apiClient.createVerifiedDocumentExport({
    token, workspaceId, documentId: canonical.id, document: canonical
  });
  if (!result || typeof result.artifactId !== "string" || result.documentId !== canonical.id
    || typeof result.archiveDigest !== "string" || !/^[0-9a-f]{64}$/.test(result.archiveDigest)
    || !Number.isSafeInteger(result.byteSize) || result.byteSize < 1
    || !Number.isSafeInteger(result.assetCount) || result.assetCount < 0
    || result.formatVersion !== 1) throw new Error("invalid_cloud_export_response");
  return result;
}
