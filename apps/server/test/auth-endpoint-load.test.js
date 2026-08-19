import { describe, expect, test } from "bun:test";
import { summarizeLatencies } from "../scripts/auth-endpoint-load.js";

describe("authentication load report", () => {
  test("calculates deterministic percentile and throughput summaries", () => {
    expect(summarizeLatencies([40, 10, 30, 20, 50], 250)).toEqual({
      requests: 5,
      elapsedMs: 250,
      requestsPerSecond: 20,
      latencyMs: { min: 10, p50: 30, p95: 50, p99: 50, max: 50 }
    });
  });
});
