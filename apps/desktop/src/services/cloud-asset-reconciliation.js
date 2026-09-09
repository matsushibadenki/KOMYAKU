import { parseCanonicalDocument } from "@komyaku/document-schema";
import { cloudApiClient, cloudApiBaseUrl } from "./cloud-api.js";
import { cloudReferenceReleaseQueue, releaseCloudReference } from "./cloud-reference-release.js";
import { scheduleReferenceReleases } from "./reference-release-queue.js";

function scheduleCleanup({ apiClient, workspaceId, token }) {
  if (apiClient !== cloudApiClient) return;
  const queue = cloudReferenceReleaseQueue();
  if (!queue) return;
  return scheduleReferenceReleases({ authority: cloudApiBaseUrl, queue, workspaceId, token,
    release: (request) => releaseCloudReference({ ...request, apiClient }, { queue }) });
}

export function collectCanonicalAssetReferences(input) {
  const document = parseCanonicalDocument(input);
  const references = [];
  const seen = new Set();
  const stack = [...document.content];
  while (stack.length > 0) {
    const node = stack.pop();
    if (node.assetId) {
      if (seen.has(node.id)) throw new Error("duplicate_asset_node_identity");
      seen.add(node.id);
      references.push({ nodeId: node.id, assetId: node.assetId });
    }
    const children = node.content ?? node.caption ?? [];
    if (Array.isArray(children)) stack.push(...children);
  }
  return references.sort((a, b) => a.nodeId.localeCompare(b.nodeId));
}

export async function reconcileCloudDocumentAssets({
  token, workspaceId, document, revision, apiClient = cloudApiClient,
  scheduleReleaseCleanup = scheduleCleanup
}) {
  if (typeof token !== "string" || token.length < 1 || typeof workspaceId !== "string" || workspaceId.length < 1
    || !Number.isSafeInteger(revision) || revision < 1) throw new Error("invalid_cloud_asset_checkpoint");
  const canonical = parseCanonicalDocument(document);
  const result = await apiClient.reconcileDocumentAssets({
    token, workspaceId, documentId: canonical.id, revision,
    references: collectCanonicalAssetReferences(canonical)
  });
  try {
    void Promise.resolve(scheduleReleaseCleanup({ apiClient, workspaceId, token }))
      .catch(() => { /* Cleanup cannot change a successful checkpoint. */ });
  } catch { /* A scheduler failure cannot change a successful checkpoint. */ }
  return result;
}
