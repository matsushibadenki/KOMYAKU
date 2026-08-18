import { describe, expect, test } from "bun:test";
import { createSmtpNotificationService } from "../src/notifications/smtp-notification-service.js";

function input(overrides = {}) {
  return {
    userId: crypto.randomUUID(),
    email: "writer@example.com",
    interfaceLocale: "en",
    token: "a".repeat(43),
    expiresAt: "2026-08-18T12:00:00.000Z",
    ...overrides
  };
}

describe("SMTP notification adapter", () => {
  test("sends an English verification link without attachments or remote content", async () => {
    const sent = [];
    const service = createSmtpNotificationService({
      from: "KOMYAKU <no-reply@example.com>",
      publicAppOrigin: "https://app.example.com",
      transport: {
        async sendMail(message) {
          sent.push(message);
          return { accepted: ["writer@example.com"] };
        }
      }
    });

    expect(await service.sendEmailVerification(input())).toEqual({ accepted: true });
    expect(sent[0].subject).toBe("Verify your KOMYAKU email address");
    expect(sent[0].text).toContain("https://app.example.com/verify-email?token=");
    expect(sent[0].disableFileAccess).toBe(true);
    expect(sent[0].disableUrlAccess).toBe(true);
    expect(JSON.stringify(sent[0])).not.toContain("userId");
  });

  test("localizes password reset mail in Japanese and Simplified Chinese", async () => {
    const subjects = [];
    const service = createSmtpNotificationService({
      from: "no-reply@example.com",
      publicAppOrigin: "https://app.example.com",
      transport: {
        async sendMail(message) {
          subjects.push(message.subject);
          return { accepted: ["writer@example.com"] };
        }
      }
    });

    await service.sendPasswordReset(input({ interfaceLocale: "ja" }));
    await service.sendPasswordReset(input({ interfaceLocale: "zh-Hans" }));
    expect(subjects).toEqual([
      "KOMYAKUのパスワードを再設定",
      "重置您的 KOMYAKU 密码"
    ]);
  });

  test("reports rejected recipients without exposing provider details", async () => {
    const service = createSmtpNotificationService({
      from: "no-reply@example.com",
      publicAppOrigin: "https://app.example.com",
      transport: { sendMail: async () => ({ accepted: [], rejected: ["writer@example.com"] }) }
    });
    expect(await service.sendEmailVerification(input())).toEqual({ accepted: false });
  });
});
