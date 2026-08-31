import { describe, expect, test } from "bun:test";
import { resolveCloudPngPreview } from "../src/services/cloud-image-preview.js";

function pngHeader() {
  const bytes = new Uint8Array(33);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  new DataView(bytes.buffer).setUint32(16, 2);
  new DataView(bytes.buffer).setUint32(20, 3);
  return bytes;
}

describe("Cloud PNG preview resolver", () => {
  test("keeps the Session in the request boundary and returns a static Descriptor", async () => {
    const bytes = pngHeader();
    const calls = [];
    const descriptor = await resolveCloudPngPreview({
      token: "memory-only-session",
      workspaceId: "workspace",
      assetId: "asset",
      altText: "Architecture",
      language: "en",
      apiClient: {
        async acceptedPngPreview(input) {
          calls.push(input);
          return {
            bytes,
            inspection: {
              status: "accepted", detectedMediaType: "image/png",
              byteSize: bytes.byteLength, width: 2, height: 3,
              policyVersion: "decoder-backed-png-v1"
            }
          };
        }
      }
    });
    expect(calls).toEqual([{
      token: "memory-only-session", workspaceId: "workspace", assetId: "asset"
    }]);
    expect(descriptor).toMatchObject({ kind: "static-html", sandbox: "", allow: "" });
    expect(descriptor.document).toContain("Architecture");
    expect(JSON.stringify(descriptor)).not.toContain("memory-only-session");
  });

  test("requires an explicit in-memory Session", async () => {
    await expect(resolveCloudPngPreview({
      token: "", workspaceId: "workspace", assetId: "asset", apiClient: {}
    })).rejects.toThrow("cloud_preview_session_required");
  });
});
