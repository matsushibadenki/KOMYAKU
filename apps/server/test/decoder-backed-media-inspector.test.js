import { describe, expect, test } from "bun:test";
import { createDecoderBackedMediaInspector } from "../src/services/decoder-backed-media-inspector.js";

const PNG_1X1 = Uint8Array.fromBase64(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
);

describe("decoder-backed media inspector", () => {
  const inspector = createDecoderBackedMediaInspector();

  test("fully decodes a complete PNG and returns inspected dimensions", async () => {
    await expect(inspector.inspect({
      declaredMediaType: "image/png", bytes: PNG_1X1, complete: true
    })).resolves.toEqual({
      decision: "accepted", detectedMediaType: "image/png",
      policyVersion: "decoder-backed-png-v1", width: 1, height: 1
    });
  });

  test("rejects truncated, forged, incomplete, and mismatched PNG input", async () => {
    for (const input of [
      { declaredMediaType: "image/png", bytes: PNG_1X1.slice(0, 24), complete: true },
      { declaredMediaType: "image/png", bytes: new Uint8Array(64), complete: true },
      { declaredMediaType: "image/png", bytes: PNG_1X1, complete: false }
    ]) {
      await expect(inspector.inspect(input)).resolves.toMatchObject({ decision: "rejected" });
    }
    await expect(inspector.inspect({
      declaredMediaType: "image/jpeg", bytes: PNG_1X1, complete: true
    })).resolves.toMatchObject({ decision: "rejected", detectedMediaType: "image/png" });
  });
});
