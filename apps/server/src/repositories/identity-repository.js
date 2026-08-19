import { v7 as uuidv7 } from "uuid";

function mapIdentity(row) {
  if (!row) return null;
  return {
    userId: row.user_id,
    email: row.email,
    passwordHash: row.password_hash,
    displayName: row.display_name,
    interfaceLocale: row.interface_locale,
    timezone: row.timezone
  };
}

async function insertNotificationEvent(tx, event) {
  if (!event) return;
  await tx`
    INSERT INTO outbox_events
      (id, aggregate_type, aggregate_id, event_type, schema_version,
       partition_key, idempotency_key, payload)
    VALUES
      (${event.id}, 'user', ${event.aggregateId}, 'notification.delivery_requested', 1,
       ${event.partitionKey}, ${event.idempotencyKey},
       ${JSON.stringify(event.payload)}::text::jsonb)
  `;
}

export function createIdentityRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  return Object.freeze({
    async createPersonalAccount({ user, workspace, session, verificationToken, notificationEvent }) {
      await sql.begin(async (tx) => {
        await tx`
          INSERT INTO users
            (id, email, password_hash, display_name, interface_locale, timezone)
          VALUES
            (${user.id}, ${user.email}, ${user.passwordHash}, ${user.displayName},
             ${user.interfaceLocale}, ${user.timezone})
        `;
        await tx`
          INSERT INTO workspaces (id, name, workspace_kind, created_by)
          VALUES (${workspace.id}, ${workspace.name}, 'personal', ${user.id})
        `;
        await tx`
          INSERT INTO workspace_members (workspace_id, user_id, member_role)
          VALUES (${workspace.id}, ${user.id}, 'owner')
        `;
        await tx`
          INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_seen_at)
          VALUES (${session.id}, ${user.id}, decode(${session.tokenHash}, 'hex'), ${session.expiresAt}, now())
        `;
        if (verificationToken) {
          await tx`
            INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
            VALUES (${verificationToken.id}, ${user.id}, decode(${verificationToken.tokenHash}, 'hex'),
                    ${verificationToken.expiresAt})
          `;
        }
        await insertNotificationEvent(tx, notificationEvent);
        await tx`
          INSERT INTO outbox_events
            (id, aggregate_type, aggregate_id, event_type, schema_version, partition_key, idempotency_key, payload)
          VALUES
            (${uuidv7()}, 'user', ${user.id}, 'identity.personal_account_created', 1,
             ${workspace.id}, ${`personal-account:${user.id}`},
             ${JSON.stringify({ userId: user.id, workspaceId: workspace.id })}::text::jsonb)
        `;
      });
    },

    async findPasswordIdentityByEmail(email) {
      const rows = await sql`
        SELECT id AS user_id, email, password_hash, display_name, interface_locale, timezone
        FROM users
        WHERE lower(email) = ${email} AND deleted_at IS NULL
        LIMIT 1
      `;
      return mapIdentity(rows[0]);
    },

    async findIdentityById(userId) {
      const rows = await sql`
        SELECT id AS user_id, email, password_hash, display_name, interface_locale, timezone
        FROM users
        WHERE id = ${userId} AND deleted_at IS NULL
        LIMIT 1
      `;
      return mapIdentity(rows[0]);
    },

    async replaceEmailVerificationToken(token, notificationEvent = null) {
      await sql.begin(async (tx) => {
        await tx`
          UPDATE email_verification_tokens
          SET used_at = COALESCE(used_at, now())
          WHERE user_id = ${token.userId} AND used_at IS NULL
        `;
        await tx`
          INSERT INTO email_verification_tokens (id, user_id, token_hash, expires_at)
          VALUES (${token.id}, ${token.userId}, decode(${token.tokenHash}, 'hex'), ${token.expiresAt})
        `;
        await insertNotificationEvent(tx, notificationEvent);
      });
    },

    async consumeEmailVerificationToken(tokenHash) {
      return sql.begin(async (tx) => {
        const rows = await tx`
          SELECT id, user_id
          FROM email_verification_tokens
          WHERE token_hash = decode(${tokenHash}, 'hex')
            AND used_at IS NULL
            AND expires_at > now()
          LIMIT 1
          FOR UPDATE
        `;
        const token = rows[0];
        if (!token) return null;
        const users = await tx`
          UPDATE users
          SET email_verified_at = COALESCE(email_verified_at, now()), updated_at = now()
          WHERE id = ${token.user_id} AND deleted_at IS NULL
          RETURNING id
        `;
        if (users.length !== 1) return null;
        await tx`
          UPDATE email_verification_tokens
          SET used_at = COALESCE(used_at, now())
          WHERE user_id = ${token.user_id} AND used_at IS NULL
        `;
        return { userId: token.user_id };
      });
    },

    async replacePasswordResetToken(token, notificationEvent = null) {
      await sql.begin(async (tx) => {
        await tx`
          UPDATE password_reset_tokens
          SET used_at = COALESCE(used_at, now())
          WHERE user_id = ${token.userId} AND used_at IS NULL
        `;
        await tx`
          INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at)
          VALUES (${token.id}, ${token.userId}, decode(${token.tokenHash}, 'hex'), ${token.expiresAt})
        `;
        await insertNotificationEvent(tx, notificationEvent);
      });
    },

    async isOneTimeTokenActive({ kind, userId, tokenHash }) {
      const table = kind === "email_verification"
        ? "email_verification_tokens"
        : kind === "password_reset"
          ? "password_reset_tokens"
          : null;
      if (!table) return false;
      const rows = table === "email_verification_tokens"
        ? await sql`
            SELECT 1 AS active
            FROM email_verification_tokens
            WHERE user_id = ${userId}
              AND token_hash = decode(${tokenHash}, 'hex')
              AND used_at IS NULL AND expires_at > now()
            LIMIT 1
          `
        : await sql`
            SELECT 1 AS active
            FROM password_reset_tokens
            WHERE user_id = ${userId}
              AND token_hash = decode(${tokenHash}, 'hex')
              AND used_at IS NULL AND expires_at > now()
            LIMIT 1
          `;
      return rows.length === 1;
    },

    async resetPasswordWithToken({ tokenHash, passwordHash }) {
      return sql.begin(async (tx) => {
        const rows = await tx`
          SELECT id, user_id
          FROM password_reset_tokens
          WHERE token_hash = decode(${tokenHash}, 'hex')
            AND used_at IS NULL
            AND expires_at > now()
          LIMIT 1
          FOR UPDATE
        `;
        const token = rows[0];
        if (!token) return null;
        const users = await tx`
          UPDATE users
          SET password_hash = ${passwordHash}, updated_at = now()
          WHERE id = ${token.user_id} AND deleted_at IS NULL
          RETURNING id
        `;
        if (users.length !== 1) return null;
        await tx`
          UPDATE password_reset_tokens
          SET used_at = COALESCE(used_at, now())
          WHERE user_id = ${token.user_id} AND used_at IS NULL
        `;
        await tx`
          UPDATE user_sessions
          SET revoked_at = COALESCE(revoked_at, now())
          WHERE user_id = ${token.user_id} AND revoked_at IS NULL
        `;
        return { userId: token.user_id };
      });
    },

    async createSession(session) {
      await sql`
        INSERT INTO user_sessions (id, user_id, token_hash, expires_at, last_seen_at)
        VALUES (${session.id}, ${session.userId}, decode(${session.tokenHash}, 'hex'), ${session.expiresAt}, now())
      `;
    },

    async findActiveSession(tokenHash) {
      const rows = await sql`
        SELECT s.id AS session_id, s.user_id, s.expires_at, u.email, u.display_name,
               u.interface_locale, u.timezone
        FROM user_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = decode(${tokenHash}, 'hex')
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND u.deleted_at IS NULL
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      await sql`
        UPDATE user_sessions
        SET last_seen_at = now()
        WHERE id = ${row.session_id}
          AND (last_seen_at IS NULL OR last_seen_at < now() - interval '5 minutes')
      `;
      return {
        sessionId: row.session_id,
        userId: row.user_id,
        expiresAt: new Date(row.expires_at).toISOString(),
        email: row.email,
        displayName: row.display_name,
        interfaceLocale: row.interface_locale,
        timezone: row.timezone
      };
    },

    async revokeSession({ sessionId, userId }) {
      const result = await sql`
        UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE id = ${sessionId} AND user_id = ${userId} AND revoked_at IS NULL
        RETURNING id
      `;
      return result.length === 1;
    },

    async revokeAllSessions(userId) {
      const result = await sql`
        UPDATE user_sessions
        SET revoked_at = COALESCE(revoked_at, now())
        WHERE user_id = ${userId} AND revoked_at IS NULL
        RETURNING id
      `;
      return result.length;
    },

    async canImportConversations({ workspaceId, userId }) {
      const rows = await sql`
        SELECT 1 AS allowed
        FROM workspace_members wm
        JOIN users u ON u.id = wm.user_id
        WHERE wm.workspace_id = ${workspaceId}
          AND wm.user_id = ${userId}
          AND wm.revoked_at IS NULL
          AND wm.member_role IN ('owner', 'admin', 'editor')
          AND u.email_verified_at IS NOT NULL
          AND u.deleted_at IS NULL
        LIMIT 1
      `;
      return rows.length === 1;
    }
  });
}
