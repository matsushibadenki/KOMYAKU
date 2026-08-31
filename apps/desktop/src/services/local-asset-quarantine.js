const ASSET_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;

export function localAssetQuarantineAvailable() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function normalizeSummary(value) {
  if (
    !value || typeof value !== "object" || !ASSET_ID.test(value.assetId) ||
    !Number.isSafeInteger(value.byteSize) || value.byteSize < 1 || value.byteSize > 256 * 1024 ||
    !Number.isSafeInteger(value.width) || value.width < 1 ||
    !Number.isSafeInteger(value.height) || value.height < 1 ||
    typeof value.quarantinedAt !== "string" || value.quarantinedAt.length < 1 || value.quarantinedAt.length > 64 ||
    !Number.isFinite(Date.parse(value.quarantinedAt))
  ) throw new Error("invalid_local_asset_quarantine_result");
  return Object.freeze({
    assetId: value.assetId,
    byteSize: value.byteSize,
    width: value.width,
    height: value.height,
    quarantinedAt: value.quarantinedAt
  });
}

export async function listQuarantinedLocalAssets({ invokeCommand } = {}) {
  if (!invokeCommand && !localAssetQuarantineAvailable()) {
    throw new Error("local_asset_quarantine_unavailable");
  }
  const invoke = invokeCommand ?? (await import("@tauri-apps/api/core")).invoke;
  const result = await invoke("list_quarantined_local_assets");
  if (!Array.isArray(result) || result.length > 100) {
    throw new Error("invalid_local_asset_quarantine_result");
  }
  const normalized = result.map(normalizeSummary);
  if (new Set(normalized.map(({ assetId }) => assetId)).size !== normalized.length) {
    throw new Error("invalid_local_asset_quarantine_result");
  }
  return Object.freeze(normalized);
}

export function createQuarantinedImageInsertion(asset, altText) {
  const summary = normalizeSummary(asset);
  if (typeof altText !== "string" || altText.trim().length === 0 || altText.length > 1000) {
    throw new Error("invalid_local_asset_recovery_alt_text");
  }
  return Object.freeze({
    assetId: summary.assetId,
    byteSize: summary.byteSize,
    width: summary.width,
    height: summary.height,
    mediaType: "image/png",
    altText: altText.trim()
  });
}
