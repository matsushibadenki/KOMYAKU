import { expect, test } from "bun:test";
import { createReferenceReleaseQueue, drainReferenceReleases, scheduleReferenceReleases } from "../src/services/reference-release-queue.js";
import { releaseCloudReference } from "../src/services/cloud-reference-release.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("a failed leading reference does not starve the next retry batch", async () => {
  const queue = createReferenceReleaseQueue(storage(), "fairness");
  const second = { ...item, referenceId: crypto.randomUUID() };
  queue.add(item);
  queue.add(second);
  await drainReferenceReleases({ queue, workspaceId, token: "token", release: async () => { throw new Error("blocked"); } });
  expect(queue.list(workspaceId)).toEqual([second, item]);
  const processed = [];
  await drainReferenceReleases({ queue, workspaceId, token: "token", release: async (request) => {
    processed.push(request.referenceId);
    if (request.referenceId === item.referenceId) throw new Error("still blocked");
  } });
  expect(processed).toEqual([second.referenceId, item.referenceId]);
  expect(queue.list(workspaceId)).toEqual([item]);
});

test("offline intent survives process exit and is released by a fresh process", async () => {
  const directory = mkdtempSync(join(tmpdir(), "komyaku-cleanup-restart-"));
  const file = join(directory, "storage.json");
  const modulePath = new URL("../src/services/reference-release-queue.js", import.meta.url).pathname;
  const releasePath = new URL("../src/services/cloud-reference-release.js", import.meta.url).pathname;
  const script = `
    import { readFileSync, writeFileSync, existsSync } from "node:fs";
    import { createReferenceReleaseQueue, drainReferenceReleases } from ${JSON.stringify(modulePath)};
    import { releaseCloudReference } from ${JSON.stringify(releasePath)};
    const file = process.argv[1], mode = process.argv[2];
    const item = JSON.parse(process.argv[3]);
    const values = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    const queue = createReferenceReleaseQueue({ getItem: key => values[key] ?? null,
      setItem: (key, value) => { values[key] = value; writeFileSync(file, JSON.stringify(values)); }
    }, "https://restart.example/api");
    if (mode === "offline") {
      try { await releaseCloudReference({ ...item, token: "never-persist-this", apiClient: {
        releaseAssetReference: async () => { throw new TypeError("offline"); }
      } }, { queue, wait: async () => {} }); } catch {}
      if (queue.list(item.workspaceId).length !== 1) throw new Error("lost intent");
    } else {
      if (queue.list(item.workspaceId).length !== 1) throw new Error("missing restored intent");
      await drainReferenceReleases({ queue, workspaceId: item.workspaceId, token: "fresh-token",
        release: async request => {
          if (request.referenceId !== item.referenceId || request.token !== "fresh-token") throw new Error("wrong scope");
        }
      });
      if (queue.list(item.workspaceId).length !== 0) throw new Error("not drained");
    }
  `;
  try {
    for (const mode of ["offline", "online"]) {
      const process = Bun.spawn([Bun.which("bun"), "-e", script, file, mode, JSON.stringify(item)], { stdout: "pipe", stderr: "pipe" });
      const error = await new Response(process.stderr).text();
      expect(await process.exited, error).toBe(0);
      expect(await Bun.file(file).text()).not.toContain("never-persist-this");
      expect(await Bun.file(file).text()).not.toContain("fresh-token");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const workspaceId = crypto.randomUUID();
const item = { workspaceId, assetId: crypto.randomUUID(), referenceId: crypto.randomUUID() };

test("deduplicates running batches and allows a later batch after completion", async () => {
  const queue = createReferenceReleaseQueue(storage(), "scheduler");
  queue.add(item);
  let release;
  let calls = 0;
  const gate = new Promise((resolve) => { release = resolve; });
  const input = { authority: "scheduler", queue, workspaceId, token: "token",
    release: async () => { calls += 1; await gate; } };
  const first = scheduleReferenceReleases(input);
  const second = scheduleReferenceReleases(input);
  expect(first).toBe(second);
  await Promise.resolve();
  expect(calls).toBe(1);
  release();
  await first;
  queue.add(item);
  const next = scheduleReferenceReleases(input);
  expect(next).not.toBe(first);
  await next;
  expect(calls).toBe(2);
});
function storage() {
  const values = new Map();
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("restart recovery stores only scoped IDs and uses the new authorized token", async () => {
  const disk = storage();
  const first = createReferenceReleaseQueue(disk, "https://one.example/api");
  first.add({ ...item, token: "old-secret" });
  first.add(item);
  const reopened = createReferenceReleaseQueue(disk, "https://one.example/api");
  expect(reopened.list(workspaceId)).toEqual([item]);
  expect(JSON.stringify([...disk.values.values()])).not.toContain("secret");
  expect(createReferenceReleaseQueue(disk, "https://two.example/api").list(workspaceId)).toEqual([]);
  expect(reopened.list(crypto.randomUUID())).toEqual([]);
  const calls = [];
  await drainReferenceReleases({ queue: reopened, workspaceId, token: "new-secret",
    release: async (request) => { calls.push(request); } });
  expect(calls).toEqual([{ ...item, token: "new-secret" }]);
  expect(reopened.list(workspaceId)).toEqual([]);
});

test("failed cleanup survives restart and stops the batch", async () => {
  const disk = storage();
  const queue = createReferenceReleaseQueue(disk, "server");
  queue.add(item);
  queue.add({ ...item, referenceId: crypto.randomUUID() });
  let calls = 0;
  await drainReferenceReleases({ queue, workspaceId, token: "token", release: async () => {
    calls += 1; throw new Error("offline");
  } });
  expect(calls).toBe(1);
  expect(createReferenceReleaseQueue(disk, "server").list(workspaceId)).toHaveLength(2);
});

test("release intent is durable before the request and cleared only after success", async () => {
  const queue = createReferenceReleaseQueue(storage(), "server");
  await expect(releaseCloudReference({ ...item, token: "token", apiClient: {
    releaseAssetReference: async () => { expect(queue.list(workspaceId)).toEqual([item]); throw { status: 403 }; }
  } }, { queue })).rejects.toEqual({ status: 403 });
  expect(queue.list(workspaceId)).toEqual([item]);
  await releaseCloudReference({ ...item, token: "token", apiClient: {
    releaseAssetReference: async () => null
  } }, { queue });
  expect(queue.list(workspaceId)).toEqual([]);
});

test("drains at most twenty items and does not overwrite corrupt storage", async () => {
  const disk = storage();
  const queue = createReferenceReleaseQueue(disk, "server");
  for (let i = 0; i < 21; i += 1) queue.add({ ...item, referenceId: crypto.randomUUID() });
  let calls = 0;
  await drainReferenceReleases({ queue, workspaceId, token: "token", release: async () => { calls += 1; } });
  expect(calls).toBe(20);
  expect(queue.list(workspaceId)).toHaveLength(1);
  const key = [...disk.values.keys()][0];
  disk.setItem(key, "broken");
  expect(() => queue.add(item)).toThrow();
  expect(disk.getItem(key)).toBe("broken");
});
