import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.js";
import { createCloudAiHandoffRoutes } from "../src/routes/cloud-ai-handoff-routes.js";
import { CloudAiHandoffError } from "../src/services/cloud-ai-handoff-service.js";

const token = "h".repeat(43);
const actorId = "0198d0aa-0000-7000-8000-000000000011";
const workspaceId = "0198d0aa-0000-7000-8000-000000000012";
const conversationId = "0198d0aa-0000-7000-8000-000000000013";
const handoffId = "0198d0aa-0000-7000-8000-000000000014";

function harness({ replay = false, serviceError = null } = {}) {
  const calls = [];
  const result = { handoffId, conversationId, resultMessageId: crypto.randomUUID(), replayed: false };
  const routes = createCloudAiHandoffRoutes({
    identityService: { async authenticateToken(value) { return value === token ? { userId: actorId } : null; } },
    service: { async persistCompleted(input) { calls.push(["persist", input]); if (serviceError) throw serviceError; return result; } },
    repository: {
      async findCompletedHandoff(input) { calls.push(["find", input]); return { ...result, replayed: true }; },
      async listAvailableProviderConnections(input) {
        calls.push(["connections", input]);
        return [{ id: crypto.randomUUID(), providerType: "openai-compatible", displayName: "Workspace AI", endpointOrigin: null, ownerType: "workspace" }];
      }
    },
    idempotencyService: {
      async execute(input) {
        calls.push(["idempotency", input.scope]);
        return replay
          ? { replayed: true, status: 201, reference: handoffId }
          : { replayed: false, ...(await input.operation()) };
      }
    }
  });
  return { ...createApp({ cloudAiHandoffRoutes: routes, log: () => {} }), calls, result };
}

function request(body = { confirmed: { conversationId } }, headers = {}) {
  return new Request(`http://localhost/api/v1/workspaces/${workspaceId}/conversations/${conversationId}/ai-handoffs`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "Idempotency-Key": "handoff-save-1", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body)
  });
}

describe("authenticated Cloud AI handoff API", () => {
  test("persists through an authenticated idempotent boundary", async () => {
    const { app, calls, result } = harness();
    const response = await app.request(request());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.find(([name]) => name === "persist")[1]).toMatchObject({ workspaceId, actorId });
  });

  test("resolves a replay only through the authenticated workspace", async () => {
    const { app, calls } = harness({ replay: true });
    const response = await app.request(request());
    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(calls.find(([name]) => name === "find")[1]).toEqual({ handoffId, workspaceId, actorId });
    expect(calls.some(([name]) => name === "persist")).toBe(false);
  });

  test("rejects missing authentication, idempotency, malformed identity, and oversized bodies", async () => {
    expect((await harness().app.request(request({}, { Authorization: "" }))).status).toBe(401);
    expect((await harness().app.request(request({}, { "Idempotency-Key": "" }))).status).toBe(400);
    expect((await harness().app.request(request({ confirmed: { conversationId: crypto.randomUUID() } }))).status).toBe(400);
    expect((await harness().app.request(request("x".repeat(1024 * 1024 + 1)))).status).toBe(413);
  });

  test("maps stable authorization and conflict errors", async () => {
    const forbidden = await harness({ serviceError: new CloudAiHandoffError("cloud_ai_handoff_forbidden") }).app.request(request());
    expect(forbidden.status).toBe(403);
    const conflict = await harness({ serviceError: new CloudAiHandoffError("cloud_ai_handoff_conflict") }).app.request(request());
    expect(conflict.status).toBe(409);
  });

  test("lists only metadata for available provider connections", async () => {
    const { app, calls } = harness();
    const response = await app.request(
      `/api/v1/workspaces/${workspaceId}/ai-provider-connections`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(response.status).toBe(200);
    const value = await response.json();
    expect(value.connections).toHaveLength(1);
    expect(JSON.stringify(value)).not.toContain("secret");
    expect(calls.find(([name]) => name === "connections")[1]).toEqual({ workspaceId, actorId });
  });
});
