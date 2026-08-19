import { describe, expect, test } from "bun:test";
import { createNotificationEnvelope } from "../src/notifications/notification-envelope.js";
import { createNotificationDeliveryHandler } from "../src/services/notification-delivery-handler.js";

const envelope = createNotificationEnvelope({ keyHex: "33".repeat(32) });

function jobFor(overrides = {}) {
  const payload = {
    kind: "email_verification",
    userId: crypto.randomUUID(),
    email: "writer@example.com",
    interfaceLocale: "en",
    token: "b".repeat(43),
    expiresAt: "2026-08-20T00:00:00.000Z",
    ...overrides
  };
  return {
    payload,
    job: {
      payload: {
        deliveryId: crypto.randomUUID(),
        envelope: envelope.seal(payload)
      }
    }
  };
}

describe("notification delivery job", () => {
  test("checks that a token is current before delivering", async () => {
    const calls = [];
    const handler = createNotificationDeliveryHandler({
      notificationEnvelope: envelope,
      identityRepository: {
        async isOneTimeTokenActive(value) { calls.push(["active", value]); return true; }
      },
      notificationService: {
        async sendEmailVerification(value) { calls.push(["send", value]); return { accepted: true }; },
        async sendPasswordReset() { throw new Error("unexpected"); }
      },
      now: () => new Date("2026-08-19T00:00:00.000Z")
    });
    const { job, payload } = jobFor();

    await expect(handler(job)).resolves.toMatchObject({ deliveryId: job.payload.deliveryId });
    expect(calls.map(([name]) => name)).toEqual(["active", "send"]);
    expect(calls[1][1]).toEqual(payload);
    expect(calls[0][1].tokenHash).toHaveLength(64);
  });

  test("does not send superseded or expired tokens", async () => {
    let sends = 0;
    const handler = createNotificationDeliveryHandler({
      notificationEnvelope: envelope,
      identityRepository: { async isOneTimeTokenActive() { return false; } },
      notificationService: {
        async sendEmailVerification() { sends += 1; return { accepted: true }; },
        async sendPasswordReset() { sends += 1; return { accepted: true }; }
      },
      now: () => new Date("2026-08-19T00:00:00.000Z")
    });

    await expect(handler(jobFor().job)).rejects.toMatchObject({
      code: "notification_token_superseded", retryable: false
    });
    await expect(handler(jobFor({ expiresAt: "2026-08-18T00:00:00.000Z" }).job))
      .rejects.toMatchObject({ code: "notification_token_expired", retryable: false });
    expect(sends).toBe(0);
  });

  test("retries transport rejection without exposing transport errors", async () => {
    const handler = createNotificationDeliveryHandler({
      notificationEnvelope: envelope,
      identityRepository: { async isOneTimeTokenActive() { return true; } },
      notificationService: {
        async sendEmailVerification() { throw new Error("SMTP secret detail"); },
        async sendPasswordReset() { return { accepted: false }; }
      },
      now: () => new Date("2026-08-19T00:00:00.000Z")
    });
    await expect(handler(jobFor().job)).rejects.toMatchObject({
      code: "notification_transport_failed", retryable: true
    });
    await expect(handler(jobFor({ kind: "password_reset" }).job)).rejects.toMatchObject({
      code: "notification_rejected", retryable: true
    });
  });
});
