import { createApp } from "./app.js";
import { loadRuntimeConfig } from "./config.js";
import { createDatabase } from "./database/client.js";

const config = loadRuntimeConfig();
const database = createDatabase(config);
const { app, runtimeState } = createApp({ readinessCheck: database.checkHealth });

const server = Bun.serve({
  port: config.port,
  hostname: config.hostname,
  fetch: app.fetch
});

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
  await database.close();

  console.info(JSON.stringify({
    level: "info",
    event: "server_shutdown_completed",
    instanceId: config.instanceId
  }));
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));
