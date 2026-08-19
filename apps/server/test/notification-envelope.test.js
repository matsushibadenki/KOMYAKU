import { describe, expect, test } from "bun:test";
import {
  NotificationEnvelopeError,
  createNotificationEnvelope
} from "../src/notifications/notification-envelope.js";

const keyHex = "11".repeat(32);
const payload = Object.freeze({
  kind: "email_verification",
  userId: crypto.randomUUID(),
  email: "writer@example.com",
  interfaceLocale: "ja",
  token: "a".repeat(43),
  expiresAt: "2026-08-20T00:00:00.000Z"
});

describe("notification envelope", () => {
  test("encrypts the complete delivery payload and restores it", () => {
    const envelope = createNotificationEnvelope({ keyHex });
    const sealed = envelope.seal(payload);

    expect(sealed.startsWith("v1.")).toBe(true);
    expect(sealed).not.toContain(payload.email);
    expect(sealed).not.toContain(payload.token);
    expect(envelope.open(sealed)).toEqual(payload);
  });

  test("uses a fresh nonce and rejects tampering or the wrong key", () => {
    const envelope = createNotificationEnvelope({ keyHex });
    const first = envelope.seal(payload);
    const second = envelope.seal(payload);
    expect(first).not.toBe(second);

    const tampered = `${first.slice(0, -1)}${first.endsWith("a") ? "b" : "a"}`;
    expect(() => envelope.open(tampered)).toThrow(NotificationEnvelopeError);
    expect(() => createNotificationEnvelope({ keyHex: "22".repeat(32) }).open(first))
      .toThrow(NotificationEnvelopeError);
  });

  test("requires an exact 256-bit hexadecimal key", () => {
    expect(() => createNotificationEnvelope({ keyHex: "short" })).toThrow(
      "exactly 32 bytes"
    );
  });
});
