import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  PASSWORD_POLICY,
  assertAcceptablePassword,
  createPasswordHasher
} from "../security/passwords.js";
import {
  createOpaqueToken,
  createSessionToken,
  hashOpaqueToken,
  hashSessionToken
} from "../security/session-tokens.js";

const localeSchema = z.enum(["ja", "en", "zh-Hans"]);
const emailSchema = z.string().trim().max(320).email();
const passwordInputSchema = z.string();

const registerSchema = z.object({
  email: emailSchema,
  password: passwordInputSchema,
  displayName: z.string().trim().min(1).max(200),
  interfaceLocale: localeSchema.default("ja"),
  timezone: z.string().min(1).max(100).default("UTC"),
  workspaceName: z.string().trim().min(1).max(300).optional()
});

const loginSchema = z.object({
  email: emailSchema,
  password: passwordInputSchema
});

const DUMMY_PASSWORD_HASH = "$argon2id$v=19$m=19456,t=2,p=1$3QDS7JElesxXhcx9ETifB7xnO/oR36wVu33WILmK1/M$KssWndOc1lpJr3nT2r7S4gP8q693bkR/kFbw6ocXK6A";

export class IdentityError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "IdentityError";
    this.code = code;
  }
}

function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

function sessionExpiry(now, ttlSeconds) {
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}

function tokenExpiry(now, ttlSeconds) {
  return new Date(now.getTime() + ttlSeconds * 1000).toISOString();
}

const noDelivery = Object.freeze({
  async sendEmailVerification() { return { accepted: false }; },
  async sendPasswordReset() { return { accepted: false }; }
});

