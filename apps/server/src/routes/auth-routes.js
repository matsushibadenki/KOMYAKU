import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import { IdentityError } from "../services/identity-service.js";
import { sessionAuth } from "../middleware/session-auth.js";

const MAX_AUTH_BODY_BYTES = 16 * 1024;

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "invalid-email";
}

function noStore(context) {
  context.header("Cache-Control", "no-store");
  context.header("Pragma", "no-cache");
}

function errorResponse(context, error) {
  noStore(context);
  if (error instanceof ZodError || error instanceof SyntaxError) {
    return context.json({ error: "validation_error" }, 400);
  }
  if (error instanceof IdentityError) {
    const status = error.code === "invalid_credentials" ? 401
      : error.code === "email_unavailable" ? 409
        : error.code === "identity_not_found" ? 404
          : 400;
    return context.json({ error: error.code }, status);
  }
  throw error;
}

async function jsonBody(context) {
  return context.req.json();
}

export function createAuthRoutes({ identityService, rateLimitService, resolveNetworkIdentifier }) {
  if (!identityService) throw new Error("Identity service is required");
  if (!rateLimitService?.consume || !rateLimitService?.clear) {
    throw new Error("Authentication rate limit service is required");
  }
  if (typeof resolveNetworkIdentifier !== "function") throw new Error("Network identifier resolver is required");

  const routes = new Hono();
  const requireSession = sessionAuth({ identityService });
  routes.use("*", bodyLimit({
    maxSize: MAX_AUTH_BODY_BYTES,
    onError: (context) => {
      noStore(context);
      return context.json({ error: "request_too_large" }, 413);
    }
  }));

  async function enforce(context, policy, identifier) {
    const result = await rateLimitService.consume(policy, identifier);
    context.header("X-RateLimit-Remaining", String(result.remaining));
    if (result.allowed) return null;
    context.header("Retry-After", String(result.retryAfterSeconds));
    noStore(context);
    return context.json({ error: "rate_limited" }, 429);
  }

  routes.post("/register", async (context) => {
    const limited = await enforce(context, "registerNetwork", resolveNetworkIdentifier(context));
    if (limited) return limited;
    try {
      const result = await identityService.register(await jsonBody(context));
      noStore(context);
      return context.json(result, 201);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.post("/login", async (context) => {
    let body;
    try {
      body = await jsonBody(context);
    } catch (error) {
      return errorResponse(context, error);
    }
    const email = normalizeEmail(body?.email);
    const network = resolveNetworkIdentifier(context);
    const networkLimited = await enforce(context, "loginNetwork", network);
    if (networkLimited) return networkLimited;
    const identityLimited = await enforce(context, "loginIdentifier", email);
    if (identityLimited) return identityLimited;
    try {
      const result = await identityService.login(body);
      await rateLimitService.clear("loginIdentifier", email);
      noStore(context);
      return context.json(result);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.get("/session", requireSession, (context) => {
    noStore(context);
    return context.json({ identity: context.get("identity") });
  });

  routes.post("/logout", requireSession, async (context) => {
    const identity = context.get("identity");
    await identityService.logout({ sessionId: identity.sessionId, userId: identity.userId });
    noStore(context);
    return context.body(null, 204);
  });

  routes.post("/logout-all", requireSession, async (context) => {
    await identityService.logoutAll(context.get("identity").userId);
    noStore(context);
    return context.body(null, 204);
  });

  routes.post("/email-verification/request", requireSession, async (context) => {
    const identity = context.get("identity");
    const limited = await enforce(context, "verificationIdentifier", identity.userId);
    if (limited) return limited;
    const result = await identityService.requestEmailVerification({ userId: identity.userId });
    noStore(context);
    return context.json(result, 202);
  });

  routes.post("/email-verification/confirm", async (context) => {
    const limited = await enforce(context, "verificationNetwork", resolveNetworkIdentifier(context));
    if (limited) return limited;
    try {
      const body = await jsonBody(context);
      await identityService.verifyEmail(body?.token);
      noStore(context);
      return context.json({ verified: true });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.post("/password-reset/request", async (context) => {
    let body;
    try {
      body = await jsonBody(context);
    } catch (error) {
      return errorResponse(context, error);
    }
    const email = normalizeEmail(body?.email);
    const networkLimited = await enforce(context, "resetNetwork", resolveNetworkIdentifier(context));
    if (networkLimited) return networkLimited;
    const identityLimited = await enforce(context, "resetIdentifier", email);
    if (identityLimited) return identityLimited;
    try {
      await identityService.requestPasswordReset(body);
      noStore(context);
      return context.json({ accepted: true }, 202);
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  routes.post("/password-reset/confirm", async (context) => {
    const limited = await enforce(context, "resetNetwork", resolveNetworkIdentifier(context));
    if (limited) return limited;
    try {
      const body = await jsonBody(context);
      await identityService.resetPassword(body);
      noStore(context);
      return context.json({ reset: true });
    } catch (error) {
      return errorResponse(context, error);
    }
  });

  return routes;
}
