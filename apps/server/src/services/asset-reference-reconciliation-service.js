import { createHash } from "node:crypto";
import { z } from "zod";

const requestSchema = z.object({
  workspaceId: z.string().uuid(),
  documentId: z.string().uuid(),
  actorId: z.string().uuid(),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  references: z.array(z.object({ nodeId: z.string().uuid(), assetId: z.string().uuid() }).strict()).max(5000)
}).strict();

export function createAssetReferenceReconciliationService({ repository }) {
  if (!repository?.reconcile) throw new Error("Asset reference reconciliation repository is required");
  return Object.freeze({
    async reconcile(input) {
      const request = requestSchema.parse(input);
      const seenNodes = new Set();
      for (const reference of request.references) {
        if (seenNodes.has(reference.nodeId)) throw new Error("Duplicate document Asset Node identity");
        seenNodes.add(reference.nodeId);
      }
      const references = [...request.references].sort((a, b) => a.nodeId.localeCompare(b.nodeId));
      const referenceDigest = createHash("sha256").update(JSON.stringify(references)).digest("hex");
      return repository.reconcile({ ...request, references, referenceDigest });
    }
  });
}
