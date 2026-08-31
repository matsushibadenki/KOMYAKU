import { cloudApiClient } from "./cloud-api.js";

export async function resolveCloudPngPreview({
  token,
  workspaceId,
  assetId,
  altText = "",
  language = "und",
  apiClient = cloudApiClient
}) {
  if (typeof token !== "string" || token.length < 1) throw new Error("cloud_preview_session_required");
  if (typeof workspaceId !== "string" || typeof assetId !== "string") {
    throw new Error("invalid_cloud_preview_identity");
  }
  const result = await apiClient.acceptedPngPreview({ token, workspaceId, assetId });
  const { renderAcceptedPngPreview } = await import("@komyaku/preview-core");
  return renderAcceptedPngPreview({
    bytes: result.bytes,
    inspection: result.inspection,
    altText,
    language
  });
}
