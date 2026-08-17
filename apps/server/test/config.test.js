import { describe, expect, test } from "bun:test";
import { loadRuntimeConfig } from "../src/config.js";

describe("runtime configuration", () => {
  test("defaults to the single-server postgres-outbox mode", () => {
    const config = loadRuntimeConfig({});

    expect(config.deploymentMode).toBe("single");
    expect(config.jobBackend).toBe("postgres-outbox");
    expect(config.databasePoolMax).toBe(10);
  });

  test("rejects unsupported deployment modes", () => {
    expect(() => loadRuntimeConfig({ DEPLOYMENT_MODE: "unknown" })).toThrow(
      "Unsupported DEPLOYMENT_MODE"
    );
  });
});
