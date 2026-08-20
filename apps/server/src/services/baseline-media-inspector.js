const POLICY_VERSION = "baseline-signature-v1";
const textTypes = new Set([
  "text/plain", "text/markdown", "text/csv", "text/vnd.mermaid"
]);

function startsWith(bytes, signature) {
  return signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes, start, length) {
  return String.fromCharCode(...bytes.slice(start, start + length));
}

function detectBinary(bytes) {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (["GIF87a", "GIF89a"].includes(ascii(bytes, 0, 6))) return "image/gif";
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "image/webp";
  if (ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  return null;
}

function decodeText(bytes) {
  try {
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (value.includes("\0")) return null;
    return value;
  } catch {
    return null;
  }
}

function normalizeMediaType(value) {
  return value.split(";", 1)[0].trim().toLowerCase();
}

export function createBaselineMediaInspector() {
  return Object.freeze({
    policyVersion: POLICY_VERSION,
    inspect({ declaredMediaType, bytes, complete }) {
      const declared = normalizeMediaType(declaredMediaType);
      const binary = detectBinary(bytes);
      if (binary) {
        return {
          decision: binary === declared ? "accepted" : "rejected",
          detectedMediaType: binary,
          policyVersion: POLICY_VERSION
        };
      }

      const text = decodeText(bytes);
      if (text === null) {
        return { decision: "rejected", detectedMediaType: "application/octet-stream", policyVersion: POLICY_VERSION };
      }
      const trimmed = text.trimStart();
      if (trimmed.startsWith("<svg") || (trimmed.startsWith("<?xml") && trimmed.includes("<svg"))) {
        return { decision: "rejected", detectedMediaType: "image/svg+xml", policyVersion: POLICY_VERSION };
      }
      if (declared === "application/json") {
        if (!complete) return { decision: "rejected", detectedMediaType: "text/plain", policyVersion: POLICY_VERSION };
        try {
          JSON.parse(text);
          return { decision: "accepted", detectedMediaType: "application/json", policyVersion: POLICY_VERSION };
        } catch {
          return { decision: "rejected", detectedMediaType: "text/plain", policyVersion: POLICY_VERSION };
        }
      }
      return {
        decision: complete && textTypes.has(declared) ? "accepted" : "rejected",
        detectedMediaType: "text/plain",
        policyVersion: POLICY_VERSION
      };
    }
  });
}
