import { describe, expect, test } from "bun:test";
import { loadRuntimeConfig } from "../src/config.js";

describe("runtime configuration", () => {
  test("defaults to the single-server postgres-outbox mode", () => {
    const config = loadRuntimeConfig({});

    expect(config.deploymentMode).toBe("single");
    expect(config.jobBackend).toBe("postgres-outbox");
    expect(config.databasePoolMax).toBe(10);
    expect(config.outboxBatchSize).toBe(25);
    expect(config.outboxLeaseSeconds).toBe(30);
    expect(config.jobBatchSize).toBe(10);
    expect(config.jobLeaseSeconds).toBe(60);
    expect(config.idempotencySecret.length).toBeGreaterThanOrEqual(32);
    expect(config.authRoutesEnabled).toBe(false);
    expect(config.smtp).toBeNull();
  });

  test("rejects unsupported deployment modes", () => {
    expect(() => loadRuntimeConfig({ DEPLOYMENT_MODE: "unknown" })).toThrow(
      "Unsupported DEPLOYMENT_MODE"
    );
  });

  test("refuses to expose authentication routes without production dependencies", () => {
    expect(() => loadRuntimeConfig({ AUTH_ROUTES_ENABLED: "true" })).toThrow(
      "AUTH_RATE_LIMIT_SECRET"
    );
  });

  test("parses complete authentication and SMTP configuration", () => {
    const config = loadRuntimeConfig({
      AUTH_ROUTES_ENABLED: "true",
      AUTH_RATE_LIMIT_SECRET: "a-production-secret-with-at-least-32-characters",
      PUBLIC_APP_ORIGIN: "https://app.example.com/path",
      TRUSTED_PROXY_HOPS: "1",
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "465",
      SMTP_SECURE: "true",
      SMTP_REQUIRE_TLS: "true",
      SMTP_USER: "mailer",
      SMTP_PASSWORD: "secret",
      SMTP_FROM: "KOMYAKU <no-reply@example.com>"
    });

    expect(config.authRoutesEnabled).toBe(true);
    expect(config.publicAppOrigin).toBe("https://app.example.com");
    expect(config.trustedProxyHops).toBe(1);
    expect(config.smtp).toMatchObject({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      requireTls: true,
      user: "mailer"
    });
  });

  test("requires SMTP credentials to be paired", () => {
    expect(() => loadRuntimeConfig({
      SMTP_HOST: "smtp.example.com",
      SMTP_USER: "mailer"
    })).toThrow("SMTP_USER and SMTP_PASSWORD");
  });

  test("requires object-storage credentials to be paired", () => {
    expect(() => loadRuntimeConfig({
      OBJECT_STORAGE_ACCESS_KEY: "access-only"
    })).toThrow("OBJECT_STORAGE_ACCESS_KEY and OBJECT_STORAGE_SECRET_KEY");
  });

  test("rejects a weak idempotency secret", () => {
    expect(() => loadRuntimeConfig({ IDEMPOTENCY_SECRET: "too-short" })).toThrow(
      "IDEMPOTENCY_SECRET"
    );
  });

  test("rejects development defaults and insecure origins in production", () => {
    expect(() => loadRuntimeConfig({ NODE_ENV: "production" })).toThrow("SERVER_HOST");
    expect(() => loadRuntimeConfig({
      NODE_ENV: "production",
      SERVER_HOST: "0.0.0.0",
      DATABASE_URL: "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku",
      OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
      OBJECT_STORAGE_BUCKET: "komyaku",
      OBJECT_STORAGE_ACCESS_KEY: "komyaku",
      OBJECT_STORAGE_SECRET_KEY: "change-me-now",
      IDEMPOTENCY_SECRET: "production-idempotency-secret-long-enough",
      CORS_ORIGINS: "http://app.example.com"
    })).toThrow("DATABASE_URL");
  });

  test("accepts an explicit production-safe baseline", () => {
    const config = loadRuntimeConfig({
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      SERVER_HOST: "0.0.0.0",
      DATABASE_URL: "postgres://komyaku:long-random-password@db.internal.example/komyaku",
      OBJECT_STORAGE_ENDPOINT: "https://objects.example.com",
      OBJECT_STORAGE_BUCKET: "komyaku-production",
      OBJECT_STORAGE_ACCESS_KEY: "production-access",
      OBJECT_STORAGE_SECRET_KEY: "production-secret",
      IDEMPOTENCY_SECRET: "production-idempotency-secret-long-enough",
      CORS_ORIGINS: "https://app.example.com",
      AI_TRAINING_DEFAULT: "deny"
    });
    expect(config).toMatchObject({
      nodeEnv: "production", logLevel: "warn", corsOrigins: ["https://app.example.com"]
    });
  });
});
