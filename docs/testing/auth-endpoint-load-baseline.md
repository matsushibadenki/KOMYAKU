# Authentication Endpoint Load Baseline

- Date: 2026-08-19
- Status: Local reproducible baseline; not a production capacity claim

## Scenario

`bun run --filter @komyaku/server test:auth-load` starts a temporary loopback HTTP server and submits unknown-account login requests. The complete Hono authentication route runs, including JSON parsing, body limits, response headers, generic credential errors, and the real Argon2id dummy-hash verification used to reduce account-enumeration timing differences.

The harness never targets an external host. It uses an in-memory identity lookup and permissive in-memory rate-limit adapter, so it does not measure PostgreSQL contention, distributed rate-limit serialization, reverse proxies, TLS, SMTP, or internet latency.

## Observed local run

```text
requests: 40
concurrency: 4
status: 401 × 40
throughput: 245.80 requests/second
p50: 15.25 ms
p95: 24.56 ms
p99: 24.71 ms
max: 24.71 ms
```

Environment-specific timings will vary. The default p95 guard is intentionally generous at 2,000 ms to detect regressions and pathological failures, not to define production SLOs.

## Configuration

```text
AUTH_LOAD_REQUESTS=40
AUTH_LOAD_CONCURRENCY=4
AUTH_LOAD_P95_LIMIT_MS=2000
```

Concurrency is capped at 32 because each unknown login performs intentionally expensive password verification. Production approval still requires a separate test using representative PostgreSQL, proxy/TLS, rate-limit, SMTP-sink, replica, and observability configuration, followed by an independent external security review.
