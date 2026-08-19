const DEPLOYMENT_MODES = new Set(["single", "api", "worker"]);
const JOB_BACKENDS = new Set(["postgres-outbox"]);
const NODE_ENVIRONMENTS = new Set(["development", "test", "production"]);
const LOG_LEVELS = new Set(["debug", "info", "warn", "error"]);
const LOCAL_NOTIFICATION_ENCRYPTION_KEY = "11".repeat(32);

function parsePositiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function parseNonnegativeInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a nonnegative integer`);
  }
  return parsed;
}

function parseBoolean(value, fallback, name) {
  const normalized = value === undefined || value === "" ? String(fallback) : String(value);
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be true or false`);
}

function parseOrigin(value, name) {
  try {
    const url = new URL(value);
    if (!new Set(["http:", "https:"]).has(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error();
    }
    return url.origin;
  } catch {
    throw new Error(`${name} must be an HTTP(S) origin`);
  }
}

function parseCorsOrigins(value, nodeEnv) {
  const raw = value
    ? value.split(",").map((item) => item.trim()).filter(Boolean)
    : nodeEnv === "production" ? [] : ["http://localhost:1420", "http://127.0.0.1:1420"];
  return [...new Set(raw.map((origin) => parseOrigin(origin, "CORS_ORIGINS")))];
}

function validateProduction(config, env) {
  const required = [
    "SERVER_HOST", "DATABASE_URL", "OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET",
    "OBJECT_STORAGE_ACCESS_KEY", "OBJECT_STORAGE_SECRET_KEY", "IDEMPOTENCY_SECRET", "CORS_ORIGINS"
  ];
  for (const name of required) {
    if (!env[name]) throw new Error(`${name} is required in production`);
  }
  const database = new URL(config.databaseUrl);
  if (!new Set(["postgres:", "postgresql:"]).has(database.protocol)) {
    throw new Error("DATABASE_URL must use PostgreSQL in production");
  }
  if (!database.password || database.password === "komyaku" || ["localhost", "127.0.0.1"].includes(database.hostname)) {
    throw new Error("DATABASE_URL must not use local development credentials in production");
  }
  const storage = new URL(config.objectStorage.endpoint);
  if (storage.protocol !== "https:" || ["localhost", "127.0.0.1"].includes(storage.hostname)) {
    throw new Error("OBJECT_STORAGE_ENDPOINT must be a non-local HTTPS endpoint in production");
  }
  if (config.objectStorage.accessKeyId === "komyaku" || config.objectStorage.secretAccessKey === "change-me-now") {
    throw new Error("Object storage development credentials are forbidden in production");
  }
  if (config.idempotencySecret.includes("local-development") || config.aiTrainingDefault !== "deny") {
    throw new Error("Production requires a unique idempotency secret and AI_TRAINING_DEFAULT=deny");
  }
  if (config.corsOrigins.some((origin) => !origin.startsWith("https://"))) {
    throw new Error("Production CORS origins must use HTTPS");
  }
  if ((config.authRoutesEnabled || config.notificationWorkerEnabled)
    && !config.publicAppOrigin.startsWith("https://")) {
    throw new Error("PUBLIC_APP_ORIGIN must use HTTPS in production");
  }
  if ((config.authRoutesEnabled || config.notificationWorkerEnabled)
    && !env.NOTIFICATION_ENCRYPTION_KEY) {
    throw new Error("NOTIFICATION_ENCRYPTION_KEY is required for authentication notification processing in production");
  }
}

export function loadRuntimeConfig(env = Bun.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const deploymentMode = env.DEPLOYMENT_MODE || "single";
  const jobBackend = env.JOB_BACKEND || "postgres-outbox";

  if (!NODE_ENVIRONMENTS.has(nodeEnv)) throw new Error(`Unsupported NODE_ENV: ${nodeEnv}`);

  if (!DEPLOYMENT_MODES.has(deploymentMode)) {
    throw new Error(`Unsupported DEPLOYMENT_MODE: ${deploymentMode}`);
  }
  if (!JOB_BACKENDS.has(jobBackend)) {
    throw new Error(`Unsupported JOB_BACKEND: ${jobBackend}`);
  }
  const logLevel = env.LOG_LEVEL || (nodeEnv === "production" ? "info" : "debug");
  if (!LOG_LEVELS.has(logLevel)) throw new Error(`Unsupported LOG_LEVEL: ${logLevel}`);

  const authRoutesEnabled = parseBoolean(env.AUTH_ROUTES_ENABLED, false, "AUTH_ROUTES_ENABLED");
  const notificationWorkerEnabled = parseBoolean(
    env.NOTIFICATION_WORKER_ENABLED,
    authRoutesEnabled && deploymentMode !== "api",
    "NOTIFICATION_WORKER_ENABLED"
  );
  if (deploymentMode === "api" && notificationWorkerEnabled) {
    throw new Error("NOTIFICATION_WORKER_ENABLED cannot be true in api deployment mode");
  }
  const authRateLimitSecret = env.AUTH_RATE_LIMIT_SECRET || null;
  const idempotencySecret = env.IDEMPOTENCY_SECRET || "local-development-idempotency-secret-change-this";
  const notificationEncryptionKey = env.NOTIFICATION_ENCRYPTION_KEY
    || LOCAL_NOTIFICATION_ENCRYPTION_KEY;
  const publicAppOrigin = env.PUBLIC_APP_ORIGIN ? parseOrigin(env.PUBLIC_APP_ORIGIN, "PUBLIC_APP_ORIGIN") : null;
  const smtp = env.SMTP_HOST
    ? Object.freeze({
        host: env.SMTP_HOST,
        port: parsePositiveInteger(env.SMTP_PORT, 587, "SMTP_PORT"),
        secure: parseBoolean(env.SMTP_SECURE, false, "SMTP_SECURE"),
        requireTls: parseBoolean(env.SMTP_REQUIRE_TLS, true, "SMTP_REQUIRE_TLS"),
        user: env.SMTP_USER || null,
        password: env.SMTP_PASSWORD || null,
        from: env.SMTP_FROM || null
      })
    : null;

  if (Boolean(smtp?.user) !== Boolean(smtp?.password)) {
    throw new Error("SMTP_USER and SMTP_PASSWORD must be provided together");
  }
  if (Boolean(env.OBJECT_STORAGE_ACCESS_KEY) !== Boolean(env.OBJECT_STORAGE_SECRET_KEY)) {
    throw new Error("OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY must be provided together");
  }
  if (idempotencySecret.length < 32) {
    throw new Error("IDEMPOTENCY_SECRET must contain at least 32 characters");
  }
  if (!/^[0-9a-fA-F]{64}$/.test(notificationEncryptionKey)) {
    throw new Error("NOTIFICATION_ENCRYPTION_KEY must be exactly 64 hexadecimal characters");
  }
  if (authRoutesEnabled) {
    if (!authRateLimitSecret || authRateLimitSecret.length < 32) {
      throw new Error("AUTH_RATE_LIMIT_SECRET must contain at least 32 characters when authentication routes are enabled");
    }
    if (!publicAppOrigin) throw new Error("PUBLIC_APP_ORIGIN is required when authentication routes are enabled");
  }
  if (notificationWorkerEnabled) {
    if (!publicAppOrigin) throw new Error("PUBLIC_APP_ORIGIN is required when the notification worker is enabled");
    if (!smtp?.from) throw new Error("Complete SMTP configuration is required when the notification worker is enabled");
  }

  const config = {
    nodeEnv,
    logLevel,
    serviceName: env.SERVICE_NAME || "komyaku-server",
    hostname: env.SERVER_HOST || "127.0.0.1",
    port: parsePositiveInteger(env.SERVER_PORT, 3000, "SERVER_PORT"),
    deploymentMode,
    instanceId: env.INSTANCE_ID || crypto.randomUUID(),
    shutdownGraceMs: parsePositiveInteger(
      env.SHUTDOWN_GRACE_MS,
      10_000,
      "SHUTDOWN_GRACE_MS"
    ),
    databasePoolMax: parsePositiveInteger(
      env.DATABASE_POOL_MAX,
      10,
      "DATABASE_POOL_MAX"
    ),
    databaseUrl: env.DATABASE_URL || "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku",
    sessionTtlSeconds: parsePositiveInteger(
      env.SESSION_TTL_SECONDS,
      30 * 24 * 60 * 60,
      "SESSION_TTL_SECONDS"
    ),
    passwordResetMinimumResponseMs: parseNonnegativeInteger(
      env.PASSWORD_RESET_MIN_RESPONSE_MS,
      250,
      "PASSWORD_RESET_MIN_RESPONSE_MS"
    ),
    authRoutesEnabled,
    notificationWorkerEnabled,
    authRateLimitSecret,
    idempotencySecret,
    notificationEncryptionKey,
    publicAppOrigin,
    trustedProxyHops: parseNonnegativeInteger(env.TRUSTED_PROXY_HOPS, 0, "TRUSTED_PROXY_HOPS"),
    smtp,
    jobBackend,
    outboxBatchSize: parsePositiveInteger(env.OUTBOX_BATCH_SIZE, 25, "OUTBOX_BATCH_SIZE"),
    outboxLeaseSeconds: parsePositiveInteger(env.OUTBOX_LEASE_SECONDS, 30, "OUTBOX_LEASE_SECONDS"),
    outboxPollIntervalMs: parsePositiveInteger(
      env.OUTBOX_POLL_INTERVAL_MS,
      1_000,
      "OUTBOX_POLL_INTERVAL_MS"
    ),
    outboxMaxAttempts: parsePositiveInteger(env.OUTBOX_MAX_ATTEMPTS, 10, "OUTBOX_MAX_ATTEMPTS"),
    jobBatchSize: parsePositiveInteger(env.JOB_BATCH_SIZE, 10, "JOB_BATCH_SIZE"),
    jobLeaseSeconds: parsePositiveInteger(env.JOB_LEASE_SECONDS, 60, "JOB_LEASE_SECONDS"),
    jobPollIntervalMs: parsePositiveInteger(env.JOB_POLL_INTERVAL_MS, 1_000, "JOB_POLL_INTERVAL_MS"),
    objectStorage: Object.freeze({
      endpoint: env.OBJECT_STORAGE_ENDPOINT || "http://127.0.0.1:9000",
      region: env.OBJECT_STORAGE_REGION || "us-east-1",
      bucket: env.OBJECT_STORAGE_BUCKET || "komyaku-local",
      accessKeyId: env.OBJECT_STORAGE_ACCESS_KEY || "komyaku",
      secretAccessKey: env.OBJECT_STORAGE_SECRET_KEY || "change-me-now",
      forcePathStyle: true
    }),
    aiTrainingDefault: env.AI_TRAINING_DEFAULT || "deny",
    corsOrigins: parseCorsOrigins(env.CORS_ORIGINS, nodeEnv)
  };
  if (!new Set(["deny", "allow"]).has(config.aiTrainingDefault)) {
    throw new Error("AI_TRAINING_DEFAULT must be deny or allow");
  }
  if (nodeEnv === "production") validateProduction(config, env);
  return Object.freeze(config);
}
