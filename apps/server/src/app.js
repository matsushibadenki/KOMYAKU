import { Hono } from "hono";
import { cors } from "hono/cors";
import { requestId } from "hono/request-id";
import { parseAiTrainingPolicy } from "@komyaku/shared";
import { aiTrainingPolicy } from "./middleware/ai-training-policy.js";
import { structuredRequestLog } from "./middleware/structured-request-log.js";
import { createRuntimeState } from "./runtime-state.js";

export function createApp({
  aiTrainingDefault = parseAiTrainingPolicy(Bun.env.AI_TRAINING_DEFAULT),
  log = console.info,
  runtimeState = createRuntimeState(),
  readinessCheck = async () => true
} = {}) {
  const app = new Hono();

  app.use("*", requestId());
  app.use("*", structuredRequestLog({ log }));
  app.use("*", aiTrainingPolicy({ defaultPolicy: aiTrainingDefault }));
  app.use(
    "/api/*",
    cors({
      origin: ["http://localhost:1420", "http://127.0.0.1:1420"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Request-ID"]
    })
  );

  app.use("*", async (context, next) => {
    await next();
    context.header("X-Content-Type-Options", "nosniff");
    context.header("Referrer-Policy", "no-referrer");
    context.header("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  });

  app.get("/api/v1/health", (context) =>
    context.json({ status: "ok", service: "komyaku-server" })
  );

  app.get("/health/live", (context) =>
    context.json({ status: "ok" })
  );

  app.get("/health/ready", async (context) => {
    if (!runtimeState.isAcceptingTraffic()) {
      return context.json({ status: "not_ready" }, 503);
    }

    try {
      const dependenciesReady = await readinessCheck();
      return dependenciesReady
        ? context.json({ status: "ready" })
        : context.json({ status: "not_ready" }, 503);
    } catch {
      return context.json({ status: "not_ready" }, 503);
    }
  });

  app.get("/api/v1/privacy/ai-training-policy", (context) =>
    context.json({ defaultPolicy: aiTrainingDefault, userOverrideSupported: true })
  );

  app.notFound((context) => context.json({ error: "not_found" }, 404));
  app.onError((error, context) => {
    log(JSON.stringify({
      level: "error",
      event: "request_failed",
      requestId: context.get("requestId"),
      errorName: error.name
    }));
    return context.json({ error: "internal_error" }, 500);
  });

  return { app, runtimeState };
}
