import { describe, expect, test } from "bun:test";
import { createApp } from "../src/app.js";
import { createAuthRoutes } from "../src/routes/auth-routes.js";
import { IdentityError } from "../src/services/identity-service.js";

const sessionToken = "s".repeat(43);

function harness({ limits = {}, loginError = null } = {}) {
  const calls = [];
  const rateLimitService = {
    async consume(policy, identifier) {
      calls.push(["consume", policy, identifier]);
      return limits[policy] ?? { allowed: true, remaining: 4, retryAfterSeconds: 0 };
    },
    async clear(policy, identifier) {
      calls.push(["clear", policy, identifier]);
    }
  };
  const identity = {
    userId: "0198c9f1-0000-7000-8000-000000000001",
    sessionId: "0198c9f1-0000-7000-8000-000000000002",
    email: "writer@example.com"
  };
  const identityService = {
    async register(body) {
      calls.push(["register", body.email]);
      return { user: { email: body.email }, session: { token: sessionToken } };
    },
    async login(body) {
      calls.push(["login", body.email]);
      if (loginError) throw loginError;
      return { user: { email: body.email }, session: { token: sessionToken } };
    },
    async authenticateToken(token) {
      calls.push(["authenticate", token]);
      return token === sessionToken ? identity : null;
    },
    async logout(input) { calls.push(["logout", input.sessionId]); },
    async logoutAll(userId) { calls.push(["logoutAll", userId]); },
    async requestEmailVerification(input) {
      calls.push(["requestEmailVerification", input.userId]);
      return { delivery: "accepted" };
    },
    async verifyEmail(token) { calls.push(["verifyEmail", token]); },
    async requestPasswordReset(body) {
      calls.push(["requestPasswordReset", body.email]);
      return { accepted: true };
    },
    async resetPassword(body) { calls.push(["resetPassword", body.token]); }
  };
  const authRoutes = createAuthRoutes({
    identityService,
    rateLimitService,
    resolveNetworkIdentifier: () => "203.0.113.8"
  });
  const { app } = createApp({ authRoutes, log: () => {} });
  return { app, calls };
}

function jsonRequest(path, body, headers = {}) {
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
}

describe("feature-gated authentication routes", () => {
  test("remain absent unless explicitly mounted", async () => {
    const { app } = createApp({ log: () => {} });
    expect((await app.request("/api/v1/auth/session")).status).toBe(404);
  });

  test("registers only after the network limit allows the request", async () => {
    const { app, calls } = harness();
    const response = await app.request(jsonRequest("/api/v1/auth/register", {
      email: "writer@example.com",
      password: "A sufficiently long password",
      displayName: "Writer"
    }));

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(calls.slice(0, 2)).toEqual([
      ["consume", "registerNetwork", "203.0.113.8"],
      ["register", "writer@example.com"]
    ]);
  });

  test("stops rate-limited login before password verification", async () => {
    const { app, calls } = harness({
      limits: { loginNetwork: { allowed: false, remaining: 0, retryAfterSeconds: 91 } }
    });
    const response = await app.request(jsonRequest("/api/v1/auth/login", {
      email: "writer@example.com",
      password: "incorrect"
    }));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("91");
    expect(calls.some(([name]) => name === "login")).toBe(false);
  });

  test("returns a generic invalid-credentials response without caching", async () => {
    const { app } = harness({ loginError: new IdentityError("invalid_credentials") });
    const response = await app.request(jsonRequest("/api/v1/auth/login", {
      email: "unknown@example.com",
      password: "incorrect"
    }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "invalid_credentials" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  test("protects session routes with an opaque bearer token", async () => {
    const { app } = harness();
    const denied = await app.request("/api/v1/auth/session");
    expect(denied.status).toBe(401);
    expect(denied.headers.get("WWW-Authenticate")).toBe("Bearer");

    const accepted = await app.request("/api/v1/auth/session", {
      headers: { Authorization: `Bearer ${sessionToken}` }
    });
    expect(accepted.status).toBe(200);
    expect((await accepted.json()).identity.email).toBe("writer@example.com");
  });

  test("does not reveal whether a password-reset address exists", async () => {
    const { app } = harness();
    const response = await app.request(jsonRequest("/api/v1/auth/password-reset/request", {
      email: "unknown@example.com"
    }));
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
  });

  test("rejects authentication bodies larger than 16 KiB", async () => {
    const { app, calls } = harness();
    const response = await app.request(jsonRequest("/api/v1/auth/login", {
      email: "writer@example.com",
      password: "x".repeat(17 * 1024)
    }));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "request_too_large" });
    expect(calls).toEqual([]);
  });

  test("returns bounded generic errors and security headers for malformed input", async () => {
    const { app } = harness();
    const response = await app.request(new Request("http://localhost/api/v1/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not-json"
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "validation_error" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
  });
});
