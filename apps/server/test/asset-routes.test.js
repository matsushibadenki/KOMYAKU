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
});
