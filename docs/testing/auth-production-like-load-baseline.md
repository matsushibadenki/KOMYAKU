# Stage 2 Authentication Production-like Load Baseline

- Date: 2026-08-19
- Status: Passed isolated local PostgreSQL/SMTP baseline
- Capacity claim: No

## Covered path

The Stage 2 harness exercises the following real components as one pipeline:

```text
HTTP registration Route
  -> PostgreSQL distributed registration Rate Limit
  -> Argon2id password hashing
  -> atomic User / Session / Workspace / Token transaction
  -> AES-256-GCM notification envelope
  -> PostgreSQL Transactional Outbox
  -> durable Job and attempt record
  -> active one-time-token verification
  -> pooled SMTP transport
  -> Mailpit acceptance and API count verification
```

The Compose profile uses an isolated `komyaku_stage2_load` PostgreSQL database on loopback port `55432` with a tmpfs data directory. Mailpit SMTP and HTTP are bound to loopback ports `51025` and `58025`. The harness refuses to run against a differently named database and requires `AUTH_PRODUCTION_LOAD_ENABLED=1`.

## Reproduction

```sh
docker compose --profile stage2-load up -d postgres-stage2-load mailpit-stage2-load
DATABASE_URL=postgres://komyaku_load:local-stage2-load-only@127.0.0.1:55432/komyaku_stage2_load bun run db:migrate
AUTH_PRODUCTION_LOAD_ENABLED=1 bun run --filter @komyaku/server test:auth-production-load
docker compose --profile stage2-load down
```

Optional controls:

```text
AUTH_PRODUCTION_LOAD_REQUESTS=1..10
AUTH_PRODUCTION_LOAD_CONCURRENCY=1..8
AUTH_PRODUCTION_LOAD_REGISTER_P95_MS=5000
AUTH_PRODUCTION_LOAD_PIPELINE_LIMIT_MS=15000
```

The request maximum remains below the configured registration-network limit. The test intentionally uses one network identity so PostgreSQL advisory-lock serialization is exercised without triggering a block.

## Observed result

```text
requests: 8
concurrency: 4
HTTP status: 201 × 8
registration elapsed: 89 ms
registration throughput: 90.30 requests/second
registration p50: 30.72 ms
registration p95: 62.80 ms
registration p99: 62.80 ms
Outbox: 16 claimed / 16 published / 0 failed
Notification Jobs: 8 completed / 0 retried / 0 failed
SMTP: 8 messages accepted
notification pipeline elapsed: 93 ms
```

Results vary by hardware and container state. The generous default thresholds detect regressions and broken dependencies; they are not production SLOs.

## Remaining launch evidence

Before exposing authentication to real users, repeat representative tests in the intended staging topology with TLS termination, proxy header rewriting, realistic latency, production PostgreSQL pooling, SMTP-provider sandbox credentials, monitoring, backup/restore, overload, and failure injection. An independent external security review remains mandatory.

## 日本語要約

専用PostgreSQLとMailpitを使い、登録Routeから暗号化Outbox、Job、SMTP受理までを実経路で検証した。これはEngineering Baselineであり、本番容量保証や外部Security Auditではない。

## 简体中文摘要

该测试使用专用 PostgreSQL 与 Mailpit，验证从注册路由、加密 Outbox、Job 到 SMTP 接收的真实流程。它属于工程基线，不代表生产容量保证或外部安全审计。
