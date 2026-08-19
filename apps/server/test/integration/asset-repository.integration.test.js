import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createAssetRepository } from "../../src/repositories/asset-repository.js";

const integration = Bun.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration("content-addressed Asset PostgreSQL repository", () => {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const sql = new SQL(Bun.env.DATABASE_URL ?? "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku");

  beforeAll(async () => {
    await sql`
      INSERT INTO users (id, email, display_name, email_verified_at)
      VALUES (${userId}, ${`asset-${userId}@example.invalid`}, 'Asset owner', now())
    `;
    await sql`INSERT INTO workspaces (id, name, created_by) VALUES (${workspaceId}, 'Asset integration', ${userId})`;
    await sql`
      INSERT INTO workspace_members (workspace_id, user_id, member_role)
      VALUES (${workspaceId}, ${userId}, 'owner')
    `;
  });

  afterAll(async () => {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM asset_references WHERE workspace_id = ${workspaceId}`;
      await tx`DELETE FROM assets WHERE workspace_id = ${workspaceId}`;
      await tx`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId}`;
      await tx`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await tx`DELETE FROM users WHERE id = ${userId}`;
    });
    await sql.close();
  });

  test("deduplicates concurrent claims and counts independent active references", async () => {
    const repository = createAssetRepository(sql);
    const contentHash = "a".repeat(64);
    const storageKey = `workspaces/${workspaceId}/assets/sha256/aa/${contentHash}`;
    const referrerIds = [crypto.randomUUID(), crypto.randomUUID()];
    const claims = await Promise.all(referrerIds.map((referrerId) =>
      repository.claimContentAddressedAsset({
        candidate: {
          id: crypto.randomUUID(), workspaceId, mediaType: "image/png", byteSize: 3,
          contentHash, storageKey, createdBy: userId
        },
        reference: {
          id: crypto.randomUUID(), referrerType: "document_node", referrerId, relation: "source"
        }
      })
    ));

    expect(new Set(claims.map((claim) => claim.assetId)).size).toBe(1);
    expect(claims.some((claim) => claim.assetCreated)).toBe(true);
    expect(Math.max(...claims.map((claim) => claim.activeReferenceCount))).toBe(2);

    const references = await sql`
      SELECT id FROM asset_references
      WHERE workspace_id = ${workspaceId} AND released_at IS NULL
      ORDER BY created_at
    `;
    const released = await repository.releaseAssetReference({ workspaceId, referenceId: references[0].id });
    expect(released.activeReferenceCount).toBe(1);

    const assets = await sql`SELECT count(*)::int AS count FROM assets WHERE workspace_id = ${workspaceId}`;
    expect(assets[0].count).toBe(1);
  });
});
