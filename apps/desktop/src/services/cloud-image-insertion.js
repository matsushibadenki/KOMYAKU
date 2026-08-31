import { createNodeId } from "@komyaku/document-schema";
import { cloudApiClient } from "./cloud-api.js";

const MAX_PNG_BYTES = 256 * 1024;

function validateInput({ token, workspaceId, documentId, bytes, altText }) {
  if (typeof token !== "string" || token.length < 1 || typeof workspaceId !== "string" || workspaceId.length < 1
    || typeof documentId !== "string" || documentId.length < 1) {
    throw new Error("cloud_image_workspace_required");
  }
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_PNG_BYTES) {
    throw new Error("invalid_cloud_png_size");
  }
  if (typeof altText !== "string" || altText.trim().length === 0 || altText.length > 1000) {
    throw new Error("invalid_cloud_png_alt_text");
  }
}

export async function prepareCloudPngInsertion({
  token,
  workspaceId,
  documentId,
  bytes,
  altText,
  apiClient = cloudApiClient,
  nodeId = createNodeId(),
  maxPolls = 20,
  pollIntervalMs = 750,
  wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds))
}) {
  validateInput({ token, workspaceId, documentId, bytes, altText });
  if (!Number.isSafeInteger(maxPolls) || maxPolls < 1 || maxPolls > 100
    || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0 || pollIntervalMs > 5000) {
    throw new Error("invalid_cloud_png_poll_policy");
  }
  let uploaded;
  try {
    uploaded = await apiClient.uploadPngAsset({ token, workspaceId, documentId, nodeId, bytes });
    let inspection = uploaded;
    for (let attempt = 0; attempt < maxPolls && new Set(["pending", "inspecting"]).has(inspection.inspectionStatus); attempt += 1) {
      await wait(pollIntervalMs);
      inspection = await apiClient.assetInspection({ token, workspaceId, assetId: uploaded.assetId });
    }
    if (inspection.inspectionStatus !== "accepted") {
      throw new Error(inspection.inspectionStatus === "rejected"
        ? "cloud_png_rejected" : inspection.inspectionStatus === "error"
          ? "cloud_png_inspection_error" : "cloud_png_inspection_timeout");
    }
    return Object.freeze({
      nodeId,
      assetId: uploaded.assetId,
      mediaType: "image/png",
      altText: altText.trim(),
      width: inspection.width,
      height: inspection.height
    });
  } catch (error) {
    if (uploaded?.referenceId) {
      try {
        await apiClient.releaseAssetReference({
          token, workspaceId, assetId: uploaded.assetId, referenceId: uploaded.referenceId
        });
      } catch { /* Server reconciliation remains the final safety net. */ }
    }
    throw error;
  }
}
