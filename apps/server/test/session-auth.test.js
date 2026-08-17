import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import {
  sessionAuth,
  workspaceConversationImportAuthorizer
} from "../src/middleware/session-auth.js";
import { createSessionToken } from "../src/security/session-tokens.js";

describe("session authentication middleware", () => {
  test("rejects missing and malformed bearer credentials without calling the service", async () => {
    let calls = 0;
    const app = new Hono();
    app.use("*", sessionAuth({
      identityService: { authenticateToken: async () => { calls += 1; return null; } }
    }));
    app.get("/protected", (context) => context.json({ ok: true }));

    const missing = await app.request("/protected");
    const malformed = await app.request("/protected", { headers: { Authorization: "Bearer invalid" } });
    expect(missing.status).toBe(401);
    expect(malformed.status).toBe(401);
    expect(missing.headers.get("WWW-Authenticate")).toBe("Bearer");
    expect(calls).toBe(0);
  });

  test("attaches a valid session identity to protected handlers", async () => {
    const token = createSessionToken();
    const identity = { userId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
    const app = new Hono();
    app.use("*", sessionAuth({ identityService: { authenticateToken: async () => identity } }));
    app.get("/protected", (context) => context.json(context.get("identity")));

    const response = await app.request("/protected", {
      headers: { Authorization: `Bearer ${token}` }
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(identity);
  });

  test("maps only the conversation import action to workspace membership", async () => {
    const calls = [];
    const authorize = workspaceConversationImportAuthorizer({
      async canImportConversations(input) { calls.push(input); return true; }
    });
    const workspaceId = crypto.randomUUID();
    const actorId = crypto.randomUUID();

    expect(await authorize({ workspaceId, actorId, action: "conversation:import" })).toBe(true);
    expect(await authorize({ workspaceId, actorId, action: "workspace:delete" })).toBe(false);
    expect(calls).toEqual([{ workspaceId, userId: actorId }]);
  });
});
