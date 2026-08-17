function secondsBetween(later, earlier) {
  return Math.max(1, Math.ceil((later.getTime() - earlier.getTime()) / 1000));
}

export function createAuthRateLimitRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  return Object.freeze({
    async consume({ scope, keyHash, limit, windowSeconds, blockSeconds }) {
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Rate limit must be positive");
      if (!Number.isSafeInteger(windowSeconds) || windowSeconds <= 0) throw new Error("Rate limit window must be positive");
      if (!Number.isSafeInteger(blockSeconds) || blockSeconds <= 0) throw new Error("Rate limit block must be positive");

      return sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${keyHash}`}, 0))`;
        const clockRows = await tx`SELECT now() AS current_time`;
        const currentTime = new Date(clockRows[0].current_time);
        const rows = await tx`
          SELECT window_started_at, attempt_count, blocked_until
          FROM authentication_rate_limits
          WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
          FOR UPDATE
        `;
        const row = rows[0];

        if (!row) {
          await tx`
            INSERT INTO authentication_rate_limits
              (scope, key_hash, window_started_at, attempt_count, updated_at)
            VALUES (${scope}, decode(${keyHash}, 'hex'), ${currentTime.toISOString()}, 1, ${currentTime.toISOString()})
          `;
          return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
        }

        const windowStartedAt = new Date(row.window_started_at);
        const windowEndsAt = new Date(windowStartedAt.getTime() + windowSeconds * 1000);
        if (currentTime >= windowEndsAt) {
          await tx`
            UPDATE authentication_rate_limits
            SET window_started_at = ${currentTime.toISOString()}, attempt_count = 1,
                blocked_until = NULL, updated_at = ${currentTime.toISOString()}
            WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
          `;
          return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
        }

        const blockedUntil = row.blocked_until ? new Date(row.blocked_until) : null;
        if (blockedUntil && currentTime < blockedUntil) {
          await tx`
            UPDATE authentication_rate_limits
            SET updated_at = ${currentTime.toISOString()}
            WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
          `;
          return {
            allowed: false,
            remaining: 0,
            retryAfterSeconds: secondsBetween(blockedUntil, currentTime)
          };
        }

        const attemptCount = Number(row.attempt_count) + 1;
        if (attemptCount > limit) {
          const nextBlockedUntil = new Date(currentTime.getTime() + blockSeconds * 1000);
          await tx`
            UPDATE authentication_rate_limits
            SET attempt_count = ${attemptCount}, blocked_until = ${nextBlockedUntil.toISOString()},
                updated_at = ${currentTime.toISOString()}
            WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
          `;
          return { allowed: false, remaining: 0, retryAfterSeconds: blockSeconds };
        }

        await tx`
          UPDATE authentication_rate_limits
          SET attempt_count = ${attemptCount}, updated_at = ${currentTime.toISOString()}
          WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
        `;
        return { allowed: true, remaining: limit - attemptCount, retryAfterSeconds: 0 };
      });
    },

    async clear({ scope, keyHash }) {
      await sql`
        DELETE FROM authentication_rate_limits
        WHERE scope = ${scope} AND key_hash = decode(${keyHash}, 'hex')
      `;
    }
  });
}
