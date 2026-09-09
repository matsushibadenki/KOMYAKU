import { cloudApiClient, cloudApiBaseUrl } from "./cloud-api.js";
import { createReferenceReleaseQueue } from "./reference-release-queue.js";

export function cloudReferenceReleaseQueue() {
  try {
    return typeof window !== "undefined" && window.localStorage
      ? createReferenceReleaseQueue(window.localStorage, cloudApiBaseUrl) : null;
  } catch { return null; }
}

export async function releaseCloudReference({ apiClient, token, workspaceId, assetId, referenceId }, {
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  queue = apiClient === cloudApiClient ? cloudReferenceReleaseQueue() : null
} = {}) {
  // Same scoped identity on every attempt; never retry by looking up a newer
  // session or workspace. Long outages remain a reconciliation concern.
  const request = { token, workspaceId, assetId, referenceId };
  // Queue only explicit release intent, never a potentially adopted insertion.
  // If storage is unavailable, still attempt safe idempotent online cleanup.
  try { queue?.add(request); } catch { /* No durable retry guarantee in this case. */ }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await apiClient.releaseAssetReference({ ...request });
      try { queue?.remove(request); } catch { /* Replay is idempotent. */ }
      return result;
    } catch (error) {
      const transient = error instanceof TypeError || error?.status === 0
        || [408, 429, 500, 502, 503, 504].includes(error?.status);
      const retryAfter = error?.retryAfterSeconds;
      if (!transient || attempt === 2 || (retryAfter != null
        && (!Number.isFinite(retryAfter) || retryAfter < 0 || retryAfter > 5))) throw error;
      await wait(Math.max(250 * (2 ** attempt), (retryAfter ?? 0) * 1000));
    }
  }
}