export function createIdentityService({
  repository,
  passwordHasher = createPasswordHasher(),
  notificationService = noDelivery,
  sessionTtlSeconds = 30 * 24 * 60 * 60,
  emailVerificationTtlSeconds = 24 * 60 * 60,
  passwordResetTtlSeconds = 60 * 60,
  exposeDevelopmentTokens = false,
  now = () => new Date()
}) {
  if (!repository) throw new Error("Identity repository is required");
  if (!Number.isSafeInteger(sessionTtlSeconds) || sessionTtlSeconds <= 0) {
    throw new Error("Session TTL must be a positive integer");
  }
  if (!Number.isSafeInteger(emailVerificationTtlSeconds) || emailVerificationTtlSeconds <= 0) {
    throw new Error("Email verification TTL must be a positive integer");
  }
  if (!Number.isSafeInteger(passwordResetTtlSeconds) || passwordResetTtlSeconds <= 0) {
    throw new Error("Password reset TTL must be a positive integer");
  }

  async function issueSession(userId) {
    const token = createSessionToken();
    return {
      token,
      record: {
        id: uuidv7(),
        userId,
        tokenHash: await hashSessionToken(token),
        expiresAt: sessionExpiry(now(), sessionTtlSeconds)
      }
    };
  }

  async function issueOneTimeToken(userId, ttlSeconds) {
    const token = createOpaqueToken();
    return {
      token,
      record: {
        id: uuidv7(),
        userId,
        tokenHash: await hashOpaqueToken(token),
        expiresAt: tokenExpiry(now(), ttlSeconds)
      }
    };
  }

  async function deliver(method, payload) {
    try {
      const result = await notificationService[method]?.(payload);
      return result?.accepted === true ? "accepted" : "pending";
    } catch {
      return "pending";
    }
  }

  return Object.freeze({
    async register(input) {
      const parsed = registerSchema.parse(input);
      assertAcceptablePassword(parsed.password);
      const userId = uuidv7();
      const workspaceId = uuidv7();
      const passwordHash = await passwordHasher.hash(parsed.password);
      const session = await issueSession(userId);
      const verification = await issueOneTimeToken(userId, emailVerificationTtlSeconds);

      try {
        await repository.createPersonalAccount({
          user: {
            id: userId,
            email: normalizeEmail(parsed.email),
            passwordHash,
            displayName: parsed.displayName,
            interfaceLocale: parsed.interfaceLocale,
            timezone: parsed.timezone
          },
          workspace: {
            id: workspaceId,
            name: parsed.workspaceName ?? parsed.displayName
          },
          session: session.record,
          verificationToken: verification.record
        });
      } catch (error) {
        if (error?.errno === "23505" || error?.code === "23505") {
          throw new IdentityError("email_unavailable", "Email address is unavailable");
        }
        throw error;
      }

      const verificationDelivery = await deliver("sendEmailVerification", {
        userId,
        email: normalizeEmail(parsed.email),
        interfaceLocale: parsed.interfaceLocale,
        token: verification.token,
        expiresAt: verification.record.expiresAt
      });

      return {
        user: {
          id: userId,
          email: normalizeEmail(parsed.email),
          displayName: parsed.displayName,
          interfaceLocale: parsed.interfaceLocale,
          timezone: parsed.timezone
        },
        workspace: { id: workspaceId, name: parsed.workspaceName ?? parsed.displayName, role: "owner" },
        session: { token: session.token, expiresAt: session.record.expiresAt },
        verification: {
          delivery: verificationDelivery,
          expiresAt: verification.record.expiresAt,
          ...(exposeDevelopmentTokens ? { token: verification.token } : {})
        }
      };
    },

    async login(input) {
      const parsed = loginSchema.parse(input);
      if (Array.from(parsed.password).length > PASSWORD_POLICY.maximumCodePoints) {
        throw new IdentityError("invalid_credentials", "Email or password is incorrect");
      }
      const identity = await repository.findPasswordIdentityByEmail(normalizeEmail(parsed.email));
      const passwordMatches = await passwordHasher.verify(
        parsed.password,
        identity?.passwordHash ?? DUMMY_PASSWORD_HASH
      );
      if (!identity || !identity.passwordHash || !passwordMatches) {
        throw new IdentityError("invalid_credentials", "Email or password is incorrect");
      }

      const session = await issueSession(identity.userId);
      await repository.createSession(session.record);
      return {
        user: {
          id: identity.userId,
          email: identity.email,
          displayName: identity.displayName,
          interfaceLocale: identity.interfaceLocale,
          timezone: identity.timezone
        },
        session: { token: session.token, expiresAt: session.record.expiresAt }
      };
    },

    async authenticateToken(token) {
      let tokenHash;
      try {
        tokenHash = await hashSessionToken(token);
      } catch {
        return null;
      }
      return repository.findActiveSession(tokenHash);
    },

    async requestEmailVerification({ userId }) {
      const identity = await repository.findIdentityById(userId);
      if (!identity) throw new IdentityError("identity_not_found", "Identity is unavailable");
      const verification = await issueOneTimeToken(userId, emailVerificationTtlSeconds);
      await repository.replaceEmailVerificationToken(verification.record);
      const delivery = await deliver("sendEmailVerification", {
        userId,
        email: identity.email,
        interfaceLocale: localeSchema.parse(identity.interfaceLocale),
        token: verification.token,
        expiresAt: verification.record.expiresAt
      });
      return {
        delivery,
        expiresAt: verification.record.expiresAt,
        ...(exposeDevelopmentTokens ? { token: verification.token } : {})
      };
    },

    async verifyEmail(token) {
      let tokenHash;
      try {
        tokenHash = await hashOpaqueToken(token);
      } catch {
        throw new IdentityError("invalid_or_expired_token", "Verification token is invalid or expired");
      }
      const result = await repository.consumeEmailVerificationToken(tokenHash);
      if (!result) {
        throw new IdentityError("invalid_or_expired_token", "Verification token is invalid or expired");
      }
      return result;
    },

    async requestPasswordReset(input) {
      const email = normalizeEmail(emailSchema.parse(input.email));
      const identity = await repository.findPasswordIdentityByEmail(email);
      if (!identity?.passwordHash) return { accepted: true };
      const reset = await issueOneTimeToken(identity.userId, passwordResetTtlSeconds);
      await repository.replacePasswordResetToken(reset.record);
      await deliver("sendPasswordReset", {
        userId: identity.userId,
        email: identity.email,
        interfaceLocale: identity.interfaceLocale,
        token: reset.token,
        expiresAt: reset.record.expiresAt
      });
      return {
        accepted: true,
        ...(exposeDevelopmentTokens ? { token: reset.token } : {})
      };
    },

    async resetPassword({ token, password }) {
      assertAcceptablePassword(password);
      let tokenHash;
      try {
        tokenHash = await hashOpaqueToken(token);
      } catch {
        throw new IdentityError("invalid_or_expired_token", "Reset token is invalid or expired");
      }
      const passwordHash = await passwordHasher.hash(password);
      const result = await repository.resetPasswordWithToken({ tokenHash, passwordHash });
      if (!result) {
        throw new IdentityError("invalid_or_expired_token", "Reset token is invalid or expired");
      }
      return result;
    },

    async logout({ sessionId, userId }) {
      return repository.revokeSession({ sessionId, userId });
    },

    async logoutAll(userId) {
      return repository.revokeAllSessions(userId);
    }
  });
}
