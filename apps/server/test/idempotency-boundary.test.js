import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { idempotencyBoundary } from "../src/middleware/idempotency-boundary.js";

function app(events) {
  const value = new Hono();
  value.use("/mutate", idempotencyBoundary({
    service: {
      async execute(input) {
        events.push(input);
        return input.operation();
      }
    },
    scope: () => "workspace:one:create"
  }));
  value.post("/mutate", async (context) => {
    const execute = context.get("executeIdempotent");
    const result = await execute(async () => ({ status: 201, reference: "resource-id" }));
    return context.json(result, result.status);
  });
  return value;
}

describe("HTTP idempotency boundary", () => {
  test("requires an explicit key only where the middleware is mounted", async () => {
    const response = await app([]).request("/mutate", { method: "POST", body: "payload" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "idempotency_key_required" });
  });

  test("binds the exact request bytes and resolved scope", async () => {
    const events = [];
    const response = await app(events).request("/mutate", {
      method: "POST",
      headers: { "Idempotency-Key": "request-key-123" },
      body: "原文\r\ncontent"
    });
    expect(response.status).toBe(201);
    expect(events[0].scope).toBe("workspace:one:create");
    expect(new TextDecoder().decode(events[0].requestBytes)).toBe("原文\r\ncontent");
  });
});
