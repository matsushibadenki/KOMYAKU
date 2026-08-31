import { describe, expect, test } from "bun:test";
import { createAssetRetentionSafetyService } from "../src/services/asset-retention-safety-service.js";

function fixture() {
  const calls = [];
  const repository = {
    async recordEvidence(input) { calls.push(["evidence", input]); return { evidenceId: crypto.randomUUID() }; },
    async invalidateEvidence(input) { calls.push(["invalidate", input]); return { evidenceId: crypto.randomUUID() }; },
    async placeHold(input) { calls.push(["hold", input]); return { holdId: crypto.randomUUID() }; },
    async releaseHold(input) { calls.push(["release", input]); return { holdId: crypto.randomUUID() }; },
    async audit(input) { calls.push(["audit", input]); }
  };
  return { repository, calls };
}

describe("Asset retention safety service", () => {
  const base = {
    workspaceId: crypto.randomUUID(), assetId: crypto.randomUUID(),
    operatorId: "archive-operator", reason: "Verified preservation workflow"
  };
  const now = () => new Date("2026-08-31T00:00:00.000Z");

  test("records digest-bound preservation evidence with an audit summary", async () => {
    const { repository, calls } = fixture();
    const service = createAssetRetentionSafetyService({ repository, now, idFactory: () => crypto.randomUUID() });
    await service.recordEvidence({
      ...base, evidenceType: "verified_export", artifactId: crypto.randomUUID(), artifactDigest: "a".repeat(64)
    });
    expect(calls[0][0]).toBe("evidence");
    expect(calls[0][1].verifiedAt).toBe("2026-08-31T00:00:00.000Z");
    expect(calls[1][1]).toMatchObject({ action: "asset.retention_evidence_recorded", operatorId: base.operatorId });
  });

  test("places and releases only typed holds", async () => {
    const { repository, calls } = fixture();
    const service = createAssetRetentionSafetyService({ repository, now });
    const scopeId = crypto.randomUUID();
    await service.placeHold({ ...base, holdType: "legal_hold", scopeId });
    await service.releaseHold({ ...base, holdType: "legal_hold", scopeId });
    expect(calls.map(([name]) => name)).toEqual(["hold", "audit", "release", "audit"]);
    await expect(service.placeHold({ ...base, holdType: "unknown", scopeId })).rejects.toBeDefined();
  });
});
