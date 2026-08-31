import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import { sessionAuth } from "../middleware/session-auth.js";

export function createDocumentExportRoutes({ identityService, service }) {
  if (!service?.createVerifiedExport) throw new Error("Document export service is required");
  const routes = new Hono();
  const path = "/workspaces/:workspaceId/documents/:documentId/exports";
  routes.use(path, sessionAuth({ identityService }));
  routes.use(path, bodyLimit({ maxSize: 5 * 1024 * 1024, onError: (context) => context.json({ error: "document_too_large" }, 413) }));
  routes.post(path, async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const result = await service.createVerifiedExport({
        workspaceId: z.string().uuid().parse(context.req.param("workspaceId")),
        documentId: z.string().uuid().parse(context.req.param("documentId")),
        actorId: context.get("identity").userId,
        document: await context.req.json()
      });
      return context.json(result, 201);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return context.json({ error: "invalid_document_export" }, 400);
      if (error?.message === "Document export is not authorized") return context.json({ error: "forbidden" }, 403);
      if (error?.message === "Document export identity mismatch") return context.json({ error: "document_identity_mismatch" }, 409);
      if (error?.message === "Document export contains an unavailable Asset") return context.json({ error: "unavailable_asset" }, 409);
      throw error;
    }
  });
  routes.get(path, async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const exports = await service.listVerifiedExports({
        workspaceId: z.string().uuid().parse(context.req.param("workspaceId")),
        documentId: z.string().uuid().parse(context.req.param("documentId")),
        actorId: context.get("identity").userId
      });
      return context.json({ exports });
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_document_export" }, 400);
      throw error;
    }
  });
  const artifactPath = "/workspaces/:workspaceId/documents/:documentId/exports/:artifactId";
  routes.use(artifactPath, sessionAuth({ identityService }));
  routes.use(`${artifactPath}/download-url`, sessionAuth({ identityService }));
  routes.get(`${artifactPath}/download-url`, async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const result = await service.createDownload({
        workspaceId: z.string().uuid().parse(context.req.param("workspaceId")),
        documentId: z.string().uuid().parse(context.req.param("documentId")),
        artifactId: z.string().uuid().parse(context.req.param("artifactId")),
        actorId: context.get("identity").userId
      });
      return result ? context.json(result) : context.json({ error: "export_not_available" }, 404);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_document_export" }, 400);
      throw error;
    }
  });
  routes.delete(artifactPath, async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const result = await service.invalidateVerifiedExport({
        workspaceId: z.string().uuid().parse(context.req.param("workspaceId")),
        documentId: z.string().uuid().parse(context.req.param("documentId")),
        artifactId: z.string().uuid().parse(context.req.param("artifactId")),
        actorId: context.get("identity").userId
      });
      return result ? context.json(result) : context.json({ error: "export_not_available" }, 404);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_document_export" }, 400);
      if (error?.message === "Document export invalidation is not authorized") return context.json({ error: "forbidden" }, 403);
      throw error;
    }
  });
  return routes;
}
