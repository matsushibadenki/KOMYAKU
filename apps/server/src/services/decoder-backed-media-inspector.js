import sharp from "sharp";
import { createBaselineMediaInspector } from "./baseline-media-inspector.js";

const POLICY_VERSION = "decoder-backed-png-v1";
const MAX_PNG_BYTES = 1024 * 1024;
const MAX_PNG_PIXELS = 16_000_000;

function normalizedMediaType(value) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

export function createDecoderBackedMediaInspector({ baseline = createBaselineMediaInspector() } = {}) {
  return Object.freeze({
    policyVersion: POLICY_VERSION,
    async inspect({ declaredMediaType, bytes, complete }) {
      if (normalizedMediaType(declaredMediaType) !== "image/png") {
        return baseline.inspect({ declaredMediaType, bytes, complete });
      }
      if (!(bytes instanceof Uint8Array) || !complete || bytes.byteLength === 0
        || bytes.byteLength > MAX_PNG_BYTES) {
        return {
          decision: "rejected", detectedMediaType: "application/octet-stream",
          policyVersion: POLICY_VERSION
        };
      }
      try {
        const image = sharp(bytes, {
          animated: false,
          failOn: "warning",
          limitInputPixels: MAX_PNG_PIXELS,
          sequentialRead: true
        });
        const metadata = await image.metadata();
        if (metadata.format !== "png" || (metadata.pages != null && metadata.pages !== 1)
          || !Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height)
          || metadata.width < 1 || metadata.height < 1
          || metadata.width * metadata.height > MAX_PNG_PIXELS) {
          throw new Error("PNG metadata rejected");
        }
        await image.clone().ensureAlpha().raw().toBuffer();
        return {
          decision: "accepted",
          detectedMediaType: "image/png",
          policyVersion: POLICY_VERSION,
          width: metadata.width,
          height: metadata.height
        };
      } catch {
        return {
          decision: "rejected", detectedMediaType: "application/octet-stream",
          policyVersion: POLICY_VERSION
        };
      }
    }
  });
}
