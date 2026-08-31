import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

const operatorSchema = z.object({
  operatorId: z.string().trim().min(1).max(200),
  reason: z.string().trim().min(1).max(1000)
});
const targetSchema = z.object({
  workspaceId: z.string().uuid(), assetId: z.string().uuid()
});
const evidenceSchema = targetSchema.extend({
  evidenceType: z.enum(["verified_export", "verified_archive"]),
  artifactId: z.string().uuid(),
  artifactDigest: z.string().regex(/^[0-9a-f]{64}$/)
});
const holdSchema = targetSchema.extend({
  holdType: z.enum(["published_version", "legal_hold"]),
  scopeId: z.string().uuid()
});

export function createAssetRetentionSafetyService({ repository, now = () => new Date(), idFactory = uuidv7 }) {
  if (!repository?.recordEvidence || !repository?.invalidateEvidence
    || !repository?.placeHold || !repository?.releaseHold || !repository?.audit) {
    throw new Error("Asset retention safety repository is required");
  }
  async function audited(action, input, operation) {
    const operator = operatorSchema.parse(input);
    const operationId = idFactory();
    const result = await operation(operator);
    await repository.audit({
      operatorId: operator.operatorId, action, operationId, reason: operator.reason,
      metadata: { workspaceId: input.workspaceId, assetId: input.assetId, ...result }
    });
    return result;
  }
  return Object.freeze({
    async recordEvidence(input) {
      const value = evidenceSchema.merge(operatorSchema).parse(input);
      return audited("asset.retention_evidence_recorded", value, (operator) => repository.recordEvidence({
        ...value, operatorId: operator.operatorId, verifiedAt: now().toISOString()
      }));
    },
    async placeHold(input) {
      const value = holdSchema.merge(operatorSchema).parse(input);
      return audited("asset.retention_hold_placed", value, (operator) => repository.placeHold({
        ...value, operatorId: operator.operatorId, placedAt: now().toISOString()
      }));
    },
    async invalidateEvidence(input) {
      const value = evidenceSchema.omit({ artifactDigest: true }).merge(operatorSchema).parse(input);
      return audited("asset.retention_evidence_invalidated", value, async () => {
        const invalidated = await repository.invalidateEvidence({
          ...value, invalidatedAt: now().toISOString()
        });
        if (!invalidated) throw new Error("Active Asset preservation evidence was not found");
        return invalidated;
      });
    },
    async releaseHold(input) {
      const value = holdSchema.merge(operatorSchema).parse(input);
      return audited("asset.retention_hold_released", value, async (operator) => {
        const released = await repository.releaseHold({
          ...value, operatorId: operator.operatorId, releasedAt: now().toISOString()
        });
        if (!released) throw new Error("Active Asset retention hold was not found");
        return released;
      });
    }
  });
}
