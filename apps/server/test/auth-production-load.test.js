import { describe, expect, test } from "bun:test";
import { runAuthProductionLoad } from "../scripts/auth-production-load.js";

describe("production-like authentication load guard", () => {
  test("requires an explicit opt-in before touching external dependencies", async () => {
    await expect(runAuthProductionLoad({ enabled: false })).rejects.toThrow(
      "AUTH_PRODUCTION_LOAD_ENABLED=1"
    );
  });

  test("refuses a normal application database", async () => {
    await expect(runAuthProductionLoad({
      enabled: true,
      databaseUrl: "postgres://user:password@127.0.0.1:5432/komyaku"
    })).rejects.toThrow("refuses any database except komyaku_stage2_load");
  });
});
