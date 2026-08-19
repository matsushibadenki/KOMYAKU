import { SQL } from "bun";
import { Hono } from "hono";
import { createNotificationEnvelope } from "../src/notifications/notification-envelope.js";
import {
  createSmtpNotificationService,
  createSmtpTransport
} from "../src/notifications/smtp-notification-service.js";
import { createAuthRateLimitRepository } from "../src/repositories/auth-rate-limit-repository.js";
import { createIdentityRepository } from "../src/repositories/identity-repository.js";
import { createJobRepository } from "../src/repositories/job-repository.js";
import { createOutboxRepository } from "../src/repositories/outbox-repository.js";
import { createAuthRoutes } from "../src/routes/auth-routes.js";
import { createAuthRateLimitService } from "../src/services/auth-rate-limit-service.js";
import { createIdentityService } from "../src/services/identity-service.js";
import { createJobRunner } from "../src/services/job-runner.js";
import { createNotificationDeliveryHandler } from "../src/services/notification-delivery-handler.js";
import { createOutboxDispatcher } from "../src/services/outbox-dispatcher.js";
import { reserveAvailablePort, summarizeLatencies } from "./auth-endpoint-load.js";

const LOCAL_DATABASE_URL = "postgres://komyaku_load:local-stage2-load-only@127.0.0.1:55432/komyaku_stage2_load";
const LOCAL_ENVELOPE_KEY = "22".repeat(32);

function boundedInteger(value, fallback, minimum, maximum, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function assertDedicatedDatabase(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!new Set(["postgres:", "postgresql:"]).has(url.protocol)) {
    throw new Error("AUTH_PRODUCTION_LOAD_DATABASE_URL must use PostgreSQL");
  }
  const databaseName = url.pathname.slice(1);
  if (databaseName !== "komyaku_stage2_load") {
    throw new Error("The Stage 2 load harness refuses any database except komyaku_stage2_load");
  }
}

async function mailpitMessageCount(origin) {
  const response = await fetch(new URL("/api/v1/messages", origin));
  if (!response.ok) throw new Error("Mailpit API is unavailable");
  const payload = await response.json();
  if (!Number.isSafeInteger(payload.total) || payload.total < 0) {
    throw new Error("Mailpit returned an invalid message count");
  }
  return payload.total;
}

