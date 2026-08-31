import { describe, expect, test } from "bun:test";
import { createAssetInspectionRunner } from "../src/services/asset-inspection-runner.js";

describe("Asset inspection runner", () => {
  test("starts immediately, logs bounded summaries, and stops cleanly", async () => {
    let runs = 0;
    const logs = [];
    const runner = createAssetInspectionRunner({
      pollIntervalMs: 100,
      log: (entry) => logs.push(entry),
      service: {
        async runOnce() {
          runs += 1;
          return { claimed: 1, accepted: 1, rejected: 0, retried: 0, errors: 0, leaseLost: 0 };
        }
      }
    });
    runner.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await runner.stop();
    expect(runs).toBe(1);
    expect(logs[0]).toMatchObject({ event: "asset_inspection_batch", claimed: 1, accepted: 1 });
  });
});
