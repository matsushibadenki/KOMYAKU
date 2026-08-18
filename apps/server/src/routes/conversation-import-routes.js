import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import { DEFAULT_MAX_IMPORT_BYTES } from "@komyaku/conversation-importer";
import { sessionAuth } from "../middleware/session-auth.js";
import { idempotencyBoundary } from "../middleware/idempotency-boundary.js";
import { ConversationImportError } from "../services/conversation-import-service.js";
import { IdempotencyError } from "../services/idempotency-service.js";

const workspaceSchema = z.string().uuid();

function noStore(context) {
  context.header("Cache-Control", "no-store");
  context.header("Pragma", "no-cache");
}

export function createConversationImportRoutes({
  identityService,
  importService,
  importRepository,
  idempotencyService,
  authorizeImport
}) {
  if (!importService?.importGenericJson) throw new Error("Conversation import service is required");
  if (!importRepository?.findImportResult) throw new Error("Conversation import result repository is required");
  if (typeof authorizeImport !== "function") throw new Error("Conversation import authorizer is required");

  const routes = new Hono();
  const requireSession = sessionAuth({ identityService });
  routes.use("/workspaces/:workspaceId/conversation-imports/:importId", requireSession);
  routes.use("/workspaces/:workspaceId/conversation-imports", requireSession);
  routes.use("/workspaces/:workspaceId/conversation-imports", bodyLimit({
    maxSize: DEFAULT_MAX_IMPORT_BYTES,
    onError: (context) => {
      noStore(context);
      return context.json({ error: "conversation_import_too_large" }, 413);
    }
  }));
  routes.use("/workspaces/:workspaceId/conversation-imports", idempotencyBoundary({
    service: idempotencyService,
    scope: (context) => {
      const identity = context.get("identity");
      return `conversation-import:${identity.userId}:${context.req.param("workspaceId")}`;
    }
  }));

  routes.post("/workspaces/:workspaceId/conversation-imports", async (context) => {
    noStore(context);
    try {
      const workspaceId = workspaceSchema.parse(context.req.param("workspaceId"));
      const identity = context.get("identity");
      const allowed = await authorizeImport({
        workspaceId, actorId: identity.userId, action: "conversation:import"
      });
      if (!allowed) return context.json({ error: "forbidden" }, 403);
      const contentType = context.req.header("Content-Type") ?? "";
      if (!contentType.toLowerCase().startsWith("application/json")) {
        return context.json({ error: "unsupported_media_type" }, 415);
      }
      const raw = new Uint8Array(await context.req.raw.arrayBuffer());
      const execute = context.get("executeIdempotent");
      const outcome = await execute(async () => {
        try {
          const value = await importService.importGenericJson({
            workspaceId,
            actorId: identity.userId,
            raw,
            sourceProvider: "generic",
            sourceFormat: "generic-json",
            contentType,
            visibility: "private",
            aiTrainingPolicy: "deny"
          });
          return { status: 201, reference: value.importId, value };
        } catch (error) {
          if (error instanceof ConversationImportError) {
            return {
              status: 422,
              reference: error.importId,
              value: { error: "conversation_import_failed", importId: error.importId }
            };
          }
          throw error;
        }
      });
      if (outcome.replayed) {
        const value = await importRepository.findImportResult({
          importId: outcome.reference, workspaceId, userId: identity.userId
        });
        if (!value) return context.json({ error: "idempotency_result_unavailable" }, 409);
        context.header("Idempotency-Replayed", "true");
        return context.json(value, outcome.status);
      }
      return context.json(outcome.value, outcome.status);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_workspace_id" }, 400);
      if (error instanceof IdempotencyError) {
        const status = error.code === "idempotency_in_progress" ? 409
          : error.code === "idempotency_key_reused" ? 422
            : 409;
        return context.json({ error: error.code }, status);
      }
      throw error;
    }
  });

  routes.get("/workspaces/:workspaceId/conversation-imports/:importId", async (context) => {
    noStore(context);
    try {
      const workspaceId = workspaceSchema.parse(context.req.param("workspaceId"));
      const importId = z.string().uuid().parse(context.req.param("importId"));
      const result = await importRepository.findImportResult({
        importId,
        workspaceId,
        userId: context.get("identity").userId
      });
      return result
        ? context.json(result)
        : context.json({ error: "conversation_import_not_found" }, 404);
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_resource_id" }, 400);
      throw error;
    }
  });

  return routes;
}
