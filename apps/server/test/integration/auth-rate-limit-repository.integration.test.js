import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createAuthRateLimitRepository } from "../../src/repositories/auth-rate-limit-repository.js";

const integration = Bun.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration("authentication rate limit PostgreSQL repository", () => {
  const sql = new SQL(Bun.env.DATABASE_URL ?? "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku");
  const scope = `integration:${crypto.randomUUID()}`;
  const keyHash = "a".repeat(64);

  afterAll(async () => {
    await sql`DELETE FROM authentication_rate_limits WHERE scope = ${scope}`;
    await sql.close();
  });

  test("serializes concurrent attempts and blocks after the shared limit", async () => {
    const repository = createAuthRateLimitRepository(sql);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => repository.consume({
      scope,
      keyHash,
      limit: 5,
      windowSeconds: 900,
      blockSeconds: 900
    })));

    expect(attempts.filter((attempt) => attempt.allowed)).toHaveLength(5);
    expect(attempts.filter((attempt) => !attempt.allowed)).toHaveLength(3);
    expect(attempts.filter((attempt) => !attempt.allowed).every((attempt) => attempt.retryAfterSeconds > 0)).toBe(true);

    const rows = await sql`
      SELECT attempt_count, blocked_until IS NOT NULL AS blocked
      FROM authentication_rate_limits
      WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
    `;
    expect(rows[0]).toMatchObject({ attempt_count: 6, blocked: true });
  });
});
