import { describe, expect, test } from "bun:test";
import { IdentityError, createIdentityService } from "../src/services/identity-service.js";

function fixture({ identity = null } = {}) {
  const events = [];
  const repository = {
    async createPersonalAccount(value) { events.push(["account", value]); },
    async findPasswordIdentityByEmail(email) {
      events.push(["lookup", email]);
      return identity;
    },
    async findIdentityById(userId) { events.push(["findIdentity", userId]); return identity; },
    async createSession(value) { events.push(["session", value]); },
    async replaceEmailVerificationToken(value) { events.push(["replaceVerification", value]); },
    async consumeEmailVerificationToken(value) { events.push(["verifyEmail", value]); return { userId: identity?.userId }; },
    async replacePasswordResetToken(value) { events.push(["replaceReset", value]); },
    async resetPasswordWithToken(value) { events.push(["resetPassword", value]); return { userId: identity?.userId }; },
    async findActiveSession(value) { events.push(["authenticate", value]); return null; },
    async revokeSession(value) { events.push(["logout", value]); return true; },
    async revokeAllSessions(value) { events.push(["logoutAll", value]); return 2; }
  };
  const passwordHasher = {
    async hash(password) { events.push(["hash", password]); return "password-hash"; },
    async verify(password, hash) {
      events.push(["verify", { password, hash }]);
      return password === "correct horse battery staple" && hash === "stored-hash";
    }
  };
  return {
    events,
    service: createIdentityService({
      repository,
      passwordHasher,
      sessionTtlSeconds: 60,
      now: () => new Date("2026-08-16T00:00:00.000Z")
    })
  };
}

describe("identity application service", () => {
  test("creates a user, owner membership, workspace, and hashed session as one repository operation", async () => {
    const { events, service } = fixture();
    const result = await service.register({
      email: "  USER@Example.COM ",
      password: "correct horse battery staple",
      displayName: "稿脈 User",
      interfaceLocale: "ja",
      timezone: "Asia/Tokyo"
    });

    expect(result.user.email).toBe("user@example.com");
    expect(result.workspace.role).toBe("owner");
    expect(result.session.token).toHaveLength(43);
    expect(result.session.expiresAt).toBe("2026-08-16T00:01:00.000Z");
    expect(events.map(([name]) => name)).toEqual(["hash", "account"]);
    expect(events[1][1].session.tokenHash).toHaveLength(64);
    expect(events[1][1].session).not.toHaveProperty("token");
  });

  test("returns one generic error and still verifies a dummy hash for an unknown email", async () => {
    const { events, service } = fixture();
    const operation = service.login({
      email: "missing@example.com",
      password: "correct horse battery staple"
    });

    await expect(operation).rejects.toMatchObject({ code: "invalid_credentials" });
    expect(events.map(([name]) => name)).toEqual(["lookup", "verify"]);
    expect(events[1][1].hash.startsWith("$argon2id$")).toBe(true);
  });

  test("issues a new hashed session for valid credentials", async () => {
    const { events, service } = fixture({
      identity: {
        userId: crypto.randomUUID(),
        email: "user@example.com",
        passwordHash: "stored-hash",
        displayName: "User",
        interfaceLocale: "en",
        timezone: "UTC"
      }
    });
    const result = await service.login({
      email: "user@example.com",
      password: "correct horse battery staple"
    });

    expect(result.session.token).toHaveLength(43);
    expect(events.map(([name]) => name)).toEqual(["lookup", "verify", "session"]);
    expect(events[2][1]).not.toHaveProperty("token");
  });

  test("maps duplicate email storage errors without exposing database detail", async () => {
    const repository = {
      async createPersonalAccount() { throw Object.assign(new Error("unique users_email_unique_active_idx"), { errno: "23505" }); }
    };
    const duplicateService = createIdentityService({
      repository,
      passwordHasher: { hash: async () => "hash", verify: async () => false }
    });

    await expect(duplicateService.register({
      email: "used@example.com",
      password: "correct horse battery staple",
      displayName: "Used"
    })).rejects.toBeInstanceOf(IdentityError);
  });

  test("stores only a verification hash and exposes raw tokens only in explicit development mode", async () => {
    const events = [];
    const repository = {
      async createPersonalAccount(value) { events.push(["account", value]); }
    };
    const service = createIdentityService({
      repository,
      passwordHasher: { hash: async () => "hash", verify: async () => false },
      notificationService: {
        async sendEmailVerification(value) { events.push(["delivery", value]); return { accepted: true }; }
      },
      exposeDevelopmentTokens: true
    });
    const result = await service.register({
      email: "verify@example.com",
      password: "correct horse battery staple",
      displayName: "Verify"
    });

    expect(result.verification.delivery).toBe("accepted");
    expect(result.verification.token).toHaveLength(43);
    expect(events[0][1].verificationToken.tokenHash).toHaveLength(64);
    expect(events[0][1].verificationToken).not.toHaveProperty("token");
    expect(events[1][1].token).toBe(result.verification.token);
  });

  test("uses single-use hashes for email verification and password reset", async () => {
    const identity = {
      userId: crypto.randomUUID(),
      email: "user@example.com",
      passwordHash: "stored-hash",
      displayName: "User",
      interfaceLocale: "en",
      timezone: "UTC"
    };
    const events = [];
    const service = createIdentityService({
      repository: {
        async findPasswordIdentityByEmail(email) { events.push(["lookup", email]); return identity; },
        async findIdentityById(userId) { events.push(["findIdentity", userId]); return identity; },
        async replaceEmailVerificationToken(value) { events.push(["replaceVerification", value]); },
        async consumeEmailVerificationToken(value) { events.push(["verifyEmail", value]); return { userId: identity.userId }; },
        async replacePasswordResetToken(value) { events.push(["replaceReset", value]); },
        async resetPasswordWithToken(value) { events.push(["resetPassword", value]); return { userId: identity.userId }; }
      },
      passwordHasher: {
        async hash(password) { events.push(["hash", password]); return "new-hash"; },
        async verify() { return true; }
      },
      exposeDevelopmentTokens: true
    });
    const verification = await service.requestEmailVerification({ userId: identity.userId });
    expect(verification.token).toHaveLength(43);
    expect(await service.verifyEmail(verification.token)).toEqual({ userId: identity.userId });

    const reset = await service.requestPasswordReset({ email: identity.email });
    expect(reset).toMatchObject({ accepted: true });
    expect(reset.token).toHaveLength(43);
    expect(await service.resetPassword({
      token: reset.token,
      password: "a completely new safe password"
    })).toEqual({ userId: identity.userId });
    expect(events.find(([name]) => name === "resetPassword")[1]).toMatchObject({ passwordHash: "new-hash" });
  });

  test("password reset requests do not disclose unknown accounts", async () => {
    const { events, service } = fixture();
    expect(await service.requestPasswordReset({ email: "missing@example.com" })).toEqual({ accepted: true });
    expect(events.map(([name]) => name)).toEqual(["lookup"]);
  });
});
