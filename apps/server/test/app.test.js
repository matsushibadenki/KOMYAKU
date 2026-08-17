import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.js";
import { createRuntimeState } from "../src/runtime-state.js";

describe("KOMYAKU server foundation", () => {
  test("serves the versioned health endpoint", async () => {
    const { app } = createApp({ log: () => {} });
    const response = await app.request("/api/v1/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      service: "komyaku-server"
    });
  });

  test("denies AI training by default", async () => {
    const { app } = createApp({ aiTrainingDefault: "deny", log: () => {} });
    const response = await app.request("/api/v1/health");

    expect(response.headers.get("X-Robots-Tag")).toBe("noai, noimageai");
    expect(response.headers.get("TDM-Reservation")).toBe("1");
  });

  test("does not emit refusal headers after explicit opt-in", async () => {
    const { app } = createApp({ aiTrainingDefault: "allow", log: () => {} });
    const response = await app.request("/api/v1/health");

    expect(response.headers.get("X-Robots-Tag")).toBeNull();
  });

  test("reports separate liveness and readiness", async () => {
    const { app } = createApp({ log: () => {} });

    expect((await app.request("/health/live")).status).toBe(200);
    expect((await app.request("/health/ready")).status).toBe(200);
  });

  test("stops reporting readiness before graceful shutdown", async () => {
    const runtimeState = createRuntimeState();
    const { app } = createApp({ runtimeState, log: () => {} });

    runtimeState.beginShutdown();

    const response = await app.request("/health/ready");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
  });

  test("reports dependency failures as not ready without leaking details", async () => {
    const { app } = createApp({
      log: () => {},
      readinessCheck: async () => {
        throw new Error("sensitive dependency detail");
      }
    });

    const response = await app.request("/health/ready");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "not_ready" });
  });
});
