# Stage 2 External Security Review Package

- Status: Ready for independent reviewer
- Owner: Security / Engineering
- Scope version: Stage 2 Identity Engineering Completion, 2026-08-19

This package defines the work to be performed by an independent reviewer. Its existence is not an audit result, certification, or permission to enable public authentication in production.

## Review objectives

Determine whether an unauthenticated or low-privilege actor can:

- obtain, predict, reuse, or retain a Session, verification, or reset credential;
- enumerate accounts beyond the explicitly accepted registration behavior;
- bypass distributed Rate Limits through concurrency, replicas, proxy headers, or identifier variants;
- cross a Workspace authorization boundary;
- cause notification plaintext, recipient data, authored content, or credentials to enter logs or durable plaintext queues;
- exploit CORS, request parsing, oversized bodies, redirects, email HTML, SMTP configuration, or error handling;
- abuse Worker leases, retries, Dead Letters, replay, or key rotation to send invalid or superseded links;
- turn operational endpoints, Object Storage, or database access into a broader compromise.

## In-scope implementation

- `/api/v1/auth/*` routes and middleware;
- Argon2id password policy and dummy verification;
- Bearer Session creation, lookup, revocation, and expiry;
- Email Verification and Password Reset token lifecycles;
- PostgreSQL distributed Rate Limits and HMAC identifier keys;
- trusted-proxy address resolution and CORS configuration;
- AES-256-GCM notification envelopes;
- Transactional Outbox, Job leases, retries, attempt history, and Dead Letters;
- SMTP adapter, localized templates, and action-link construction;
- production configuration validation, secret separation, structured logging, and shutdown behavior;
- Workspace authorization used by currently protected operations.

## Primary evidence

- `docs/adr/ADR-016-password-and-session-security.md`
- `docs/adr/ADR-018-distributed-authentication-protection.md`
- `docs/adr/ADR-019-gated-smtp-authentication-routes.md`
- `docs/adr/ADR-029-encrypted-transactional-notification-delivery.md`
- `docs/security/authentication-review.md`
- `docs/testing/auth-endpoint-load-baseline.md`
- `docs/testing/auth-production-like-load-baseline.md`
- `docs/guides/production-readiness.md`
- database migrations `0003` through `0006`

## Required test classes

1. Static review of trust boundaries, validation, SQL, crypto use, and secret handling.
2. Black-box Route testing for authentication, authorization, enumeration, cache behavior, body limits, CORS, proxy headers, and error consistency.
3. Concurrent tests across at least two API replicas sharing PostgreSQL.
4. Notification replay, token replacement, expiry, Worker crash, SMTP rejection, and Dead Letter tests.
5. Session theft/revocation and password-reset-all-sessions tests.
6. Deployment review of TLS, HSTS at the edge, proxy header overwrite, network policy, database and SMTP credentials, backups, and operator access.
7. Dependency and container vulnerability review using the versions deployed for the assessment.

Do not test production user data. Use an isolated environment and synthetic accounts. Do not commit exploit tokens, ciphertext plaintext, credentials, raw email bodies, or sensitive scanner output to this repository.

## Finding record

Each finding must include:

```text
ID
severity and rationale
affected boundary
preconditions
reproduction summary with sensitive values removed
impact
recommended remediation
owner
target date
fix evidence
independent retest result and date
```

Stage 2 may remain Engineering Complete while this gate is open, but public production authentication must remain disabled until all Critical and High findings are closed and independently retested. Accepted Medium findings require a documented owner, deadline, and compensating control.

## Explicitly deferred capabilities

Passkeys, OAuth/OIDC, MFA, SAML, and SCIM are not implemented and must not be represented as reviewed features. Online multi-key notification-envelope rotation is also deferred; current operations require draining pending notification work before key replacement.

## 日本語要約

本書は外部Security Reviewを依頼するためのScopeと証跡一覧であり、監査完了証明ではない。Critical／High Findingの修正と第三者による再Testが完了するまで、本番の公開認証を有効にしない。

## 简体中文摘要

本文档用于向独立安全审查方提供范围和证据清单，不代表审计已经完成。在所有严重和高危问题修复并通过独立复测之前，不得在生产环境启用公开认证。
