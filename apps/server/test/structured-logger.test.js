import { describe, expect, test } from "bun:test";
import { createStructuredLogger } from "../src/logging/structured-logger.js";

describe("production structured logger", () => {
  test("emits one JSON line with stable service context", () => {
    const lines = [];
    const logger = createStructuredLogger({
      instanceId: "instance-a", service: "komyaku-server", environment: "production",
      now: () => new Date("2026-08-18T00:00:00.000Z"), write: (line) => lines.push(line)
    });
    logger.log({ level: "info", event: "request_completed", status: 200 });
    expect(JSON.parse(lines[0])).toEqual({
      timestamp: "2026-08-18T00:00:00.000Z", level: "info", service: "komyaku-server",
      environment: "production", instanceId: "instance-a", event: "request_completed", status: 200
    });
  });

  test("recursively redacts credentials and authored content", () => {
    const lines = [];
    const logger = createStructuredLogger({ instanceId: "instance-a", write: (line) => lines.push(line) });
    logger.log({
      level: "error", event: "safe_event", authorization: "Bearer raw",
      nested: { password: "raw-password", documentContent: "private draft", safeId: "resource-id" }
    });
    const output = lines[0];
    expect(output).not.toContain("Bearer raw");
    expect(output).not.toContain("raw-password");
    expect(output).not.toContain("private draft");
    expect(JSON.parse(output).nested.safeId).toBe("resource-id");
  });

  test("filters below-threshold events and never echoes malformed legacy input", () => {
    const lines = [];
    const logger = createStructuredLogger({
      instanceId: "instance-a", level: "warn", write: (line) => lines.push(line)
    });
    logger.log({ level: "info", event: "ignored" });
    logger.log("secret malformed line");
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain("secret malformed line");
    expect(JSON.parse(lines[0]).event).toBe("invalid_log_input");
  });
});
