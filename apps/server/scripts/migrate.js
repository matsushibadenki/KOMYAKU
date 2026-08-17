import path from "node:path";
import { loadRuntimeConfig } from "../src/config.js";
import { createDatabase } from "../src/database/client.js";
import {
  createPostgresMigrationStore,
  discoverMigrations,
  runMigrations
} from "../src/database/migration-runner.js";

const config = loadRuntimeConfig();
// Migration files contain explicit transactions and must stay on one connection.
const database = createDatabase({ ...config, databasePoolMax: 1 });
const migrationsDirectory = path.resolve(import.meta.dir, "../../../database/migrations");

try {
  const migrations = await discoverMigrations(migrationsDirectory);
  const executed = await runMigrations({
    store: createPostgresMigrationStore(database.sql),
    migrations
  });
  console.info(JSON.stringify({
    level: "info",
    event: "database_migrations_completed",
    executed
  }));
} finally {
  await database.close();
}
