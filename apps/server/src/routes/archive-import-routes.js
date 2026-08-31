import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import { sessionAuth } from "../middleware/session-auth.js";

const ARCHIVE_MEDIA_TYPE = "application/vnd.komyaku.archive+zip";
const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

export function createArchiveImportRoutes({ identityService, service }) {
  if (!service?.importArchive) throw new Error("Archive import service is required");
  const routes = new Hono();
  const path = "/workspaces/:workspaceId/archive-imports";
  routes.use(path, sessionAuth({ identityService }));
  routes.use(path, bodyLimit({
    maxSize: MAX_IMPORT_BYTES,
    onError: (context) => context.json({ error: "archive_too_large" }, 413)
  }));
  routes.post(path, async (context) => {
    context.header("Cache-Control", "no-store");
    if (context.req.header("Content-Type")?.split(";", 1)[0].trim().toLowerCase() !== ARCHIVE_MEDIA_TYPE) {
      return context.json({ error: "unsupported_archive_media_type" }, 415);
    }
    try {
      const result = await service.importArchive({
        workspaceId: z.string().uuid().parse(context.req.param("workspaceId")),
        actorId: context.get("identity").userId,
        bytes: new Uint8Array(await context.req.arrayBuffer())
      });
      return context.json(result, result.replayed ? 200 : 201);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError
        || error?.message === "Invalid Archive import size") return context.json({ error: "invalid_archive_import" }, 400);
      if (error?.message === "Archive import is not authorized") return context.json({ error: "forbidden" }, 403);
      if (error?.message === "Archive Document identity conflict"
        || error?.message === "Archive Asset metadata conflict") return context.json({ error: "archive_import_conflict" }, 409);
      if (error?.message?.startsWith("Archive ") || error?.message?.includes("archive")
        || error?.message?.startsWith("invalid_") || error?.message?.startsWith("unsafe_")) {
        return context.json({ error: "archive_import_rejected" }, 422);
      }
      throw error;
    }
  });
  return routes;
}
