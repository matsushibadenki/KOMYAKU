import { describe, expect, test } from "bun:test";
import { createAssetRoutes } from "../src/routes/asset-routes.js";
import { createSessionToken } from "../src/security/session-tokens.js";

describe("Asset download routes", () => {
  test("requires a valid Session and returns no-store metadata", async () => {
    const token = createSessionToken();
    const identity = { userId: crypto.randomUUID(), sessionId: crypto.randomUUID() };
    const workspaceId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const routes = createAssetRoutes({
      identityService: { authenticateToken: async () => identity },
      deliveryService: {
        async createDownload(input) {
          expect(input).toEqual({ workspaceId, assetId, userId: identity.userId });
          return { assetId, mediaType: "image/png", byteSize: 10, expiresIn: 60, url: "https://signed.invalid" };
        }
      }
    });
    const path = `/workspaces/${workspaceId}/assets/${assetId}/download-url`;
    expect((await routes.request(path)).status).toBe(401);
    const response = await routes.request(path, { headers: { Authorization: `Bearer ${token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("uses one opaque not-available response for unauthorized and unaccepted Assets", async () => {
    const token = createSessionToken();
    const routes = createAssetRoutes({
      identityService: { authenticateToken: async () => ({ userId: crypto.randomUUID() }) },
      deliveryService: { async createDownload() { return null; } }
    });
    const response = await routes.request(
      `/workspaces/${crypto.randomUUID()}/assets/${crypto.randomUUID()}/download-url`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "asset_not_available" });
  });

  test("proxies an accepted PNG with no-store and inspection headers", async () => {
    const token = createSessionToken();
    const identity = { userId: crypto.randomUUID() };
    const workspaceId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const routes = createAssetRoutes({
      identityService: { authenticateToken: async () => identity },
      deliveryService: {
        async createDownload() { return null; },
        async readPngPreview(input) {
          expect(input).toEqual({ workspaceId, assetId, userId: identity.userId });
          return {
            assetId, bytes, width: 1, height: 1,
            policyVersion: "decoder-backed-png-v1"
          };
        }
      }
    });
    const response = await routes.request(
      `/workspaces/${workspaceId}/assets/${assetId}/preview.png`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'none'; sandbox");
    expect(response.headers.get("X-KOMYAKU-Image-Width")).toBe("1");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  test("uploads a PNG as a pending Node reference, reports acceptance, and releases exact failures", async () => {
    const token = createSessionToken();
    const identity = { userId: crypto.randomUUID() };
    const workspaceId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const referenceId = crypto.randomUUID();
    const calls = [];
    let status = "pending";
    const routes = createAssetRoutes({
      identityService: { authenticateToken: async () => identity },
      assetService: {
        async storeAndReference(input) {
          calls.push(["store", input]);
          return { assetId, referenceId };
        },
        async releaseReference(input) {
          calls.push(["release", input]);
          return { assetId, activeReferenceCount: 0 };
        }
      },
      deliveryService: {
        async createDownload() { return null; },
        async readInspection(input) {
          calls.push(["inspect", input]);
          return {
            assetId, mediaType: "image/png", byteSize: 4, inspectionStatus: status,
            detectedMediaType: status === "accepted" ? "image/png" : null,
            policyVersion: status === "accepted" ? "decoder-backed-png-v1" : null,
            width: status === "accepted" ? 1 : null,
            height: status === "accepted" ? 1 : null
          };
        }
      }
    });
    const headers = {
      Authorization: `Bearer ${token}`,
      "Content-Type": "image/png",
      "X-KOMYAKU-Node-ID": nodeId,
      "X-KOMYAKU-Document-ID": documentId
    };
    const upload = await routes.request(`/workspaces/${workspaceId}/assets`, {
      method: "POST", headers, body: new Uint8Array([0x89, 0x50, 0x4e, 0x47])
    });
    expect(upload.status).toBe(202);
    expect(await upload.json()).toMatchObject({ assetId, referenceId, nodeId, inspectionStatus: "pending" });
    expect(calls[0][1]).toMatchObject({
      workspaceId, actorId: identity.userId, mediaType: "image/png",
      reference: { referrerType: "document_node", referrerId: nodeId, relation: "source", documentId }
    });

    status = "accepted";
    const inspection = await routes.request(
      `/workspaces/${workspaceId}/assets/${assetId}/inspection`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    expect(inspection.status).toBe(200);
    expect(await inspection.json()).toMatchObject({ inspectionStatus: "accepted", width: 1, height: 1 });

    const released = await routes.request(
      `/workspaces/${workspaceId}/assets/${assetId}/references/${referenceId}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    expect(released.status).toBe(200);
    expect(calls.at(-1)).toEqual(["release", {
      workspaceId, actorId: identity.userId, assetId, referenceId
    }]);
  });

  test("rejects unsupported and oversized uploads before Asset storage", async () => {
    const token = createSessionToken();
    const workspaceId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    let stores = 0;
    const routes = createAssetRoutes({
      identityService: { authenticateToken: async () => ({ userId: crypto.randomUUID() }) },
      assetService: {
        async storeAndReference() {
          stores += 1;
          throw new Error("unreachable");
        }
      },
      deliveryService: {
        async createDownload() { return null; },
        async readInspection() { return null; }
      }
    });
    const baseHeaders = {
      Authorization: `Bearer ${token}`,
      "X-KOMYAKU-Node-ID": nodeId,
      "X-KOMYAKU-Document-ID": documentId
    };
    const unsupported = await routes.request(`/workspaces/${workspaceId}/assets`, {
      method: "POST",
      headers: { ...baseHeaders, "Content-Type": "image/jpeg" },
      body: new Uint8Array([0xff, 0xd8, 0xff])
    });
    expect(unsupported.status).toBe(415);
    expect(await unsupported.json()).toEqual({ error: "unsupported_media_type" });

    const oversized = await routes.request(`/workspaces/${workspaceId}/assets`, {
      method: "POST",
      headers: { ...baseHeaders, "Content-Type": "image/png" },
      body: new Uint8Array((256 * 1024) + 1)
    });
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ error: "asset_too_large" });
    expect(stores).toBe(0);
  });

  test("uploads an encoded-name immutable text original for asynchronous inspection", async () => {
    const token = createSessionToken();
    const identity = { userId: crypto.randomUUID() };
    const workspaceId = crypto.randomUUID();
    const nodeId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const referenceId = crypto.randomUUID();
    let stored;
    const routes = createAssetRoutes({
      identityService: { authenticateToken: async () => identity },
      assetService: {
        async storeAndReference(input) {
          stored = input;
          return { assetId, referenceId };
        }
      },
      deliveryService: {
        async createDownload() { return null; },
        async readInspection() {
          return { assetId, mediaType: "text/markdown", byteSize: 8, inspectionStatus: "pending", detectedMediaType: null, policyVersion: null, width: null, height: null };
        }
      }
    });
    const response = await routes.request(`/workspaces/${workspaceId}/file-assets`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/markdown",
        "X-KOMYAKU-Node-ID": nodeId,
        "X-KOMYAKU-Document-ID": documentId,
        "X-KOMYAKU-File-Name": encodeURIComponent("研究メモ.md")
      },
      body: new TextEncoder().encode("# Notes")
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ assetId, referenceId, nodeId, fileName: "研究メモ.md" });
    expect(stored).toMatchObject({ workspaceId, actorId: identity.userId, mediaType: "text/markdown" });
    expect(stored.reference).toEqual({ referrerType: "document_node", referrerId: nodeId, relation: "source", documentId });
  });
});
