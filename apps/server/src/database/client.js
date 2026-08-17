import { SQL } from "bun";

export function createDatabase({ databaseUrl, databasePoolMax }) {
  const sql = new SQL({
    url: databaseUrl,
    max: databasePoolMax,
    connectionTimeout: 5,
    idleTimeout: 30
  });

  return Object.freeze({
    sql,
    async checkHealth() {
      const rows = await sql`SELECT 1 AS healthy`;
      return rows[0]?.healthy === 1;
    },
    async close() {
      await sql.close({ timeout: 5 });
    }
  });
}

