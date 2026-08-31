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
import { createCloudAiHandoffRepository } from "./repositories/cloud-ai-handoff-repository.js";
import { createIdempotencyRepository } from "./repositories/idempotency-repository.js";
import { createAssetDeliveryRepository } from "./repositories/asset-delivery-repository.js";
import { createAssetRepository } from "./repositories/asset-repository.js";
import { createAssetReferenceReconciliationRepository } from "./repositories/asset-reference-reconciliation-repository.js";
import { createDocumentExportRepository } from "./repositories/document-export-repository.js";
import { createAssetInspectionRepository } from "./repositories/asset-inspection-repository.js";
import { createAuthRateLimitService } from "./services/auth-rate-limit-service.js";
import { createIdentityService } from "./services/identity-service.js";
import { createOutboxDispatcher } from "./services/outbox-dispatcher.js";
import { createJobRunner } from "./services/job-runner.js";
import { createConversationArchiveVerificationHandler } from "./services/conversation-archive-verification.js";
import { createNotificationDeliveryHandler } from "./services/notification-delivery-handler.js";
import { createConversationImportService } from "./services/conversation-import-service.js";
import { createCloudAiHandoffService } from "./services/cloud-ai-handoff-service.js";
import { createIdempotencyService } from "./services/idempotency-service.js";
import { createAssetDeliveryService } from "./services/asset-delivery-service.js";
import { createAssetService } from "./services/asset-service.js";
import { createAssetReferenceReconciliationService } from "./services/asset-reference-reconciliation-service.js";
import { createDocumentExportService } from "./services/document-export-service.js";
import { createAssetInspectionService } from "./services/asset-inspection-service.js";
import { createAssetInspectionRunner } from "./services/asset-inspection-runner.js";
import { createDecoderBackedMediaInspector } from "./services/decoder-backed-media-inspector.js";
import { createObjectStore, createS3Client } from "@komyaku/storage-core";
import { createAuthRoutes } from "./routes/auth-routes.js";
import { createConversationImportRoutes } from "./routes/conversation-import-routes.js";
import { createCloudAiHandoffRoutes } from "./routes/cloud-ai-handoff-routes.js";
import { createAssetRoutes } from "./routes/asset-routes.js";
import { createDocumentAssetRoutes } from "./routes/document-asset-routes.js";
import { createDocumentExportRoutes } from "./routes/document-export-routes.js";
import { workspaceAssetAuthorizer, workspaceConversationImportAuthorizer } from "./middleware/session-auth.js";
import { createNetworkIdentifierResolver } from "./security/network-identifier.js";
import {
  createSmtpNotificationService,
  createSmtpTransport
} from "./notifications/smtp-notification-service.js";
import { createStructuredLogger } from "./logging/structured-logger.js";
import { createNotificationEnvelope } from "./notifications/notification-envelope.js";

const config = loadRuntimeConfig();
const logger = createStructuredLogger({
  level: config.logLevel,
  service: config.serviceName,
  environment: config.nodeEnv,
  instanceId: config.instanceId
});
const log = logger.log;
const database = createDatabase(config);
let notificationService = null;
let authRoutes = null;
let assetRoutes = null;
let documentAssetRoutes = null;
let documentExportRoutes = null;
let conversationImportRoutes = null;
let cloudAiHandoffRoutes = null;
let outboxDispatcher = null;
let jobRunner = null;
let assetInspectionRunner = null;
let objectStorageClient = null;
objectStorageClient = createS3Client(config.objectStorage);
const objectStore = createObjectStore({
  client: objectStorageClient,
  bucket: config.objectStorage.bucket
});
let identityRepository = null;
let notificationEnvelope = null;

if (config.authRoutesEnabled || config.notificationWorkerEnabled) {
  identityRepository = createIdentityRepository(database.sql);
  notificationEnvelope = createNotificationEnvelope({ keyHex: config.notificationEncryptionKey });
}

