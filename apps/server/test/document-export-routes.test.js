import { describe, expect, test } from "bun:test";
import { createEmptyDocument } from "@komyaku/document-schema";
import { createDocumentExportRoutes } from "../src/routes/document-export-routes.js";
import { createSessionToken } from "../src/security/session-tokens.js";

describe("verified document export route", () => {
  test("binds the authenticated actor and exact Document identity", async () => {
    const document = createEmptyDocument();
    const workspaceId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    let input;
    const routes = createDocumentExportRoutes({
      identityService: { authenticateToken: async () => ({ userId: actorId }) },
      service: { async createVerifiedExport(value) { input = value; return { artifactId: crypto.randomUUID(), documentId: document.id }; } }
    });
    const response = await routes.request(`/workspaces/${workspaceId}/documents/${document.id}/exports`, {
      method: "POST", headers: { Authorization: `Bearer ${createSessionToken()}`, "Content-Type": "application/json" },
      body: JSON.stringify(document)
    });
    expect(response.status).toBe(201);
    expect(input).toEqual({ workspaceId, documentId: document.id, actorId, document });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("provides bounded list, download receipt, and evidence-linked invalidation", async () => {
    const workspaceId = crypto.randomUUID();
    const documentId = crypto.randomUUID();
    const artifactId = crypto.randomUUID();
    const identityService = { authenticateToken: async () => ({ userId: crypto.randomUUID() }) };
    const service = {
      async createVerifiedExport() {},
      async listVerifiedExports() { return [{ artifactId, byteSize: 10 }]; },
      async createDownload() { return { artifactId, url: "https://download.invalid", expiresIn: 60 }; },
      async invalidateVerifiedExport() { return { artifactId, invalidatedEvidenceCount: 1 }; }
    };
    const routes = createDocumentExportRoutes({ identityService, service });
    const headers = { Authorization: `Bearer ${createSessionToken()}` };
    const base = `/workspaces/${workspaceId}/documents/${documentId}/exports`;
    expect(await (await routes.request(base, { headers })).json()).toEqual({ exports: [{ artifactId, byteSize: 10 }] });
    expect(await (await routes.request(`${base}/${artifactId}/download-url`, { headers })).json()).toMatchObject({ artifactId, expiresIn: 60 });
    const invalidated = await routes.request(`${base}/${artifactId}`, { method: "DELETE", headers });
    expect(await invalidated.json()).toEqual({ artifactId, invalidatedEvidenceCount: 1 });
  });
});
