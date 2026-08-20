import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createAssetRepository } from "../../src/repositories/asset-repository.js";
import { createAssetLifecycleRepository } from "../../src/repositories/asset-lifecycle-repository.js";
import { createAssetInspectionRepository } from "../../src/repositories/asset-inspection-repository.js";
import { createAssetDeliveryRepository } from "../../src/repositories/asset-delivery-repository.js";

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
      await tx`DELETE FROM asset_orphan_objects WHERE workspace_id = ${workspaceId}`;
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

  test("quarantines, claims, and completes reference-zero and orphan purges", async () => {
    const repository = createAssetLifecycleRepository(sql);
    const assetId = crypto.randomUUID();
    const hash = "d".repeat(64);
    const storageKey = `workspaces/${workspaceId}/assets/sha256/dd/${hash}`;
    await sql`
      INSERT INTO assets
        (id, workspace_id, media_type, byte_size, content_hash, storage_key,
         storage_mode, created_by, created_at)
      VALUES
        (${assetId}, ${workspaceId}, 'application/octet-stream', 5, ${hash}, ${storageKey},
         'content-addressed', ${userId}, '2026-01-01T00:00:00.000Z')
    `;

    const quarantined = await repository.quarantineReferenceZero({
      inactiveBefore: "2026-08-01T00:00:00.000Z",
      quarantinedAt: "2026-08-20T00:00:00.000Z",
      purgeAfter: "2026-09-19T00:00:00.000Z",
      limit: 10
    });
    expect(quarantined.map(({ id }) => id)).toContain(assetId);
    const dueAssets = await repository.claimDueAssetPurges({
      now: "2026-09-20T00:00:00.000Z", limit: 10
    });
    expect(dueAssets.map(({ id }) => id)).toContain(assetId);
    expect(await repository.completeAssetPurge({
      id: assetId, workspaceId, purgedAt: "2026-09-20T00:00:01.000Z"
    })).toBe(true);

    const orphanHash = "e".repeat(64);
    const orphanKey = `workspaces/${workspaceId}/assets/sha256/ee/${orphanHash}`;
    await repository.reconcileOrphanObjects({
      workspaceId,
      knownStorageKeys: [],
      orphans: [{ id: crypto.randomUUID(), storageKey: orphanKey, contentHash: orphanHash, byteSize: 8 }],
      observedAt: "2026-08-20T00:00:00.000Z",
      purgeAfter: "2026-09-19T00:00:00.000Z"
    });
    const dueOrphans = await repository.claimDueOrphanPurges({
      now: "2026-09-20T00:00:00.000Z", limit: 10
    });
    expect(dueOrphans).toHaveLength(1);
    expect(await repository.completeOrphanPurge({
      id: dueOrphans[0].id, workspaceId, purgedAt: "2026-09-20T00:00:01.000Z"
    })).toBe(true);
  });

  test("leases inspection and exposes only an accepted Asset to a verified member", async () => {
    const assetId = crypto.randomUUID();
    const hash = "f".repeat(64);
    const storageKey = `workspaces/${workspaceId}/assets/sha256/ff/${hash}`;
    await sql`
      INSERT INTO assets
        (id, workspace_id, media_type, byte_size, content_hash, storage_key,
         storage_mode, created_by)
      VALUES
        (${assetId}, ${workspaceId}, 'image/png', 8, ${hash}, ${storageKey},
         'content-addressed', ${userId})
    `;
    const inspection = createAssetInspectionRepository(sql);
    const claimed = await inspection.claim({
      instanceId: "asset-integration",
      now: "2099-08-20T00:00:00.000Z",
      leaseExpiresAt: "2099-08-20T00:01:00.000Z",
      limit: 10,
      maxAttempts: 3
    });
    expect(claimed.map(({ id }) => id)).toContain(assetId);
    expect(await createAssetDeliveryRepository(sql).findAuthorizedDownload({
      workspaceId, assetId, userId
    })).toBeNull();
    expect(await inspection.complete({
      id: assetId,
      workspaceId,
      instanceId: "asset-integration",
      decision: "accepted",
      detectedMediaType: "image/png",
      policyVersion: "integration-v1",
      inspectedAt: "2099-08-20T00:00:01.000Z"
    })).toBe(true);
    expect(await createAssetDeliveryRepository(sql).findAuthorizedDownload({
      workspaceId, assetId, userId
    })).toMatchObject({ assetId, detectedMediaType: "image/png", storageKey });
    expect(await createAssetDeliveryRepository(sql).findAuthorizedDownload({
      workspaceId, assetId, userId: crypto.randomUUID()
    })).toBeNull();
  });
});