async function waitForMailpitCount(origin, expected, timeoutMs = 5_000) {
  const started = performance.now();
  while (performance.now() - started < timeoutMs) {
    const count = await mailpitMessageCount(origin);
    if (count >= expected) return count;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Mailpit did not reach ${expected} messages before timeout`);
}

async function cleanupRun({ sql, users, workspaces }) {
  await sql.begin(async (tx) => {
    for (const id of [...users, ...workspaces]) {
      await tx`
        DELETE FROM job_attempts
        WHERE job_id IN (SELECT id FROM jobs WHERE partition_key = ${id})
      `;
      await tx`DELETE FROM jobs WHERE partition_key = ${id}`;
    }
    for (const id of users) await tx`DELETE FROM outbox_events WHERE aggregate_id = ${id}`;
    for (const id of workspaces) await tx`DELETE FROM outbox_events WHERE partition_key = ${id}`;
    for (const id of users) {
      await tx`DELETE FROM email_verification_tokens WHERE user_id = ${id}`;
      await tx`DELETE FROM password_reset_tokens WHERE user_id = ${id}`;
      await tx`DELETE FROM user_sessions WHERE user_id = ${id}`;
      await tx`DELETE FROM workspace_members WHERE user_id = ${id}`;
    }
    for (const id of workspaces) await tx`DELETE FROM workspaces WHERE id = ${id}`;
    for (const id of users) await tx`DELETE FROM users WHERE id = ${id}`;
  });
}

export async function runAuthProductionLoad({
  enabled = Bun.env.AUTH_PRODUCTION_LOAD_ENABLED === "1",
  requests = boundedInteger(Bun.env.AUTH_PRODUCTION_LOAD_REQUESTS, 8, 1, 10, "AUTH_PRODUCTION_LOAD_REQUESTS"),
  concurrency = boundedInteger(Bun.env.AUTH_PRODUCTION_LOAD_CONCURRENCY, 4, 1, 8, "AUTH_PRODUCTION_LOAD_CONCURRENCY"),
  registrationP95LimitMs = boundedInteger(Bun.env.AUTH_PRODUCTION_LOAD_REGISTER_P95_MS, 5_000, 100, 60_000, "AUTH_PRODUCTION_LOAD_REGISTER_P95_MS"),
  pipelineLimitMs = boundedInteger(Bun.env.AUTH_PRODUCTION_LOAD_PIPELINE_LIMIT_MS, 15_000, 100, 120_000, "AUTH_PRODUCTION_LOAD_PIPELINE_LIMIT_MS"),
  databaseUrl = Bun.env.AUTH_PRODUCTION_LOAD_DATABASE_URL ?? LOCAL_DATABASE_URL,
  smtpHost = Bun.env.AUTH_PRODUCTION_LOAD_SMTP_HOST ?? "127.0.0.1",
  smtpPort = boundedInteger(Bun.env.AUTH_PRODUCTION_LOAD_SMTP_PORT, 51025, 1, 65_535, "AUTH_PRODUCTION_LOAD_SMTP_PORT"),
  mailpitApiOrigin = Bun.env.AUTH_PRODUCTION_LOAD_MAILPIT_ORIGIN ?? "http://127.0.0.1:58025",
  notificationKey = Bun.env.AUTH_PRODUCTION_LOAD_NOTIFICATION_KEY ?? LOCAL_ENVELOPE_KEY
} = {}) {
  if (!enabled) throw new Error("Set AUTH_PRODUCTION_LOAD_ENABLED=1 to run the isolated Stage 2 load harness");
  assertDedicatedDatabase(databaseUrl);
  if (!/^[0-9a-fA-F]{64}$/.test(notificationKey)) {
    throw new Error("AUTH_PRODUCTION_LOAD_NOTIFICATION_KEY must be 64 hexadecimal characters");
  }

  const sql = new SQL({ url: databaseUrl, max: Math.max(concurrency + 4, 8), connectionTimeout: 5 });
  const identityRepository = createIdentityRepository(sql);
  const rateLimitService = createAuthRateLimitService({
    repository: createAuthRateLimitRepository(sql),
    secret: "stage2-load-rate-limit-secret-not-for-production"
  });
  const notificationEnvelope = createNotificationEnvelope({ keyHex: notificationKey });
  const identityService = createIdentityService({ repository: identityRepository, notificationEnvelope });
  const networkIdentifier = `stage2-load:${crypto.randomUUID()}`;
  const authRoutes = createAuthRoutes({
    identityService,
    rateLimitService,
    resolveNetworkIdentifier: () => networkIdentifier
  });
  const app = new Hono();
  app.route("/api/v1/auth", authRoutes);
  const port = await reserveAvailablePort();
  const server = Bun.serve({ hostname: "127.0.0.1", port, fetch: app.fetch });
  const transport = createSmtpTransport({
    host: smtpHost, port: smtpPort, secure: false, requireTls: false, user: null, password: null
  });
  const notificationService = createSmtpNotificationService({
    transport,
    from: "KOMYAKU Stage 2 Load <noreply@komyaku.invalid>",
    publicAppOrigin: "https://stage2-load.komyaku.invalid"
  });
  const outboxDispatcher = createOutboxDispatcher({
    repository: createOutboxRepository(sql), instanceId: `stage2-outbox-${crypto.randomUUID()}`,
    batchSize: requests * 2, log: () => {}
  });
  const jobRunner = createJobRunner({
    repository: createJobRepository(sql),
    handlers: {
      "notification.delivery_requested": createNotificationDeliveryHandler({
        notificationEnvelope, notificationService, identityRepository
      })
    },
    instanceId: `stage2-worker-${crypto.randomUUID()}`,
    batchSize: requests,
    log: () => {}
  });
  const runId = crypto.randomUUID();
  const createdUsers = [];
  const createdWorkspaces = [];
  let runFailed = false;

  try {
    await sql`SELECT 1 AS ready`;
    await notificationService.verifyConnection();
    const mailBefore = await mailpitMessageCount(mailpitApiOrigin);
    const endpoint = `http://127.0.0.1:${server.port}/api/v1/auth/register`;
    const latencies = [];
    const statuses = new Map();
    let cursor = 0;
    const registrationStarted = performance.now();

    async function worker() {
      while (true) {
        const index = cursor++;
        if (index >= requests) return;
        const requestStarted = performance.now();
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: `stage2-load-${runId}-${index}@example.invalid`,
            password: `Stage2 load password ${index}!`,
            displayName: `Stage 2 Load ${index}`,
            interfaceLocale: ["ja", "en", "zh-Hans"][index % 3],
            workspaceName: `Stage 2 Load ${index}`
          })
        });
        const payload = await response.json();
        latencies.push(performance.now() - requestStarted);
        statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
        if (response.status === 201) {
          createdUsers.push(payload.user.id);
          createdWorkspaces.push(payload.workspace.id);
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
    const registration = summarizeLatencies(latencies, performance.now() - registrationStarted);
    if (statuses.size !== 1 || statuses.get(201) !== requests) {
      throw Object.assign(new Error("Production-like registration returned unexpected statuses"), {
        summary: { statuses: Object.fromEntries(statuses), registration }
      });
    }
    if (registration.latencyMs.p95 > registrationP95LimitMs) {
      throw Object.assign(new Error("Production-like registration p95 threshold exceeded"), {
        summary: { registration, registrationP95LimitMs }
      });
    }

    const pipelineStarted = performance.now();
    const outbox = await outboxDispatcher.runOnce();
    const jobs = await jobRunner.runOnce();
    const mailAfter = await waitForMailpitCount(mailpitApiOrigin, mailBefore + requests);
    const pipelineMs = Math.round(performance.now() - pipelineStarted);
    if (jobs.completed !== requests || jobs.failed !== 0 || jobs.retried !== 0) {
      throw Object.assign(new Error("Notification delivery pipeline did not complete every message"), {
        summary: { outbox, jobs, mailBefore, mailAfter, pipelineMs }
      });
    }
    if (pipelineMs > pipelineLimitMs) {
      throw Object.assign(new Error("Notification delivery pipeline threshold exceeded"), {
        summary: { pipelineMs, pipelineLimitMs }
      });
    }

    return {
      scenario: "real-postgresql-registration-through-encrypted-outbox-to-smtp",
      requests,
      concurrency,
      registration,
      statuses: Object.fromEntries([...statuses.entries()].sort(([left], [right]) => left - right)),
      pipeline: { elapsedMs: pipelineMs, outbox, jobs, smtpMessagesAccepted: mailAfter - mailBefore },
      thresholds: { registrationP95LimitMs, pipelineLimitMs }
    };
  } catch (error) {
    runFailed = true;
    throw error;
  } finally {
    server.stop(true);
    let cleanupError = null;
    try {
      await cleanupRun({ sql, users: createdUsers, workspaces: createdWorkspaces });
      await rateLimitService.clear("registerNetwork", networkIdentifier);
    } catch (error) {
      cleanupError = error;
    } finally {
      notificationService.close();
      await sql.close({ timeout: 5 });
    }
    if (cleanupError && !runFailed) {
      throw new Error("Stage 2 load data cleanup failed", { cause: cleanupError });
    }
  }
}

if (import.meta.main) {
  try {
    console.log(JSON.stringify(await runAuthProductionLoad(), null, 2));
  } catch (error) {
    if (error?.summary) console.error(JSON.stringify(error.summary, null, 2));
    console.error(error?.message ?? "Production-like authentication load test failed");
    process.exitCode = 1;
  }
}
