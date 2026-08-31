import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import { sessionAuth } from "../middleware/session-auth.js";

const uuidSchema = z.string().uuid();
const MAX_CLOUD_PNG_BYTES = 256 * 1024;
const MAX_CLOUD_FILE_BYTES = 1024 * 1024;
const acceptedFileMediaTypes = new Set([
  "text/plain", "text/markdown", "text/csv", "text/vnd.mermaid", "application/json"
]);

function noStore(context) {
  context.header("Cache-Control", "no-store");
  context.header("Pragma", "no-cache");
}

export function createAssetRoutes({ identityService, deliveryService, assetService = null }) {
  if (!deliveryService?.createDownload) throw new Error("Asset delivery service is required");
  const routes = new Hono();
  const requireSession = sessionAuth({ identityService });
  routes.use("/workspaces/:workspaceId/assets", requireSession);
  routes.use("/workspaces/:workspaceId/assets", bodyLimit({
    maxSize: MAX_CLOUD_PNG_BYTES,
    onError: (context) => {
      noStore(context);
      return context.json({ error: "asset_too_large" }, 413);
    }
  }));
  routes.post("/workspaces/:workspaceId/assets", async (context) => {
    noStore(context);
    if (!assetService?.storeAndReference || !deliveryService?.readInspection) {
      return context.json({ error: "asset_upload_unavailable" }, 503);
    }
    try {
      const workspaceId = uuidSchema.parse(context.req.param("workspaceId"));
      const nodeId = uuidSchema.parse(context.req.header("X-KOMYAKU-Node-ID"));
      const documentId = uuidSchema.parse(context.req.header("X-KOMYAKU-Document-ID"));
      const contentType = (context.req.header("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
      if (contentType !== "image/png") return context.json({ error: "unsupported_media_type" }, 415);
      const bytes = new Uint8Array(await context.req.raw.arrayBuffer());
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_CLOUD_PNG_BYTES) {
        return context.json({ error: "asset_too_large" }, 413);
      }
      const identity = context.get("identity");
      const stored = await assetService.storeAndReference({
        workspaceId,
        actorId: identity.userId,
        mediaType: "image/png",
        body: bytes,
        reference: { referrerType: "document_node", referrerId: nodeId, relation: "source", documentId }
      });
      const inspection = await deliveryService.readInspection({
        workspaceId, assetId: stored.assetId, userId: identity.userId
      });
      if (!inspection) return context.json({ error: "asset_not_available" }, 404);
      const value = { ...inspection, nodeId, referenceId: stored.referenceId };
      return context.json(value, inspection.inspectionStatus === "accepted" ? 201 : 202);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_resource_id" }, 400);
      if (error?.message === "Asset write is not authorized") return context.json({ error: "forbidden" }, 403);
      throw error;
    }
  });

  routes.use("/workspaces/:workspaceId/file-assets", requireSession);
  routes.use("/workspaces/:workspaceId/file-assets", bodyLimit({
    maxSize: MAX_CLOUD_FILE_BYTES,
    onError: (context) => {
      noStore(context);
      return context.json({ error: "asset_too_large" }, 413);
    }
  }));
  routes.post("/workspaces/:workspaceId/file-assets", async (context) => {
    noStore(context);
    if (!assetService?.storeAndReference || !deliveryService?.readInspection) {
      return context.json({ error: "asset_upload_unavailable" }, 503);
    }
    try {
      const workspaceId = uuidSchema.parse(context.req.param("workspaceId"));
      const nodeId = uuidSchema.parse(context.req.header("X-KOMYAKU-Node-ID"));
      const documentId = uuidSchema.parse(context.req.header("X-KOMYAKU-Document-ID"));
      const mediaType = (context.req.header("Content-Type") ?? "").split(";", 1)[0].trim().toLowerCase();
      if (!acceptedFileMediaTypes.has(mediaType)) {
        return context.json({ error: "unsupported_media_type" }, 415);
      }
      let fileName;
      try {
        fileName = decodeURIComponent(context.req.header("X-KOMYAKU-File-Name") ?? "");
      } catch {
        return context.json({ error: "invalid_file_name" }, 400);
      }
      if (fileName.trim().length < 1 || fileName.length > 1000 || /[\0/\\]/u.test(fileName)) {
        return context.json({ error: "invalid_file_name" }, 400);
      }
      const bytes = new Uint8Array(await context.req.raw.arrayBuffer());
      if (bytes.byteLength < 1 || bytes.byteLength > MAX_CLOUD_FILE_BYTES) {
        return context.json({ error: "asset_too_large" }, 413);
      }
      const identity = context.get("identity");
      const stored = await assetService.storeAndReference({
        workspaceId,
        actorId: identity.userId,
        mediaType,
        body: bytes,
        reference: { referrerType: "document_node", referrerId: nodeId, relation: "source", documentId }
      });
      const inspection = await deliveryService.readInspection({
        workspaceId, assetId: stored.assetId, userId: identity.userId
      });
      if (!inspection) return context.json({ error: "asset_not_available" }, 404);
      const value = { ...inspection, nodeId, referenceId: stored.referenceId, fileName };
      return context.json(value, inspection.inspectionStatus === "accepted" ? 201 : 202);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_resource_id" }, 400);
      if (error?.message === "Asset write is not authorized") return context.json({ error: "forbidden" }, 403);
      throw error;
    }
  });

  routes.use(
    "/workspaces/:workspaceId/assets/:assetId/references/:referenceId",
    requireSession
  );
  routes.delete("/workspaces/:workspaceId/assets/:assetId/references/:referenceId", async (context) => {
    noStore(context);
    if (!assetService?.releaseReference) return context.json({ error: "asset_upload_unavailable" }, 503);
    try {
      const workspaceId = uuidSchema.parse(context.req.param("workspaceId"));
      const assetId = uuidSchema.parse(context.req.param("assetId"));
      const referenceId = uuidSchema.parse(context.req.param("referenceId"));
      const result = await assetService.releaseReference({
        workspaceId, actorId: context.get("identity").userId, assetId, referenceId
      });
      return result ? context.json({ released: true }) : context.json({ released: false }, 404);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_resource_id" }, 400);
      if (error?.message === "Asset reference release is not authorized") return context.json({ error: "forbidden" }, 403);
      throw error;
    }
  });

  routes.use(
    "/workspaces/:workspaceId/assets/:assetId/inspection",
    requireSession
  );
  routes.get("/workspaces/:workspaceId/assets/:assetId/inspection", async (context) => {
    noStore(context);
    try {
      const workspaceId = uuidSchema.parse(context.req.param("workspaceId"));
      const assetId = uuidSchema.parse(context.req.param("assetId"));
      const result = await deliveryService.readInspection({
        workspaceId, assetId, userId: context.get("identity").userId
      });
      return result ? context.json(result) : context.json({ error: "asset_not_available" }, 404);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_resource_id" }, 400);
      throw error;
    }
  });
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
  routes.use(
    "/workspaces/:workspaceId/assets/:assetId/preview.png",
    sessionAuth({ identityService })
  );
  routes.get("/workspaces/:workspaceId/assets/:assetId/preview.png", async (context) => {
    noStore(context);
    try {
      const workspaceId = uuidSchema.parse(context.req.param("workspaceId"));
      const assetId = uuidSchema.parse(context.req.param("assetId"));
      const result = await deliveryService.readPngPreview({
        workspaceId, assetId, userId: context.get("identity").userId
      });
      if (!result) return context.json({ error: "asset_not_available" }, 404);
      context.header("Content-Type", "image/png");
      context.header("Content-Disposition", `inline; filename="asset-${result.assetId}.png"`);
      context.header("Content-Security-Policy", "default-src 'none'; sandbox");
      context.header("X-KOMYAKU-Inspection-Policy", result.policyVersion);
      context.header("X-KOMYAKU-Image-Width", String(result.width));
      context.header("X-KOMYAKU-Image-Height", String(result.height));
      return context.body(result.bytes);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_resource_id" }, 400);
      throw error;
    }
  });
  return routes;
}
