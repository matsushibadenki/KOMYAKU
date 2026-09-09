import { releaseCloudReference } from "./cloud-reference-release.js";
import { createNodeId } from "@komyaku/document-schema";
import { cloudApiClient } from "./cloud-api.js";
import { retainPreparedAsset } from "./prepared-asset.js";

const MAX_FILE_BYTES = 1024 * 1024;
const supportedMediaTypes = new Set([
  "text/plain", "text/markdown", "text/csv", "text/vnd.mermaid", "application/json"
]);

export async function prepareCloudFileInsertion({
  token, workspaceId, documentId, bytes, fileName, mediaType, title = null, description = null,
  apiClient = cloudApiClient, nodeId = createNodeId(), maxPolls = 20, pollIntervalMs = 750,
  wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}) {
  if (typeof token !== "string" || token.length < 1 || typeof workspaceId !== "string" || workspaceId.length < 1
    || typeof documentId !== "string" || documentId.length < 1
    || !(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_FILE_BYTES
    || typeof fileName !== "string" || fileName.trim().length < 1 || fileName.length > 1000
    || !supportedMediaTypes.has(mediaType)
    || !Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 100
    || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 5000) {
    throw new Error("invalid_cloud_file_insertion");
  }
  let uploaded;
  try {
    uploaded = await apiClient.uploadFileAsset({
      token, workspaceId, documentId, nodeId, fileName: fileName.trim(), mediaType, bytes
    });
    let inspection = uploaded;
    for (let attempt = 0; attempt < maxPolls && new Set(["pending", "inspecting"]).has(inspection.inspectionStatus); attempt += 1) {
      await wait(pollIntervalMs);
      inspection = await apiClient.assetInspection({ token, workspaceId, assetId: uploaded.assetId });
    }
    if (inspection.inspectionStatus !== "accepted" || inspection.detectedMediaType !== mediaType
      || inspection.policyVersion !== "baseline-signature-v1") {
      throw new Error("cloud_file_not_accepted");
    }
    return retainPreparedAsset(Object.freeze({
      nodeId, assetId: uploaded.assetId, mediaType, fileName: fileName.trim(), title, description
    }), () => releaseCloudReference({ apiClient,
      token, workspaceId, assetId: uploaded.assetId, referenceId: uploaded.referenceId
    }));
  } catch (error) {
    if (uploaded?.referenceId) {
      try {
        await releaseCloudReference({ apiClient,
          token, workspaceId, assetId: uploaded.assetId, referenceId: uploaded.referenceId
        });
      } catch { /* A later Cloud reference reconciliation pass remains the safety net. */ }
    }
    throw error;
  }
}
