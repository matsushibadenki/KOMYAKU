import { describe, expect, test } from "bun:test";
import { createAssetInspectionService } from "../src/services/asset-inspection-service.js";

describe("Asset inspection service", () => {
  test("completes accepted inspection from a bounded ranged read", async () => {
    const calls = [];
    const candidate = {
      id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), storageKey: "asset-key",
      declaredMediaType: "image/png", byteSize: 8, contentHash: "a".repeat(64), attempt: 1
    };
    const service = createAssetInspectionService({
      instanceId: "inspection-test",
      now: () => new Date("2026-08-20T00:00:00.000Z"),
      repository: {
        async claim() { return [candidate]; },
        async complete(input) { calls.push(["complete", input]); return true; },
        async fail(input) { calls.push(["fail", input]); return "pending"; }
      },
      objectStore: {
        async getRange(key, start, end) {
          calls.push(["range", { key, start, end }]);
          return { Body: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) };
        }
      },
      inspector: {
        inspect() {
          return { decision: "accepted", detectedMediaType: "image/png", policyVersion: "test-v1" };
        }
      }
    });
    expect(await service.runOnce()).toEqual({
      claimed: 1, accepted: 1, rejected: 0, retried: 0, errors: 0, leaseLost: 0
    });
    expect(calls[0]).toEqual(["range", { key: "asset-key", start: 0, end: 7 }]);
    expect(calls.some(([name]) => name === "fail")).toBe(false);
  });

  test("retries unreadable objects without retaining provider error text", async () => {
    const calls = [];
    const service = createAssetInspectionService({
      instanceId: "inspection-test",
      now: () => new Date("2026-08-20T00:00:00.000Z"),
      repository: {
        async claim() {
          return [{
            id: crypto.randomUUID(), workspaceId: crypto.randomUUID(), storageKey: "private-key",
            declaredMediaType: "image/png", byteSize: 8, contentHash: "a".repeat(64), attempt: 1
          }];
        },
        async complete() { return true; },
        async fail(input) { calls.push(input); return "pending"; }
      },
      objectStore: { async getRange() { throw new Error("secret provider detail"); } },
      inspector: { inspect() {} }
    });
    expect(await service.runOnce()).toMatchObject({ retried: 1, errors: 0 });
    expect(JSON.stringify(calls)).not.toContain("secret provider detail");
  });
});
