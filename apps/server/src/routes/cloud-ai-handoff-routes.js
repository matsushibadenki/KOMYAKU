import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z, ZodError } from "zod";
import { sessionAuth } from "../middleware/session-auth.js";
import { idempotencyBoundary } from "../middleware/idempotency-boundary.js";
import { CloudAiHandoffError } from "../services/cloud-ai-handoff-service.js";
import { IdempotencyError } from "../services/idempotency-service.js";

const MAX_CLOUD_HANDOFF_BYTES = 1024 * 1024;
const uuidSchema = z.string().uuid();

function noStore(context) {
  context.header("Cache-Control", "no-store");
  context.header("Pragma", "no-cache");
}

export function createCloudAiHandoffRoutes({ identityService, service, repository, idempotencyService }) {
  if (!service?.persistCompleted) throw new Error("Cloud AI handoff service is required");
  if (!repository?.findCompletedHandoff) throw new Error("Cloud AI handoff result repository is required");
  if (!repository?.listAvailableProviderConnections) throw new Error("Cloud AI provider connection repository is required");
  const routes = new Hono();
  const route = "/workspaces/:workspaceId/conversations/:conversationId/ai-handoffs";
  const connectionsRoute = "/workspaces/:workspaceId/ai-provider-connections";
  routes.use(route, sessionAuth({ identityService }));
  routes.use(connectionsRoute, sessionAuth({ identityService }));
  routes.use(route, bodyLimit({
    maxSize: MAX_CLOUD_HANDOFF_BYTES,
    onError: (context) => {
      noStore(context);
      return context.json({ error: "cloud_ai_handoff_too_large" }, 413);
    }
  }));
  routes.use(route, idempotencyBoundary({
    service: idempotencyService,
    scope: (context) => `cloud-ai-handoff:${context.get("identity").userId}:${context.req.param("workspaceId")}`
  }));

  routes.post(route, async (context) => {
    noStore(context);
    try {
      const workspaceId = uuidSchema.parse(context.req.param("workspaceId"));
      const conversationId = uuidSchema.parse(context.req.param("conversationId"));
      const body = await context.req.json();
      if (body?.confirmed?.conversationId !== conversationId) {
        return context.json({ error: "invalid_cloud_ai_handoff" }, 400);
      }
      const actorId = context.get("identity").userId;
      const outcome = await context.get("executeIdempotent")(async () => {
        const value = await service.persistCompleted({ ...body, workspaceId, actorId });
        return { status: 201, reference: value.handoffId, value };
      });
      if (outcome.replayed) {
        const value = await repository.findCompletedHandoff({
          handoffId: outcome.reference, workspaceId, actorId
        });
        if (!value || value.conversationId !== conversationId) {
          return context.json({ error: "idempotency_result_unavailable" }, 409);
        }
        context.header("Idempotency-Replayed", "true");
        return context.json(value, outcome.status);
      }
      return context.json(outcome.value, outcome.status);
    } catch (error) {
      if (error instanceof ZodError || error instanceof SyntaxError) {
        return context.json({ error: "invalid_cloud_ai_handoff" }, 400);
      }
      if (error instanceof CloudAiHandoffError) {
        const status = error.code === "cloud_ai_handoff_forbidden" ? 403
          : error.code === "cloud_ai_handoff_conflict" ? 409
            : error.code === "invalid_cloud_ai_handoff" ? 400 : 503;
        return context.json({ error: error.code }, status);
      }
      if (error instanceof IdempotencyError) {
        const status = error.code === "idempotency_key_reused" ? 422 : 409;
        return context.json({ error: error.code }, status);
      }
      throw error;
    }
  });
  routes.get(connectionsRoute, async (context) => {
    noStore(context);
    try {
      const workspaceId = uuidSchema.parse(context.req.param("workspaceId"));
      const actorId = context.get("identity").userId;
      return context.json({
        connections: await repository.listAvailableProviderConnections({ workspaceId, actorId })
      });
    } catch (error) {
      if (error instanceof ZodError) return context.json({ error: "invalid_workspace_id" }, 400);
      throw error;
    }
  });
  return routes;
}
