import { parseCanonicalDocument } from "@komyaku/document-schema";
import { cloudApiClient } from "./cloud-api.js";

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
  token, workspaceId, document, revision, apiClient = cloudApiClient
}) {
  if (typeof token !== "string" || token.length < 1 || typeof workspaceId !== "string" || workspaceId.length < 1
    || !Number.isSafeInteger(revision) || revision < 1) throw new Error("invalid_cloud_asset_checkpoint");
  const canonical = parseCanonicalDocument(document);
  return apiClient.reconcileDocumentAssets({
    token, workspaceId, documentId: canonical.id, revision,
    references: collectCanonicalAssetReferences(canonical)
  });
}
