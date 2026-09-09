import { expect, test } from "bun:test";
import { releaseCloudReference } from "../src/services/cloud-reference-release.js";

const identity = { token: "original-session", workspaceId: "original-workspace", assetId: "asset", referenceId: "reference" };

test("retries a lost response with the exact original reference identity", async () => {
  const calls = [];
  const delays = [];
  const result = await releaseCloudReference({ ...identity, apiClient: {
    releaseAssetReference: async (input) => {
      calls.push(input);
      if (calls.length === 1) throw new TypeError("network error after commit");
      return null; // Idempotent replay: already released.
    }
  } }, { wait: async (delay) => { delays.push(delay); } });
  expect(result).toBeNull();
  expect(calls).toEqual([identity, identity]);
  expect(delays).toEqual([250]);
});

test.each([401, 403, 404, 409, 422])("does not retry permanent HTTP %i errors", async (status) => {
  let calls = 0;
  await expect(releaseCloudReference({ ...identity, apiClient: {
    releaseAssetReference: async () => { calls += 1; throw { status }; }
  } }, { wait: async () => { throw new Error("unexpected retry"); } })).rejects.toEqual({ status });
  expect(calls).toBe(1);
});

test("limits transient failures to three requests and respects short Retry-After", async () => {
  let calls = 0;
  const delays = [];
  const error = { status: 503, retryAfterSeconds: 2 };
  await expect(releaseCloudReference({ ...identity, apiClient: {
    releaseAssetReference: async () => { calls += 1; throw error; }
  } }, { wait: async (delay) => { delays.push(delay); } })).rejects.toBe(error);
  expect(calls).toBe(3);
  expect(delays).toEqual([2000, 2000]);
});

test("does not retry earlier than a Retry-After beyond the retry budget", async () => {
  let calls = 0;
  const error = { status: 429, retryAfterSeconds: 60 };
  await expect(releaseCloudReference({ ...identity, apiClient: {
    releaseAssetReference: async () => { calls += 1; throw error; }
  } }, { wait: async () => { throw new Error("unexpected retry"); } })).rejects.toBe(error);
  expect(calls).toBe(1);
});
