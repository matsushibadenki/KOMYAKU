import { readdir } from "node:fs/promises";
import path from "node:path";

const MIGRATION_PATTERN = /^(\d{4,})_([a-z0-9_]+)\.sql$/;

export function parseMigrationFilename(filename) {
  const match = MIGRATION_PATTERN.exec(filename);
  if (!match) throw new Error(`Invalid migration filename: ${filename}`);
  return { filename, order: Number(match[1]), version: filename.slice(0, -4) };
}

export async function discoverMigrations(migrationsDirectory) {
  const filenames = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql"));
  const migrations = filenames.map(parseMigrationFilename).sort((left, right) => left.order - right.order);

  const orders = new Set();
  for (const migration of migrations) {
    if (orders.has(migration.order)) throw new Error(`Duplicate migration order: ${migration.order}`);
    orders.add(migration.order);
    migration.absolutePath = path.join(migrationsDirectory, migration.filename);
  }
  return migrations;
}

export function createPostgresMigrationStore(sql) {
  const advisoryLockId = 4_944_679_658;
  return Object.freeze({
    async acquireLock() {
      await sql`SELECT pg_advisory_lock(${advisoryLockId})`;
    },
    async releaseLock() {
      await sql`SELECT pg_advisory_unlock(${advisoryLockId})`;
    },
    async listAppliedVersions() {
      const [table] = await sql`SELECT to_regclass('public.schema_migrations') AS name`;
      if (!table?.name) return [];
      const rows = await sql`SELECT version FROM schema_migrations ORDER BY version`;
      return rows.map((row) => row.version);
    },
    async executeMigration(migration) {
      const sqlText = await Bun.file(migration.absolutePath).text();
      await sql.unsafe(sqlText);
    }
  });
}

export async function runMigrations({ store, migrations }) {
  await store.acquireLock();
  try {
    const applied = new Set(await store.listAppliedVersions());
    const executed = [];
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      await store.executeMigration(migration);
      executed.push(migration.version);
      applied.add(migration.version);
    }
    return executed;
  } finally {
    await store.releaseLock();
  }
}

