import { describe, expect, test } from "bun:test";
import { createAssetRepository } from "../src/repositories/asset-repository.js";

function fakeSql(responses) {
  const statements = [];
  const tx = async (strings) => {
    statements.push(strings.join(" ").replace(/\s+/g, " ").trim());
    return responses.shift();
  };
  return {
    statements,
    begin: async (operation) => operation(tx)
  };
}

describe("Asset repository SQL boundary", () => {
  test("returns one deduplicated Asset with an independently counted reference", async () => {
    const candidate = {
      id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), mediaType: "image/png",
      byteSize: 3, contentHash: "a".repeat(64), storageKey: "workspace-key", createdBy: crypto.randomUUID()
    };
    const sql = fakeSql([
      [{
        id: candidate.id, workspace_id: candidate.workspaceId, media_type: candidate.mediaType,
        byte_size: "3", content_hash: candidate.contentHash, storage_key: candidate.storageKey,
        created: true
      }],
      [{ id: crypto.randomUUID() }],
      [{ active_count: "1" }]
    ]);
    const result = await createAssetRepository(sql).claimContentAddressedAsset({
      candidate,
      reference: {
        id: crypto.randomUUID(), referrerType: "document_node",
        referrerId: crypto.randomUUID(), relation: "source"
      }
    });

    expect(result).toMatchObject({ assetId: candidate.id, assetCreated: true, referenceCreated: true, activeReferenceCount: 1 });
    expect(sql.statements[0]).toContain("ON CONFLICT (storage_key)");
    expect(sql.statements[1]).toContain("WHERE released_at IS NULL");
  });

  test("rejects database metadata that conflicts at the same workspace hash", async () => {
    const candidate = {
      id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), mediaType: "image/png",
      byteSize: 3, contentHash: "b".repeat(64), storageKey: "expected-key", createdBy: crypto.randomUUID()
    };
    const sql = fakeSql([[{
      id: crypto.randomUUID(), workspace_id: candidate.workspaceId, media_type: candidate.mediaType,
      byte_size: "3", content_hash: candidate.contentHash, storage_key: "conflicting-key", created: false
    }]]);
    await expect(createAssetRepository(sql).claimContentAddressedAsset({
      candidate,
      reference: {
        id: crypto.randomUUID(), referrerType: "document_node",
        referrerId: crypto.randomUUID(), relation: "source"
      }
    })).rejects.toThrow("metadata conflict");
    expect(sql.statements).toHaveLength(1);
  });

  test("soft-releases a reference and reports the remaining count", async () => {
    const assetId = crypto.randomUUID();
    const sql = fakeSql([[{ asset_id: assetId }], [{ active_count: "2" }]]);
    const result = await createAssetRepository(sql).releaseAssetReference({
      workspaceId: crypto.randomUUID(), referenceId: crypto.randomUUID()
    });
    expect(result).toEqual({ assetId, activeReferenceCount: 2 });
    expect(sql.statements[0]).toContain("SET released_at = now()");
  });
});
