import nodemailer from "nodemailer";
import { z } from "zod";

const notificationSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().email().max(320),
  interfaceLocale: z.enum(["ja", "en", "zh-Hans"]),
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: z.string().datetime({ offset: true })
});

const copy = Object.freeze({
  en: {
    verifySubject: "Verify your KOMYAKU email address",
    verifyLead: "Verify your email address to enable protected workspace operations.",
    verifyAction: "Verify email",
    resetSubject: "Reset your KOMYAKU password",
    resetLead: "Use this link to choose a new password. If you did not request this, ignore this message.",
    resetAction: "Reset password",
    expiry: "This link expires at"
  },
  ja: {
    verifySubject: "KOMYAKUのメールアドレスを確認してください",
    verifyLead: "保護されたワークスペース操作を有効にするため、メールアドレスを確認してください。",
    verifyAction: "メールアドレスを確認",
    resetSubject: "KOMYAKUのパスワードを再設定",
    resetLead: "このリンクから新しいパスワードを設定してください。心当たりがない場合は、このメールを無視してください。",
    resetAction: "パスワードを再設定",
    expiry: "リンクの有効期限"
  },
  "zh-Hans": {
    verifySubject: "请验证您的 KOMYAKU 邮箱地址",
    verifyLead: "请验证邮箱地址，以启用受保护的工作区操作。",
    verifyAction: "验证邮箱",
    resetSubject: "重置您的 KOMYAKU 密码",
    resetLead: "请使用此链接设置新密码。如果不是您提出的请求，请忽略此邮件。",
    resetAction: "重置密码",
    expiry: "链接有效期至"
  }
});

function htmlEscape(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function actionUrl(origin, path, token) {
  const url = new URL(path, origin);
  url.searchParams.set("token", token);
  return url.toString();
}

function message({ subject, lead, action, expiryLabel, expiresAt, url }) {
  const text = `${lead}\n\n${action}: ${url}\n\n${expiryLabel}: ${expiresAt}\n`;
  const html = [
    "<!doctype html><html><body>",
    `<p>${htmlEscape(lead)}</p>`,
    `<p><a href="${htmlEscape(url)}">${htmlEscape(action)}</a></p>`,
    `<p>${htmlEscape(expiryLabel)}: ${htmlEscape(expiresAt)}</p>`,
    "</body></html>"
  ].join("");
  return { subject, text, html };
}

export function createSmtpTransport(config) {
  return nodemailer.createTransport({
    pool: true,
    maxConnections: 3,
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.requireTls,
    auth: config.user ? { user: config.user, pass: config.password } : undefined,
    tls: { minVersion: "TLSv1.2" },
    logger: false,
    debug: false,
    disableFileAccess: true,
    disableUrlAccess: true
  });
}

export function createSmtpNotificationService({ transport, from, publicAppOrigin }) {
  if (!transport?.sendMail) throw new Error("SMTP transport is required");
  const sender = z.string().min(3).max(500).parse(from);
  const origin = z.string().url().parse(publicAppOrigin);

  async function send(input, kind) {
    const parsed = notificationSchema.parse(input);
    const localized = copy[parsed.interfaceLocale];
    const verification = kind === "verification";
    const url = actionUrl(
      origin,
      verification ? "/verify-email" : "/reset-password",
      parsed.token
    );
    const content = message({
      subject: verification ? localized.verifySubject : localized.resetSubject,
      lead: verification ? localized.verifyLead : localized.resetLead,
      action: verification ? localized.verifyAction : localized.resetAction,
      expiryLabel: localized.expiry,
      expiresAt: parsed.expiresAt,
      url
    });
    const info = await transport.sendMail({
      from: sender,
      to: parsed.email,
      subject: content.subject,
      text: content.text,
      html: content.html,
      disableFileAccess: true,
      disableUrlAccess: true
    });
    const accepted = Array.isArray(info.accepted)
      && info.accepted.some((address) => String(address).toLowerCase() === parsed.email.toLowerCase());
    return { accepted };
  }

  return Object.freeze({
    sendEmailVerification(input) {
      return send(input, "verification");
    },
    sendPasswordReset(input) {
      return send(input, "reset");
    },
    async verifyConnection() {
      if (!transport.verify) return false;
      return transport.verify();
    },
    close() {
      transport.close?.();
    }
  });
}
