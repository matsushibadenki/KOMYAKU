const DEPLOYMENT_MODES = new Set(["single", "api", "worker"]);
const JOB_BACKENDS = new Set(["postgres-outbox"]);

function parsePositiveInteger(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

export function loadRuntimeConfig(env = Bun.env) {
  const deploymentMode = env.DEPLOYMENT_MODE || "single";
  const jobBackend = env.JOB_BACKEND || "postgres-outbox";

  if (!DEPLOYMENT_MODES.has(deploymentMode)) {
    throw new Error(`Unsupported DEPLOYMENT_MODE: ${deploymentMode}`);
  }
  if (!JOB_BACKENDS.has(jobBackend)) {
    throw new Error(`Unsupported JOB_BACKEND: ${jobBackend}`);
  }

  return Object.freeze({
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
    authRateLimitSecret: env.AUTH_RATE_LIMIT_SECRET || null,
    jobBackend
  });
}
