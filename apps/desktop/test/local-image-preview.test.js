import { describe, expect, test } from "bun:test";
import { resolveLocalPngPreview } from "../src/services/local-image-preview.js";

function pngHeader() {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, 4);
  new DataView(bytes.buffer).setUint32(20, 5);
  return bytes;
}

async function hash(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

describe("Local PNG preview resolver", () => {
  test("rechecks SQLite bytes and returns the same static Descriptor boundary", async () => {
    const bytes = pngHeader();
    const descriptor = await resolveLocalPngPreview({
      assetId: "00000000-0000-4000-8000-000000000901",
      altText: "Local figure",
      language: "en",
      backend: {
        async load() {
          return {
            bytes: [...bytes], byte_size: bytes.byteLength, content_hash: await hash(bytes),
            detected_media_type: "image/png", inspection_status: "accepted",
            inspection_policy_version: "decoder-backed-png-v1",
            inspected_width: 4, inspected_height: 5
          };
        }
      }
    });
    expect(descriptor).toMatchObject({ kind: "static-html", sandbox: "", allow: "" });
    expect(descriptor.document).toContain("Local figure");
  });

  test("rejects missing and integrity-mismatched local previews", async () => {
    const assetId = "00000000-0000-4000-8000-000000000902";
    await expect(resolveLocalPngPreview({
      assetId, backend: { async load() { return null; } }
    })).rejects.toThrow("local_preview_not_found");
    const bytes = pngHeader();
    await expect(resolveLocalPngPreview({
      assetId,
      backend: {
        async load() {
          return {
            bytes, byte_size: bytes.byteLength, content_hash: "0".repeat(64),
            detected_media_type: "image/png", inspection_status: "accepted",
            inspection_policy_version: "decoder-backed-png-v1",
            inspected_width: 4, inspected_height: 5
          };
        }
      }
    })).rejects.toThrow("local_preview_integrity_mismatch");
  });
});
