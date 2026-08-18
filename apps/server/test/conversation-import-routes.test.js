import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.js";
import { createConversationImportRoutes } from "../src/routes/conversation-import-routes.js";
import { ConversationImportError } from "../src/services/conversation-import-service.js";

const token = "i".repeat(43);
const userId = "0198d0aa-0000-7000-8000-000000000001";
const workspaceId = "0198d0aa-0000-7000-8000-000000000002";
const importId = "0198d0aa-0000-7000-8000-000000000003";

function harness({ allowed = true, replay = false, importError = null } = {}) {
  const calls = [];
  const identityService = {
    async authenticateToken(value) {
      return value === token ? { userId, sessionId: crypto.randomUUID(), email: "writer@example.com" } : null;
    }
  };
  const result = {
    importId,
    conversationId: "0198d0aa-0000-7000-8000-000000000004",
    sourceHash: "a".repeat(64),
    status: "complete",
    warnings: []
  };
  const routes = createConversationImportRoutes({
    identityService,
    authorizeImport: async (input) => { calls.push(["authorize", input]); return allowed; },
    importService: {
      async importGenericJson(input) {
        calls.push(["import", input]);
        if (importError) throw importError;
        return result;
      }
    },
    importRepository: {
      async findImportResult(input) { calls.push(["find", input]); return result; }
    },
    idempotencyService: {
      async execute(input) {
        calls.push(["idempotency", { scope: input.scope, bytes: input.requestBytes }]);
        if (replay) return { replayed: true, status: 201, reference: importId };
        return { replayed: false, ...(await input.operation()) };
      }
    }
  });
  return { ...createApp({ conversationImportRoutes: routes, log: () => {} }), calls, result };
}

function request(body, headers = {}) {
  return new Request(`http://localhost/api/v1/workspaces/${workspaceId}/conversation-imports`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      "Idempotency-Key": "conversation-import-request-1",
      ...headers
    },
    body
  });
}

describe("authenticated conversation import API", () => {
  test("archives the exact JSON request through an authorized idempotent mutation", async () => {
    const { app, calls, result } = harness();
    const raw = '{"messages":[{"role":"user","content":"原文"}]}';
    const response = await app.request(request(raw));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const imported = calls.find(([name]) => name === "import")[1];
    expect(new TextDecoder().decode(imported.raw)).toBe(raw);
    expect(imported).toMatchObject({
      workspaceId, actorId: userId, visibility: "private", aiTrainingPolicy: "deny"
    });
  });

  test("replays only a result that is visible to the same user and workspace", async () => {
    const { app, calls, result } = harness({ replay: true });
    const response = await app.request(request('{"messages":[]}'));
    expect(response.status).toBe(201);
    expect(response.headers.get("Idempotency-Replayed")).toBe("true");
    expect(await response.json()).toEqual(result);
    expect(calls.some(([name]) => name === "import")).toBe(false);
    expect(calls.find(([name]) => name === "find")[1]).toEqual({
      importId, workspaceId, userId
    });
  });

  test("returns an import result only through the authenticated workspace lookup", async () => {
    const { app, result } = harness();
    const response = await app.request(
      `/api/v1/workspaces/${workspaceId}/conversation-imports/${importId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(result);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("returns an idempotent import reference when archived JSON cannot be parsed", async () => {
    const { app } = harness({
      importError: new ConversationImportError("parse failed", {
        importId,
        cause: new Error("invalid JSON")
      })
    });
    const response = await app.request(request("{"));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "conversation_import_failed", importId });
  });

  test("requires authentication, workspace permission, JSON, and an idempotency key", async () => {
    const noAuth = await harness().app.request(request("{}", { Authorization: "" }));
    expect(noAuth.status).toBe(401);
    const forbidden = await harness({ allowed: false }).app.request(request("{}"));
    expect(forbidden.status).toBe(403);
    const unsupported = await harness().app.request(request("text", { "Content-Type": "text/plain" }));
    expect(unsupported.status).toBe(415);
    const noKey = await harness().app.request(request("{}", { "Idempotency-Key": "" }));
    expect(noKey.status).toBe(400);
  });

  test("rejects a source larger than 10 MiB before import", async () => {
    const { app, calls } = harness();
    const response = await app.request(request("x".repeat(10 * 1024 * 1024 + 1)));
    expect(response.status).toBe(413);
    expect(calls.some(([name]) => name === "import")).toBe(false);
  });
});
