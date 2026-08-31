import { describe, expect, test } from "bun:test";
import { createAssetReferenceReconciliationRepository } from "../src/repositories/asset-reference-reconciliation-repository.js";

function fakeSql(responses) {
  const statements = [];
  const tx = async (strings) => {
    statements.push(strings.join(" ").replace(/\s+/g, " ").trim());
    return responses.shift();
  };
  return { statements, begin: async (operation) => operation(tx) };
}

describe("Document Asset reconciliation repository", () => {
  test("validates desired accepted references before releasing stale references", async () => {
    const sql = fakeSql([[], [{ authorized: 1 }], [], [{ count: 1 }], [{ id: crypto.randomUUID() }], []]);
    const result = await createAssetReferenceReconciliationRepository(sql).reconcile({
      workspaceId: crypto.randomUUID(), documentId: crypto.randomUUID(), actorId: crypto.randomUUID(),
      revision: 2, referenceDigest: "a".repeat(64),
      references: [{ nodeId: crypto.randomUUID(), assetId: crypto.randomUUID() }]
    });
    expect(result).toEqual({ revision: 2, activeReferenceCount: 1, releasedReferenceCount: 1, replayed: false });
    expect(sql.statements[0]).toContain("pg_advisory_xact_lock");
    expect(sql.statements[1]).toContain("member_role IN");
    expect(sql.statements[3]).toContain("inspection_status = 'accepted'");
    expect(sql.statements[4]).toContain("SET released_at = now()");
  });

  test("replays the same revision and digest without releasing again", async () => {
    const digest = "b".repeat(64);
    const sql = fakeSql([[], [{ authorized: 1 }], [{ revision: "4", reference_digest: digest, asset_reference_count: 3 }]]);
    const result = await createAssetReferenceReconciliationRepository(sql).reconcile({
      workspaceId: crypto.randomUUID(), documentId: crypto.randomUUID(), actorId: crypto.randomUUID(),
      revision: 4, referenceDigest: digest, references: []
    });
    expect(result).toEqual({ revision: 4, activeReferenceCount: 3, releasedReferenceCount: 0, replayed: true });
    expect(sql.statements).toHaveLength(3);
  });
});
