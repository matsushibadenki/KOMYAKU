import { Hono } from "hono";
import { z, ZodError } from "zod";
import { sessionAuth } from "../middleware/session-auth.js";

const bodySchema = z.object({
  revision: z.number().int().positive(),
  references: z.array(z.object({ nodeId: z.string().uuid(), assetId: z.string().uuid() }).strict()).max(5000)
}).strict();

export function createDocumentAssetRoutes({ identityService, service }) {
  if (!service?.reconcile) throw new Error("Document Asset reconciliation service is required");
  const routes = new Hono();
  routes.use("/workspaces/:workspaceId/documents/:documentId/asset-checkpoint", sessionAuth({ identityService }));
  routes.put("/workspaces/:workspaceId/documents/:documentId/asset-checkpoint", async (context) => {
    context.header("Cache-Control", "no-store");
    try {
      const result = await service.reconcile({
        workspaceId: z.string().uuid().parse(context.req.param("workspaceId")),
        documentId: z.string().uuid().parse(context.req.param("documentId")),
        actorId: context.get("identity").userId,
        ...bodySchema.parse(await context.req.json())
      });
      return context.json(result);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) return context.json({ error: "invalid_asset_checkpoint" }, 400);
      if (error?.message === "Document Asset reconciliation is not authorized") return context.json({ error: "forbidden" }, 403);
      if (error?.message === "Stale document Asset checkpoint") return context.json({ error: "stale_asset_checkpoint" }, 409);
      if (error?.message === "Conflicting document Asset checkpoint") return context.json({ error: "conflicting_asset_checkpoint" }, 409);
      if (error?.message === "Document Asset checkpoint contains an unavailable reference") return context.json({ error: "unavailable_asset_reference" }, 409);
      throw error;
    }
  });
  return routes;
}
