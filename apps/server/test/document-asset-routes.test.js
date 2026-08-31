import { describe, expect, test } from "bun:test";
import { createDocumentAssetRoutes } from "../src/routes/document-asset-routes.js";
import { createSessionToken } from "../src/security/session-tokens.js";

describe("Document Asset checkpoint route", () => {
  test("binds authenticated identity to one Workspace and Document", async () => {
    const token = createSessionToken();
    const identity = { userId: crypto.randomUUID() };
    const workspaceId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const references = [{ nodeId: crypto.randomUUID(), assetId: crypto.randomUUID() }];
    let received;
    const routes = createDocumentAssetRoutes({
      identityService: { authenticateToken: async () => identity },
      service: { async reconcile(input) { received = input; return { revision: 2, activeReferenceCount: 1, releasedReferenceCount: 1, replayed: false }; } }
    });
    const response = await routes.request(`/workspaces/${workspaceId}/documents/${documentId}/asset-checkpoint`, {
      method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 2, references })
    });
    expect(response.status).toBe(200);
    expect(received).toEqual({ workspaceId, documentId, actorId: identity.userId, revision: 2, references });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("maps stale checkpoints to a bounded conflict", async () => {
    const routes = createDocumentAssetRoutes({
      identityService: { authenticateToken: async () => ({ userId: crypto.randomUUID() }) },
      service: { async reconcile() { throw new Error("Stale document Asset checkpoint"); } }
    });
    const response = await routes.request(`/workspaces/${crypto.randomUUID()}/documents/${crypto.randomUUID()}/asset-checkpoint`, {
      method: "PUT", headers: { Authorization: `Bearer ${createSessionToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ revision: 1, references: [] })
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "stale_asset_checkpoint" });
  });
});
