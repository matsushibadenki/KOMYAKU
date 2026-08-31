import { describe, expect, test } from "bun:test";
import {
  createQuarantinedImageInsertion,
  listQuarantinedLocalAssets
} from "../src/services/local-asset-quarantine.js";

const summary = {
  assetId: "00000000-0000-4000-8000-000000000208",
  byteSize: 68,
  width: 1,
  height: 1,
  quarantinedAt: "2026-08-30T00:10:00.000Z"
};

describe("local Asset quarantine boundary", () => {
  test("lists bounded metadata without returning image bytes", async () => {
    const assets = await listQuarantinedLocalAssets({
      invokeCommand: async (command) => {
        expect(command).toBe("list_quarantined_local_assets");
        return [summary];
      }
    });
    expect(assets).toEqual([summary]);
    expect(assets[0]).not.toHaveProperty("bytes");
  });

  test("builds a recovery insertion only with new required alternative text", () => {
    expect(createQuarantinedImageInsertion(summary, "  recovered image  ")).toEqual({
      assetId: summary.assetId,
      byteSize: 68,
      width: 1,
      height: 1,
      mediaType: "image/png",
      altText: "recovered image"
    });
    expect(() => createQuarantinedImageInsertion(summary, " ")).toThrow("invalid_local_asset_recovery_alt_text");
  });

  test("rejects malformed or duplicate native metadata", async () => {
    await expect(listQuarantinedLocalAssets({ invokeCommand: async () => [{ ...summary, byteSize: 0 }] }))
      .rejects.toThrow("invalid_local_asset_quarantine_result");
    await expect(listQuarantinedLocalAssets({ invokeCommand: async () => [summary, summary] }))
      .rejects.toThrow("invalid_local_asset_quarantine_result");
  });
});
