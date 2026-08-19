import { Hono } from "hono";
import { createServer } from "node:net";
import { createAuthRoutes } from "../src/routes/auth-routes.js";
import { createIdentityService } from "../src/services/identity-service.js";

function positiveInteger(value, fallback, maximum, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}`);
  }
  return parsed;
}

function percentile(sorted, ratio) {
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
}

export function summarizeLatencies(latencies, elapsedMs) {
  const sorted = [...latencies].sort((a, b) => a - b);
  return {
    requests: sorted.length,
    elapsedMs: Math.round(elapsedMs),
    requestsPerSecond: Number((sorted.length / Math.max(elapsedMs / 1000, 0.001)).toFixed(2)),
    latencyMs: {
      min: Number((sorted[0] ?? 0).toFixed(2)),
      p50: Number(percentile(sorted, 0.5).toFixed(2)),
      p95: Number(percentile(sorted, 0.95).toFixed(2)),
      p99: Number(percentile(sorted, 0.99).toFixed(2)),
      max: Number((sorted.at(-1) ?? 0).toFixed(2))
    }
  };
}

async function reserveAvailablePort() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Unable to reserve a local load-test port");
  return port;
}

export async function runAuthEndpointLoad({
  requests = positiveInteger(Bun.env.AUTH_LOAD_REQUESTS, 40, 10_000, "AUTH_LOAD_REQUESTS"),
  concurrency = positiveInteger(Bun.env.AUTH_LOAD_CONCURRENCY, 4, 32, "AUTH_LOAD_CONCURRENCY"),
  p95LimitMs = positiveInteger(Bun.env.AUTH_LOAD_P95_LIMIT_MS, 2_000, 60_000, "AUTH_LOAD_P95_LIMIT_MS")
} = {}) {
  const identityService = createIdentityService({
    repository: { async findPasswordIdentityByEmail() { return null; } }
  });
  const authRoutes = createAuthRoutes({
    identityService,
    rateLimitService: {
      async consume() { return { allowed: true, remaining: 1_000_000, retryAfterSeconds: 0 }; },
      async clear() {}
    },
    resolveNetworkIdentifier: () => "127.0.0.1"
  });
  const app = new Hono();
  app.route("/api/v1/auth", authRoutes);
  const port = await reserveAvailablePort();
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });
  const endpoint = `http://127.0.0.1:${server.port}/api/v1/auth/login`;
  const latencies = [];
  const statuses = new Map();
  let cursor = 0;
  const started = performance.now();

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= requests) return;
      const requestStarted = performance.now();
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `unknown-${index}@example.invalid`,
          password: "deliberately incorrect password"
        })
      });
      await response.arrayBuffer();
      latencies.push(performance.now() - requestStarted);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
  } finally {
    server.stop(true);
  }

  const summary = {
    scenario: "unknown-account-login-with-real-argon2-dummy-verification",
    concurrency,
    ...summarizeLatencies(latencies, performance.now() - started),
    statuses: Object.fromEntries([...statuses.entries()].sort(([a], [b]) => a - b)),
    thresholds: { expectedStatus: 401, p95LimitMs }
  };
  if (statuses.size !== 1 || statuses.get(401) !== requests) {
    throw Object.assign(new Error("Unexpected authentication load-test status"), { summary });
  }
  if (summary.latencyMs.p95 > p95LimitMs) {
    throw Object.assign(new Error("Authentication load-test p95 threshold exceeded"), { summary });
  }
  return summary;
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await runAuthEndpointLoad(), null, 2));
  } catch (error) {
    if (error?.summary) console.error(JSON.stringify(error.summary, null, 2));
    console.error(error?.message ?? "Authentication load test failed");
    process.exitCode = 1;
  }
}
