import { createApp } from "./app.js";
import { loadRuntimeConfig } from "./config.js";
import { createDatabase } from "./database/client.js";
import { getConnInfo } from "hono/bun";
import { createAuthRateLimitRepository } from "./repositories/auth-rate-limit-repository.js";
import { createIdentityRepository } from "./repositories/identity-repository.js";
import { createOutboxRepository } from "./repositories/outbox-repository.js";
import { createJobRepository } from "./repositories/job-repository.js";
import { createConversationArchiveRepository } from "./repositories/conversation-archive-repository.js";
import { createConversationImportRepository } from "./repositories/conversation-import-repository.js";
import { createIdempotencyRepository } from "./repositories/idempotency-repository.js";
import { createAuthRateLimitService } from "./services/auth-rate-limit-service.js";
import { createIdentityService } from "./services/identity-service.js";
import { createOutboxDispatcher } from "./services/outbox-dispatcher.js";
import { createJobRunner } from "./services/job-runner.js";
import { createConversationArchiveVerificationHandler } from "./services/conversation-archive-verification.js";
import { createConversationImportService } from "./services/conversation-import-service.js";
import { createIdempotencyService } from "./services/idempotency-service.js";
import { createObjectStore, createS3Client } from "@komyaku/storage-core";
import { createAuthRoutes } from "./routes/auth-routes.js";
import { createConversationImportRoutes } from "./routes/conversation-import-routes.js";
import { workspaceConversationImportAuthorizer } from "./middleware/session-auth.js";
import { createNetworkIdentifierResolver } from "./security/network-identifier.js";
import {
  createSmtpNotificationService,
  createSmtpTransport
} from "./notifications/smtp-notification-service.js";

const config = loadRuntimeConfig();
const database = createDatabase(config);
let notificationService = null;
let authRoutes = null;
let conversationImportRoutes = null;
let outboxDispatcher = null;
let jobRunner = null;
let objectStorageClient = null;
objectStorageClient = createS3Client(config.objectStorage);
const objectStore = createObjectStore({
  client: objectStorageClient,
  bucket: config.objectStorage.bucket
});

if (config.deploymentMode !== "api") {
  outboxDispatcher = createOutboxDispatcher({
    repository: createOutboxRepository(database.sql),
    instanceId: config.instanceId,
    batchSize: config.outboxBatchSize,
    leaseSeconds: config.outboxLeaseSeconds,
    pollIntervalMs: config.outboxPollIntervalMs,
    maxAttempts: config.outboxMaxAttempts
  });
  jobRunner = createJobRunner({
    repository: createJobRepository(database.sql),
    handlers: {
      "conversation.imported": createConversationArchiveVerificationHandler({
        repository: createConversationArchiveRepository(database.sql),
        objectStore
      })
    },
    instanceId: config.instanceId,
    batchSize: config.jobBatchSize,
    leaseSeconds: config.jobLeaseSeconds,
    pollIntervalMs: config.jobPollIntervalMs
  });
}

if (config.authRoutesEnabled) {
  const identityRepository = createIdentityRepository(database.sql);
  const transport = createSmtpTransport(config.smtp);
  notificationService = createSmtpNotificationService({
    transport,
    from: config.smtp.from,
    publicAppOrigin: config.publicAppOrigin
  });
  await notificationService.verifyConnection();
  const identityService = createIdentityService({
    repository: identityRepository,
    notificationService,
    sessionTtlSeconds: config.sessionTtlSeconds
  });
  const rateLimitService = createAuthRateLimitService({
    repository: createAuthRateLimitRepository(database.sql),
    secret: config.authRateLimitSecret
  });
  const resolveNetworkIdentifier = createNetworkIdentifierResolver({
    trustedProxyHops: config.trustedProxyHops,
    getRemoteAddress: (context) => getConnInfo(context).remote.address
  });
  authRoutes = createAuthRoutes({ identityService, rateLimitService, resolveNetworkIdentifier });
  const importRepository = createConversationImportRepository(database.sql);
  const authorizeImport = workspaceConversationImportAuthorizer(identityRepository);
  const importService = createConversationImportService({
    objectStore,
    repository: importRepository,
    authorizeImport
  });
  conversationImportRoutes = createConversationImportRoutes({
    identityService,
    importService,
    importRepository,
    idempotencyService: createIdempotencyService({
      repository: createIdempotencyRepository(database.sql),
      secret: config.idempotencySecret
    }),
    authorizeImport
  });
}

const corsOrigins = ["http://localhost:1420", "http://127.0.0.1:1420"];
if (config.publicAppOrigin && !corsOrigins.includes(config.publicAppOrigin)) {
  corsOrigins.push(config.publicAppOrigin);
}
const { app, runtimeState } = createApp({
  authRoutes,
  conversationImportRoutes,
  corsOrigins,
  readinessCheck: database.checkHealth
});

const server = Bun.serve({
  port: config.port,
  hostname: config.hostname,
  fetch: app.fetch
});
outboxDispatcher?.start();
jobRunner?.start();

console.info(JSON.stringify({
  level: "info",
  event: "server_started",
  instanceId: config.instanceId,
  deploymentMode: config.deploymentMode,
  hostname: config.hostname,
  port: config.port,
  jobBackend: config.jobBackend
}));

let shutdownStarted = false;

async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  runtimeState.beginShutdown();

  console.info(JSON.stringify({
    level: "info",
    event: "server_shutdown_started",
    instanceId: config.instanceId,
    signal,
    graceMs: config.shutdownGraceMs
  }));

  const forceTimer = setTimeout(() => server.stop(true), config.shutdownGraceMs);
  forceTimer.unref();
  await server.stop(false);
  clearTimeout(forceTimer);
  await outboxDispatcher?.stop();
  await jobRunner?.stop();
  await database.close();
  objectStorageClient?.destroy();
  notificationService?.close();

  console.info(JSON.stringify({
    level: "info",
    event: "server_shutdown_completed",
    instanceId: config.instanceId
  }));
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
