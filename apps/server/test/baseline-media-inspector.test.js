import { describe, expect, test } from "bun:test";
import { createBaselineMediaInspector } from "../src/services/baseline-media-inspector.js";

describe("baseline media inspector", () => {
  const inspector = createBaselineMediaInspector();

  test("accepts matching PNG magic and rejects a misleading declaration", () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(inspector.inspect({ declaredMediaType: "image/png", bytes, complete: true })).toMatchObject({
      decision: "accepted", detectedMediaType: "image/png"
    });
    expect(inspector.inspect({ declaredMediaType: "image/jpeg", bytes, complete: true })).toMatchObject({
      decision: "rejected", detectedMediaType: "image/png"
    });
  });

  test("rejects SVG from direct delivery until the isolated renderer exists", () => {
    const bytes = new TextEncoder().encode("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>");
    expect(inspector.inspect({ declaredMediaType: "image/svg+xml", bytes, complete: true })).toMatchObject({
      decision: "rejected", detectedMediaType: "image/svg+xml"
    });
  });

  test("accepts complete valid JSON but rejects a truncated JSON sample", () => {
    const bytes = new TextEncoder().encode('{"safe":true}');
    expect(inspector.inspect({ declaredMediaType: "application/json", bytes, complete: true }).decision).toBe("accepted");
    expect(inspector.inspect({ declaredMediaType: "application/json", bytes, complete: false }).decision).toBe("rejected");
  });

  test("fails closed for text larger than the complete inspection sample", () => {
    const bytes = new TextEncoder().encode("safe-looking prefix");
    expect(inspector.inspect({ declaredMediaType: "text/markdown", bytes, complete: false }).decision).toBe("rejected");
  });
});
