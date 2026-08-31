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

  test("fetches a bounded inspected PNG as bytes without exposing a storage URL", async () => {
    let request;
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return new Response(bytes, {
          headers: {
            "Content-Type": "image/png",
            "X-KOMYAKU-Inspection-Policy": "decoder-backed-png-v1",
            "X-KOMYAKU-Image-Width": "1",
            "X-KOMYAKU-Image-Height": "1"
          }
        });
      }
    });
    await expect(client.acceptedPngPreview({
      token: "session", workspaceId: "workspace", assetId: "asset"
    })).resolves.toEqual({
      bytes,
      inspection: {
        status: "accepted", detectedMediaType: "image/png",
        byteSize: 4, width: 1, height: 1, policyVersion: "decoder-backed-png-v1"
      }
    });
    expect(request.init.headers).toEqual({ Authorization: "Bearer session" });
    expect(request.url).toEndWith("/workspaces/workspace/assets/asset/preview.png");
  });

  test("rejects malformed PNG preview response envelopes", async () => {
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async () => new Response(new Uint8Array([1]), {
        headers: { "Content-Type": "image/png" }
      })
    });
    await expect(client.acceptedPngPreview({
      token: "session", workspaceId: "workspace", assetId: "asset"
    })).rejects.toMatchObject({ code: "invalid_png_preview_response" });
  });

  test("uploads exact PNG bytes and polls only bounded inspection metadata", async () => {
    const nodeId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const referenceId = crypto.randomUUID();
    const bytes = new Uint8Array([1, 2, 3]);
    const requests = [];
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async (url, init = {}) => {
        requests.push({ url, init });
        return url.endsWith("/assets")
          ? json({
              nodeId, assetId, referenceId, mediaType: "image/png", byteSize: 3,
              inspectionStatus: "pending", detectedMediaType: null,
              policyVersion: null, width: null, height: null
            }, 202)
          : json({
              assetId, mediaType: "image/png", byteSize: 3,
              inspectionStatus: "accepted", detectedMediaType: "image/png",
              policyVersion: "decoder-backed-png-v1", width: 1, height: 1
            });
      }
    });
    await expect(client.uploadPngAsset({
      token: "session", workspaceId: "workspace", documentId: "document", nodeId, bytes
    })).resolves.toMatchObject({ nodeId, assetId, referenceId, inspectionStatus: "pending" });
    await expect(client.assetInspection({
      token: "session", workspaceId: "workspace", assetId
    })).resolves.toMatchObject({ assetId, inspectionStatus: "accepted", width: 1, height: 1 });
    expect(requests[0].init.body).toBe(bytes);
    expect(requests[0].init.headers).toMatchObject({
      Authorization: "Bearer session", "Content-Type": "image/png", "X-KOMYAKU-Node-ID": nodeId,
      "X-KOMYAKU-Document-ID": "document"
    });
  });

  test("uploads an immutable text original with an encoded multilingual file name", async () => {
    const nodeId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const referenceId = crypto.randomUUID();
    const bytes = new TextEncoder().encode("# 稿脈");
    let request;
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return json({
          nodeId, assetId, referenceId, fileName: "研究.md", mediaType: "text/markdown",
          byteSize: bytes.byteLength, inspectionStatus: "pending", detectedMediaType: null,
          policyVersion: null, width: null, height: null
        }, 202);
      }
    });
    await expect(client.uploadFileAsset({
      token: "session", workspaceId: "workspace", documentId: "document", nodeId,
      fileName: "研究.md", mediaType: "text/markdown", bytes
    })).resolves.toMatchObject({ assetId, referenceId, fileName: "研究.md" });
    expect(request.url).toEndWith("/workspaces/workspace/file-assets");
    expect(request.init.body).toBe(bytes);
    expect(request.init.headers).toMatchObject({
      "Content-Type": "text/markdown",
      "X-KOMYAKU-Node-ID": nodeId,
      "X-KOMYAKU-Document-ID": "document",
      "X-KOMYAKU-File-Name": encodeURIComponent("研究.md")
    });
  });

  test("submits only bounded Node-to-Asset identities for a document checkpoint", async () => {
    let request;
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return json({ revision: 5, activeReferenceCount: 1, releasedReferenceCount: 0, replayed: false });
      }
    });
    const references = [{ nodeId: crypto.randomUUID(), assetId: crypto.randomUUID() }];
    await client.reconcileDocumentAssets({
      token: "session", workspaceId: "workspace", documentId: "document", revision: 5, references
    });
    expect(request.url).toEndWith("/workspaces/workspace/documents/document/asset-checkpoint");
    expect(request.init.method).toBe("PUT");
    expect(JSON.parse(request.init.body)).toEqual({ revision: 5, references });
    expect(request.init.body).not.toContain("content");
  });

  test("requests a verified export from the exact Canonical document", async () => {
    let request;
    const document = { id: "document", type: "document" };
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return json({ artifactId: "artifact", documentId: "document", formatVersion: 1 }, 201);
      }
    });
    await client.createVerifiedDocumentExport({ token: "session", workspaceId: "workspace", documentId: "document", document });
    expect(request.url).toEndWith("/workspaces/workspace/documents/document/exports");
    expect(request.init.method).toBe("POST");
    expect(JSON.parse(request.init.body)).toEqual(document);
  });

  test("uploads exact .komyaku bytes with the registered media type", async () => {
    let request;
    const bytes = new Uint8Array([80, 75, 3, 4]);
    const client = createApiClient({
      baseUrl: "https://komyaku.example/api/v1",
      fetchImpl: async (url, init) => {
        request = { url, init };
        return json({ importId: "import", archiveDigest: "a".repeat(64), replayed: false, assetCount: 0 });
      }
    });
    await client.importKomyakuArchive({ token: "session", workspaceId: "workspace", bytes });
    expect(request.url).toEndWith("/workspaces/workspace/archive-imports");
    expect(request.init.headers["Content-Type"]).toBe("application/vnd.komyaku.archive+zip");
    expect(request.init.body).toBe(bytes);
  });
});
