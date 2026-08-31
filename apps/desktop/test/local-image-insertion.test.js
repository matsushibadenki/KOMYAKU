import { describe, expect, test } from "bun:test";
import { storeLocalPngForInsertion } from "../src/services/local-image-insertion.js";

const bytes = new Uint8Array([137, 80, 78, 71]);

describe("local image insertion boundary", () => {
  test("returns insertion attributes only after the native command accepts the same asset", async () => {
    const result = await storeLocalPngForInsertion({
      bytes,
      altText: "  one-pixel diagram  ",
      invokeCommand: async (command, payload) => {
        expect(command).toBe("store_local_png_preview_atomic");
        expect(payload.input.bytes).toEqual(Array.from(bytes));
        return {
          assetId: payload.input.assetId,
          byteSize: bytes.byteLength,
          contentHash: "a".repeat(64),
          width: 1,
          height: 1
        };
      }
    });
    expect(result.mediaType).toBe("image/png");
    expect(result.altText).toBe("one-pixel diagram");
  });

  test("fails closed on a malformed native result or missing alternative text", async () => {
    await expect(storeLocalPngForInsertion({ bytes, altText: "", invokeCommand: async () => ({}) }))
      .rejects.toThrow("invalid_local_png_alt_text");
    await expect(storeLocalPngForInsertion({
      bytes,
      altText: "diagram",
      invokeCommand: async () => ({ assetId: "wrong" })
    })).rejects.toThrow("invalid_local_png_storage_result");
  });
});
