import { describe, expect, test } from "bun:test";
import { createArchiveImportRoutes } from "../src/routes/archive-import-routes.js";
import { createSessionToken } from "../src/security/session-tokens.js";

describe("Archive import route", () => {
  test("binds raw Archive bytes to authenticated Workspace materialization", async () => {
    const workspaceId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    let input;
    const routes = createArchiveImportRoutes({
      identityService: { authenticateToken: async () => ({ userId: actorId }) },
      service: { importArchive: async (value) => { input = value; return { importId: crypto.randomUUID(), replayed: false }; } }
    });
    const response = await routes.request(`/workspaces/${workspaceId}/archive-imports`, {
      method: "POST",
      headers: { Authorization: `Bearer ${createSessionToken()}`, "Content-Type": "application/vnd.komyaku.archive+zip" },
      body: new Uint8Array([1, 2, 3])
    });
    expect(response.status).toBe(201);
    expect(input).toMatchObject({ workspaceId, actorId });
    expect(input.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("rejects an ambiguous upload media type", async () => {
    const routes = createArchiveImportRoutes({
      identityService: { authenticateToken: async () => ({ userId: crypto.randomUUID() }) },
      service: { importArchive: async () => { throw new Error("must not run"); } }
    });
    const response = await routes.request(`/workspaces/${crypto.randomUUID()}/archive-imports`, {
      method: "POST", headers: { Authorization: `Bearer ${createSessionToken()}`, "Content-Type": "application/zip" }, body: "zip"
    });
    expect(response.status).toBe(415);
  });
});