if (config.deploymentMode !== "api") {
  assetInspectionRunner = createAssetInspectionRunner({
    service: createAssetInspectionService({
      repository: createAssetInspectionRepository(database.sql),
      objectStore,
      inspector: createDecoderBackedMediaInspector(),
      instanceId: config.instanceId,
      batchSize: config.assetInspectionBatchSize,
      sampleBytes: 1024 * 1024
    }),
    pollIntervalMs: config.assetInspectionPollIntervalMs,
    log
  });
  outboxDispatcher = createOutboxDispatcher({
    repository: createOutboxRepository(database.sql),
    instanceId: config.instanceId,
    batchSize: config.outboxBatchSize,
    leaseSeconds: config.outboxLeaseSeconds,
    pollIntervalMs: config.outboxPollIntervalMs,
    maxAttempts: config.outboxMaxAttempts,
    log
  });
  const handlers = {
    "conversation.imported": createConversationArchiveVerificationHandler({
      repository: createConversationArchiveRepository(database.sql),
      objectStore
    })
  };
  if (config.notificationWorkerEnabled) {
    const transport = createSmtpTransport(config.smtp);
    notificationService = createSmtpNotificationService({
      transport,
      from: config.smtp.from,
      publicAppOrigin: config.publicAppOrigin
    });
    await notificationService.verifyConnection();
    handlers["notification.delivery_requested"] = createNotificationDeliveryHandler({
      notificationEnvelope,
      notificationService,
      identityRepository
    });
  }
  jobRunner = createJobRunner({
    repository: createJobRepository(database.sql),
    handlers,
    instanceId: config.instanceId,
    batchSize: config.jobBatchSize,
    leaseSeconds: config.jobLeaseSeconds,
    pollIntervalMs: config.jobPollIntervalMs,
    log
  });
}

if (config.authRoutesEnabled) {
  const identityService = createIdentityService({
    repository: identityRepository,
    notificationEnvelope,
    sessionTtlSeconds: config.sessionTtlSeconds,
    passwordResetMinimumResponseMs: config.passwordResetMinimumResponseMs
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
  assetRoutes = createAssetRoutes({
    identityService,
    assetService: createAssetService({
      objectStore,
      repository: createAssetRepository(database.sql),
      authorizeAsset: workspaceAssetAuthorizer(identityRepository),
      maxAssetBytes: 1024 * 1024
    }),
    deliveryService: createAssetDeliveryService({
      repository: createAssetDeliveryRepository(database.sql), objectStore
    })
  });
  documentAssetRoutes = createDocumentAssetRoutes({
    identityService,
    service: createAssetReferenceReconciliationService({
      repository: createAssetReferenceReconciliationRepository(database.sql)
    })
  });
  documentExportRoutes = createDocumentExportRoutes({
    identityService,
    service: createDocumentExportService({
      repository: createDocumentExportRepository(database.sql), objectStore
    })
  });
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
  const handoffRepository = createCloudAiHandoffRepository(database.sql);
  cloudAiHandoffRoutes = createCloudAiHandoffRoutes({
    identityService,
    service: createCloudAiHandoffService({ repository: handoffRepository }),
    repository: handoffRepository,
    idempotencyService: createIdempotencyService({
      repository: createIdempotencyRepository(database.sql),
      secret: config.idempotencySecret
    })
  });
}

const corsOrigins = [...config.corsOrigins];
if (config.publicAppOrigin && !corsOrigins.includes(config.publicAppOrigin)) {
  corsOrigins.push(config.publicAppOrigin);
}
const { app, runtimeState } = createApp({
  authRoutes,
  assetRoutes,
  documentAssetRoutes,
  documentExportRoutes,
  conversationImportRoutes,
  cloudAiHandoffRoutes,
  corsOrigins,
  aiTrainingDefault: config.aiTrainingDefault,
  log,
  readinessCheck: database.checkHealth
});

const server = Bun.serve({
  port: config.port,
  hostname: config.hostname,
  fetch: app.fetch
});
outboxDispatcher?.start();
jobRunner?.start();
assetInspectionRunner?.start();

log({
  level: "info",
  event: "server_started",
  instanceId: config.instanceId,
  deploymentMode: config.deploymentMode,
  hostname: config.hostname,
  port: config.port,
  jobBackend: config.jobBackend
});

let shutdownStarted = false;

async function shutdown(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  runtimeState.beginShutdown();

  log({
    level: "info",
    event: "server_shutdown_started",
    instanceId: config.instanceId,
    signal,
    graceMs: config.shutdownGraceMs
  });

  const forceTimer = setTimeout(() => server.stop(true), config.shutdownGraceMs);
  forceTimer.unref();
  await server.stop(false);
  clearTimeout(forceTimer);
  await outboxDispatcher?.stop();
  await jobRunner?.stop();
  await assetInspectionRunner?.stop();
  await database.close();
  objectStorageClient?.destroy();
  notificationService?.close();

  log({
    level: "info",
    event: "server_shutdown_completed",
    instanceId: config.instanceId
  });
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
