import { describe, expect, test } from "bun:test";
import { ApiClientError, createApiClient } from "../src/index.js";

function json(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json", ...headers }
  });
}

describe("KOMYAKU API client", () => {
  test("keeps credentials in the authorization header and parses accessible workspaces", async () => {
    const requests = [];
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1/",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return json({ workspaces: [{ id: crypto.randomUUID(), canImportConversations: true }] });
      }
    });

    const result = await client.workspaces("opaque-session");
    expect(result.workspaces).toHaveLength(1);
    expect(requests[0].url).toBe("https://komyaku.example/api/v1/auth/workspaces");
    expect(requests[0].init.headers).toEqual({ Authorization: "Bearer opaque-session" });
  });

  test("submits the same byte object with provider and idempotency boundaries", async () => {
    const bytes = new TextEncoder().encode('{"messages":[]}');
    let request;
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return json({ importId: crypto.randomUUID(), conversationIds: [crypto.randomUUID()] }, 201);
      }
    });

    await client.importConversation({
      token: "session", workspaceId: "workspace", bytes,
      sourceProvider: "chatgpt", idempotencyKey: "same-operation-key"
    });

    expect(request.init.body).toBe(bytes);
    expect(request.init.headers).toMatchObject({
      Authorization: "Bearer session",
      "Idempotency-Key": "same-operation-key",
      "X-KOMYAKU-Source-Provider": "chatgpt"
    });
  });

  test("maps bounded API errors without exposing response bodies", async () => {
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async () => json({ error: "rate_limited", detail: "must not escape" }, 429, { "Retry-After": "42" })
    });

    try {
      await client.login({ email: "writer@example.com", password: "secret" });
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toBeInstanceOf(ApiClientError);
      expect(error).toMatchObject({ code: "rate_limited", status: 429, retryAfterSeconds: 42 });
      expect(error.message).not.toContain("detail");
    }
  });

  test("preserves a safe import reference from a failed conversion", async () => {
    const importId = crypto.randomUUID();
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async () => json({ error: "conversation_import_failed", importId }, 422)
    });

    await expect(client.importConversation({
      token: "session", workspaceId: "workspace", bytes: new Uint8Array(),
      sourceProvider: "auto", idempotencyKey: "operation-key"
    })).rejects.toMatchObject({ code: "conversation_import_failed", reference: importId });
  });

  test("lists Cloud connection metadata and persists a handoff without credentials", async () => {
    const requests = [];
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return url.endsWith("ai-provider-connections")
          ? json({ connections: [] })
          : json({ handoffId: "handoff" }, 201);
      }
    });
    await client.aiProviderConnections({ token: "session", workspaceId: "workspace" });
    await client.persistAiHandoff({
      token: "session", workspaceId: "workspace", conversationId: "conversation",
      confirmed: { id: "handoff" }, responseMessage: { id: "message" },
      providerResponseId: "response", completedAt: "2026-08-30T00:00:00.000Z",
      idempotencyKey: "handoff-operation"
    });
    expect(requests[0].url).toEndWith("/workspaces/workspace/ai-provider-connections");
    expect(requests[1].init.headers).toMatchObject({
      Authorization: "Bearer session", "Idempotency-Key": "handoff-operation"
    });
    expect(requests[1].init.body).not.toContain("apiKey");
  });
});
