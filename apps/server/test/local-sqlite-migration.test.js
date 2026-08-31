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
    const migrationPaths = [
      "../../desktop/src-tauri/migrations/0001_local_foundation.sql",
      "../../desktop/src-tauri/migrations/0002_local_ai_handoffs.sql",
      "../../desktop/src-tauri/migrations/0003_local_asset_previews.sql",
      "../../desktop/src-tauri/migrations/0004_local_asset_reference_lifecycle.sql"
    ];
    for (const relativePath of migrationPaths) {
      const migration = await Bun.file(path.resolve(import.meta.dir, relativePath)).text();
      for (const statement of migration.split(";").map((value) => value.trim()).filter(Boolean)) {
        await database.unsafe(statement);
      }
    }

    const rows = await database`
      SELECT name FROM sqlite_master
      WHERE type = 'table'
      ORDER BY name
    `;

    expect(rows.map((row) => row.name)).toEqual([
      "local_ai_handoffs",
      "local_asset_previews",
      "local_conversation_edges",
      "local_conversation_imports",
      "local_conversation_messages",
      "local_conversations",
      "local_document_asset_references",
      "local_documents",
      "local_drafts",
      "local_snapshots",
      "sync_queue",
      "sync_state"
    ]);
  });
});
