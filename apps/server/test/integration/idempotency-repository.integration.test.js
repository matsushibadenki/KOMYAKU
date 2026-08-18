import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createIdempotencyRepository } from "../../src/repositories/idempotency-repository.js";

const integration = Bun.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration("mutation idempotency PostgreSQL repository", () => {
  const sql = new SQL(Bun.env.DATABASE_URL ?? "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku");
  const scope = `integration:${crypto.randomUUID()}`;
  const keyHash = "a".repeat(64);
  const requestHash = "b".repeat(64);

  afterAll(async () => {
    await sql`DELETE FROM idempotency_keys WHERE scope = ${scope}`;
    await sql.close();
  });

  test("allows one concurrent owner and replays its completed reference", async () => {
    const repository = createIdempotencyRepository(sql);
    const input = {
      id: crypto.randomUUID(), scope, keyHash, requestHash,
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    };
    const attempts = await Promise.all([
      repository.acquire(input),
      repository.acquire({ ...input, id: crypto.randomUUID() })
    ]);
    expect(attempts.filter((attempt) => attempt.acquired)).toHaveLength(1);
    await repository.complete({
      scope, keyHash, requestHash, responseStatus: 201, responseReference: "resource-id"
    });
    const replay = await repository.acquire({ ...input, id: crypto.randomUUID() });
    expect(replay).toMatchObject({
      acquired: false,
      record: { status: "completed", responseStatus: 201, responseReference: "resource-id" }
    });
  });
});
