import { afterAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createIdentityRepository } from "../../src/repositories/identity-repository.js";
import { createIdentityService } from "../../src/services/identity-service.js";

const integration = Bun.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration("identity PostgreSQL repository", () => {
  const marker = crypto.randomUUID();
  const email = `identity-${marker}@example.invalid`;
  const sql = new SQL(Bun.env.DATABASE_URL ?? "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku");
  let userId;
  let workspaceId;

  afterAll(async () => {
    if (userId) {
      await sql.begin(async (tx) => {
        await tx`DELETE FROM outbox_events WHERE aggregate_id = ${userId}`;
        await tx`DELETE FROM email_verification_tokens WHERE user_id = ${userId}`;
        await tx`DELETE FROM password_reset_tokens WHERE user_id = ${userId}`;
        await tx`DELETE FROM user_sessions WHERE user_id = ${userId}`;
        await tx`DELETE FROM workspace_members WHERE user_id = ${userId}`;
        await tx`DELETE FROM workspaces WHERE created_by = ${userId}`;
        await tx`DELETE FROM users WHERE id = ${userId}`;
      });
    }
    await sql.close();
  });

  test("registers an atomic personal account and enforces hashed revocable sessions", async () => {
    const repository = createIdentityRepository(sql);
    const service = createIdentityService({
      repository,
      sessionTtlSeconds: 300,
      exposeDevelopmentTokens: true
    });
    const registered = await service.register({
      email,
      password: "correct horse battery staple",
      displayName: "Identity Test",
      interfaceLocale: "en",
      timezone: "UTC"
    });
    userId = registered.user.id;
    workspaceId = registered.workspace.id;

    const accountRows = await sql`
      SELECT u.email, w.workspace_kind, wm.member_role,
             encode(s.token_hash, 'hex') AS token_hash
      FROM users u
      JOIN workspaces w ON w.created_by = u.id
      JOIN workspace_members wm ON wm.workspace_id = w.id AND wm.user_id = u.id
      JOIN user_sessions s ON s.user_id = u.id
      WHERE u.id = ${userId}
    `;
    expect(accountRows).toHaveLength(1);
    expect(accountRows[0]).toMatchObject({
      email,
      workspace_kind: "personal",
      member_role: "owner"
    });
    expect(accountRows[0].token_hash).toHaveLength(64);
    expect(accountRows[0].token_hash).not.toBe(registered.session.token);
    expect(await repository.canImportConversations({ workspaceId, userId })).toBe(false);
    expect(await service.verifyEmail(registered.verification.token)).toEqual({ userId });
    expect(await repository.canImportConversations({ workspaceId, userId })).toBe(true);

    const authenticated = await service.authenticateToken(registered.session.token);
    expect(authenticated).toMatchObject({ userId, email });

    const loggedIn = await service.login({ email, password: "correct horse battery staple" });
    expect(loggedIn.user.id).toBe(userId);
    expect(loggedIn.session.token).not.toBe(registered.session.token);

    expect(await service.logout({ sessionId: authenticated.sessionId, userId })).toBe(true);
    expect(await service.authenticateToken(registered.session.token)).toBeNull();
    expect(await service.authenticateToken(loggedIn.session.token)).toMatchObject({ userId });

    const reset = await service.requestPasswordReset({ email });
    expect(reset.token).toHaveLength(43);
    expect(await service.resetPassword({
      token: reset.token,
      password: "a new correct horse battery staple"
    })).toEqual({ userId });
    expect(await service.authenticateToken(loggedIn.session.token)).toBeNull();
    await expect(service.login({ email, password: "correct horse battery staple" })).rejects.toMatchObject({
      code: "invalid_credentials"
    });
    const relogged = await service.login({ email, password: "a new correct horse battery staple" });
    expect(relogged.user.id).toBe(userId);
    expect(await service.logoutAll(userId)).toBe(1);
  });
});
