const PREFIX = "komyaku:reference-release:v1:";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ITEMS = 1000;
const runningBatches = new Map();

export function scheduleReferenceReleases({ authority, ...input }) {
  const key = JSON.stringify([authority, input.workspaceId]);
  if (runningBatches.has(key)) return runningBatches.get(key);
  const batch = Promise.resolve().then(() => drainReferenceReleases(input))
    .catch(() => { /* Retain queue data on storage/transport failure. */ })
    .finally(() => { runningBatches.delete(key); });
  runningBatches.set(key, batch);
  return batch;
}

export function createReferenceReleaseQueue(storage, authority) {
  const key = PREFIX + encodeURIComponent(authority);
  const identity = (item) => [item.workspaceId, item.assetId, item.referenceId].join(":");
  const valid = (item) => item && Object.keys(item).length === 3
    && [item.workspaceId, item.assetId, item.referenceId].every((value) => typeof value === "string" && UUID.test(value));
  function read() {
    const raw = storage.getItem(key);
    if (raw === null) return [];
    if (raw.length > 256 * 1024) throw new Error("reference_release_queue_invalid");
    const items = JSON.parse(raw);
    if (!Array.isArray(items) || items.length > MAX_ITEMS || !items.every(valid)
      || new Set(items.map(identity)).size !== items.length) throw new Error("reference_release_queue_invalid");
    return items;
  }
  return Object.freeze({
    add({ workspaceId, assetId, referenceId }) {
      const item = { workspaceId, assetId, referenceId };
      if (!valid(item)) throw new Error("reference_release_identity_invalid");
      const items = read();
      if (items.some((stored) => identity(stored) === identity(item))) return;
      if (items.length === MAX_ITEMS) throw new Error("reference_release_queue_full");
      storage.setItem(key, JSON.stringify([...items, item]));
    },
    remove(item) {
      const items = read();
      storage.setItem(key, JSON.stringify(items.filter((stored) => identity(stored) !== identity(item))));
    },
    defer(item) {
      const items = read();
      const found = items.find((stored) => identity(stored) === identity(item));
      if (found) storage.setItem(key, JSON.stringify([
        ...items.filter((stored) => identity(stored) !== identity(item)), found
      ]));
    },
    list(workspaceId) { return read().filter((item) => item.workspaceId === workspaceId).slice(0, 20); }
  });
}

export async function drainReferenceReleases({ queue, workspaceId, token, release }) {
  for (const item of queue.list(workspaceId)) {
    try {
      await release({ ...item, token });
      queue.remove(item);
    } catch {
      // Keep the failed item and avoid hammering an unavailable/unauthorized API.
      // Let a different item lead the next bounded batch.
      queue.defer(item);
      return;
    }
  }
}
