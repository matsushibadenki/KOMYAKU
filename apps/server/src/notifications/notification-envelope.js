import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";

const payloadSchema = z.object({
  kind: z.enum(["email_verification", "password_reset"]),
  userId: z.string().uuid(),
  email: z.string().email().max(320),
  interfaceLocale: z.enum(["ja", "en", "zh-Hans"]),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.string().datetime({ offset: true })
}).strict();

const ENVELOPE_VERSION = "v1";
const AAD = Buffer.from("komyaku:notification-envelope:v1", "utf8");

export class NotificationEnvelopeError extends Error {
  constructor(code) {
    super(code);
    this.name = "NotificationEnvelopeError";
    this.code = code;
  }
}

function decodeKey(keyHex) {
  if (typeof keyHex !== "string" || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error("Notification encryption key must be exactly 32 bytes encoded as 64 hexadecimal characters");
  }
  return Buffer.from(keyHex, "hex");
}

export function createNotificationEnvelope({ keyHex }) {
  const key = decodeKey(keyHex);

  return Object.freeze({
    seal(input) {
      const payload = payloadSchema.parse(input);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(AAD);
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(payload), "utf8"),
        cipher.final()
      ]);
      const tag = cipher.getAuthTag();
      return [ENVELOPE_VERSION, iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
    },

    open(envelope) {
      try {
        if (typeof envelope !== "string" || envelope.length > 4096) throw new Error();
        const [version, ivEncoded, tagEncoded, ciphertextEncoded, extra] = envelope.split(".");
        if (version !== ENVELOPE_VERSION || extra !== undefined) throw new Error();
        const iv = Buffer.from(ivEncoded, "base64url");
        const tag = Buffer.from(tagEncoded, "base64url");
        const ciphertext = Buffer.from(ciphertextEncoded, "base64url");
        if (iv.length !== 12 || tag.length !== 16 || ciphertext.length === 0) throw new Error();
        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAAD(AAD);
        decipher.setAuthTag(tag);
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
        return payloadSchema.parse(JSON.parse(plaintext));
      } catch {
        throw new NotificationEnvelopeError("notification_envelope_invalid");
      }
    }
  });
}
