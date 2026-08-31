import { describe, expect, test } from "bun:test";
import { createAssetLifecycleRepository } from "../src/repositories/asset-lifecycle-repository.js";

describe("Asset lifecycle retention SQL gates", () => {
  test("claims logical Assets only with evidence and without references or holds", async () => {
    let statement = "";
    const sql = async (strings) => {
      statement = strings.join(" ").replace(/\s+/g, " ").trim();
      return [];
    };
    sql.begin = async () => {};
    await createAssetLifecycleRepository(sql).claimDueAssetPurges({ now: new Date().toISOString(), limit: 10 });
    expect(statement).toContain("asset_preservation_evidence");
    expect(statement).toContain("asset_retention_holds");
    expect(statement).toContain("asset_references");
    expect(statement).toContain("true AS retention_gate_verified");
  });

  test("keeps unclassified orphan objects out of automatic physical deletion", async () => {
    let statement = "";
    const sql = async (strings) => {
      statement = strings.join(" ").replace(/\s+/g, " ").trim();
      return [];
    };
    sql.begin = async () => {};
    await createAssetLifecycleRepository(sql).claimDueOrphanPurges({ now: new Date().toISOString(), limit: 10 });
    expect(statement).toContain("AND false");
  });
});
