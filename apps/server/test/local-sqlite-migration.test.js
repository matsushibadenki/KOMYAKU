import { afterEach, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import path from "node:path";

let database;

afterEach(async () => {
  if (database) await database.close();
  database = undefined;
});

describe("Tauri local SQLite migration", () => {
  test("creates the local-first tables in a clean database", async () => {
    database = new SQL(":memory:");
    const migrationPath = path.resolve(
      import.meta.dir,
      "../../desktop/src-tauri/migrations/0001_local_foundation.sql"
    );
    const migration = await Bun.file(migrationPath).text();

    for (const statement of migration.split(";").map((value) => value.trim()).filter(Boolean)) {
      await database.unsafe(statement);
    }

    const rows = await database`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `;

    expect(rows.map((row) => row.name)).toEqual([
      "local_conversation_imports",
      "local_documents",
      "local_drafts",
      "local_snapshots",
      "sync_queue",
      "sync_state"
    ]);
  });
});
