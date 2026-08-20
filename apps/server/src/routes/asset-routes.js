import { Hono } from "hono";
import { z, ZodError } from "zod";
import { sessionAuth } from "../middleware/session-auth.js";

const uuidSchema = z.string().uuid();

function noStore(context) {
  context.header("Cache-Control", "no-store");
  context.header("Pragma", "no-cache");
}

export function createAssetRoutes({ identityService, deliveryService }) {
  if (!deliveryService?.createDownload) throw new Error("Asset delivery service is required");
  const routes = new Hono();
  routes.use(
    "/workspaces/:workspaceId/assets/:assetId/download-url",
    sessionAuth({ identityService })
  );
  routes.get("/workspaces/:workspaceId/assets/:assetId/download-url", async (context) => {
    noStore(context);
    try {
      const workspaceId = uuidSchema.parse(context.req.param("workspaceId"));
      const assetId = uuidSchema.parse(context.req.param("assetId"));
      const result = await deliveryService.createDownload({
        workspaceId, assetId, userId: context.get("identity").userId
      });
      return result
        ? context.json(result)
        : context.json({ error: "asset_not_available" }, 404);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_resource_id" }, 400);
      throw error;
    }
  });
  return routes;
}
