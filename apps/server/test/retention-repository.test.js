import { describe, expect, test } from "bun:test";
import { createRetentionRepository } from "../src/repositories/retention-repository.js";

function sqlFixture() {
  const queries = [];
  async function sql(strings, ...values) {
    const query = strings.join("?").replaceAll(/\s+/g, " ").trim();
    queries.push({ query, values });
    if (query.includes("count(*)::int") && query.includes("idempotency_keys")) return [{ count: 2 }];
    if (query.includes("count(*)::int") && query.includes("FROM jobs")) return [{ count: 3 }];
    if (query.includes("count(*)::int") && query.includes("operator_audit_events")) return [{ count: 4 }];
    return [];
  }
  sql.begin = async (operation) => operation(sql);
  return { sql, queries };
}

describe("retention SQL boundary", () => {
  const policy = {
    now: "2026-08-18T00:00:00.000Z",
    completedJobsBefore: "2026-05-20T00:00:00.000Z",
    auditBefore: "2019-08-20T00:00:00.000Z"
  };

  test("previews counts without mutation", async () => {
    const { sql, queries } = sqlFixture();
    const result = await createRetentionRepository(sql).preview(policy);
    expect(result).toEqual({
      expiredIdempotencyKeys: 2, completedJobs: 3, expiredOperatorAudits: 4
    });
    expect(queries.every(({ query }) => query.startsWith("SELECT"))).toBe(true);
  });

  test("deletes completed jobs only and preserves unresolved dead letters", async () => {
    const { sql, queries } = sqlFixture();
    await createRetentionRepository(sql).apply({
      ...policy, operatorId: "operator", reason: "Approved policy run"
    });
    const statements = queries.map(({ query }) => query).join("\n");
    expect(statements).toContain("DELETE FROM jobs WHERE job_status = 'completed'");
    expect(statements).not.toContain("DELETE FROM jobs WHERE job_status = 'dead_letter'");
    expect(statements).toContain("INSERT INTO operator_audit_events");
  });
});
