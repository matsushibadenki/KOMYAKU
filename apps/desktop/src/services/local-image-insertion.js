const MAX_LOCAL_PNG_BYTES = 256 * 1024;

function assertPngInput(bytes, altText) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MAX_LOCAL_PNG_BYTES) {
    throw new Error("invalid_local_png_size");
  }
  if (typeof altText !== "string" || altText.trim().length === 0 || altText.length > 1000) {
    throw new Error("invalid_local_png_alt_text");
  }
}

export function localImageInsertionAvailable() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export async function storeLocalPngForInsertion({ bytes, altText, invokeCommand }) {
  assertPngInput(bytes, altText);
  if (!invokeCommand && !localImageInsertionAvailable()) throw new Error("local_png_insertion_unavailable");
  const assetId = crypto.randomUUID().toLowerCase();
  const invoke = invokeCommand ?? (await import("@tauri-apps/api/core")).invoke;
  const result = await invoke("store_local_png_preview_atomic", {
    input: {
      assetId,
      bytes: Array.from(bytes),
      updatedAt: new Date().toISOString()
    }
  });
  if (
    result?.assetId !== assetId ||
    result?.byteSize !== bytes.byteLength ||
    typeof result?.contentHash !== "string" || !/^[a-f0-9]{64}$/u.test(result.contentHash) ||
    !Number.isSafeInteger(result?.width) || result.width < 1 ||
    !Number.isSafeInteger(result?.height) || result.height < 1
  ) {
    throw new Error("invalid_local_png_storage_result");
  }
  return Object.freeze({ ...result, mediaType: "image/png", altText: altText.trim() });
}

