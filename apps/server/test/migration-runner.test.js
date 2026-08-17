import { describe, expect, test } from "bun:test";
import {
  parseMigrationFilename,
  runMigrations
} from "../src/database/migration-runner.js";

describe("migration runner", () => {
  test("parses immutable ordered migration names", () => {
    expect(parseMigrationFilename("0002_distributed_runtime.sql")).toEqual({
      filename: "0002_distributed_runtime.sql",
      order: 2,
      version: "0002_distributed_runtime"
    });
    expect(() => parseMigrationFilename("latest.sql")).toThrow("Invalid migration filename");
  });

  test("executes only unapplied migrations while holding the lock", async () => {
    const events = [];
    const store = {
      acquireLock: async () => events.push("lock"),
      releaseLock: async () => events.push("unlock"),
      listAppliedVersions: async () => ["0001_foundation"],
      executeMigration: async (migration) => events.push(migration.version)
    };

    const executed = await runMigrations({
      store,
      migrations: [
        { version: "0001_foundation" },
        { version: "0002_distributed_runtime" }
      ]
    });

    expect(executed).toEqual(["0002_distributed_runtime"]);
    expect(events).toEqual(["lock", "0002_distributed_runtime", "unlock"]);
  });
});
