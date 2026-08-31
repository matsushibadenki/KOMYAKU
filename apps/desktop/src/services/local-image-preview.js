const LOCAL_DATABASE_URL = "sqlite:komyaku.db";
let databasePromise;

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

async function databaseBackend() {
  if (!isTauriRuntime()) throw new Error("local_preview_unavailable");
  databasePromise ??= import("@tauri-apps/plugin-sql")
    .then(({ default: Database }) => Database.load(LOCAL_DATABASE_URL));
  const database = await databasePromise;
  return {
    async load(assetId) {
      const rows = await database.select(
        `SELECT asset_id, bytes, byte_size, content_hash, detected_media_type,
                inspection_status, inspection_policy_version, inspected_width,
                inspected_height
         FROM local_asset_previews
         WHERE asset_id = $1
         LIMIT 1`,
        [assetId]
      );
      return rows[0] ?? null;
    }
  };
}

function recordBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
    return new Uint8Array(value);
  }
  throw new Error("invalid_local_preview_bytes");
}

export async function resolveLocalPngPreview({
  assetId,
  altText = "",
  language = "und",
  backend
}) {
  if (typeof assetId !== "string" || !/^[a-f0-9-]{36}$/u.test(assetId)) {
    throw new Error("invalid_local_preview_asset_id");
  }
  const source = backend ?? await databaseBackend();
  const record = await source.load(assetId);
  if (!record) throw new Error("local_preview_not_found");
  const bytes = recordBytes(record.bytes);
  const byteSize = Number(record.byteSize ?? record.byte_size);
  const contentHash = String(record.contentHash ?? record.content_hash);
  if (bytes.byteLength !== byteSize || await sha256Hex(bytes) !== contentHash) {
    throw new Error("local_preview_integrity_mismatch");
  }
  const { renderAcceptedPngPreview } = await import("@komyaku/preview-core");
  return renderAcceptedPngPreview({
    bytes,
    inspection: {
      status: record.inspectionStatus ?? record.inspection_status,
      detectedMediaType: record.detectedMediaType ?? record.detected_media_type,
      policyVersion: record.inspectionPolicyVersion ?? record.inspection_policy_version,
      byteSize,
      width: Number(record.inspectedWidth ?? record.inspected_width),
      height: Number(record.inspectedHeight ?? record.inspected_height)
    },
    altText,
    language
  });
}
