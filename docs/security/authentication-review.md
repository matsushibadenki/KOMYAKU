# Authentication Security Review Status

## [Done] Internal automated boundaries

- Generic login failures and real dummy Argon2id verification for unknown accounts
- Generic password-reset acceptance independent of account existence
- Shared minimum response-time floor for known and unknown password-reset addresses
- 16 KiB authentication request limit and bounded JSON errors
- Non-cacheable authentication responses and baseline security headers
- Hashed session and one-time tokens at rest
- Distributed PostgreSQL rate limits with HMAC-protected identifiers
- Trusted-proxy hop validation and spoofed forwarding-header tests
- Transactional encrypted notification delivery with active-token verification
- SMTP file/URL access disabled and provider diagnostics excluded from logs
- Job retry, lease recovery, attempt history, Dead Letter, and audited operator retry
- Reproducible loopback endpoint load regression harness

## [Next] Pre-production evidence

- Run representative PostgreSQL and SMTP-sink load tests behind the intended TLS reverse proxy
- Validate connection-pool, rate-limit, Worker, retry, and queue-age behavior at expected peak and overload
- Exercise encryption-key rotation and disaster recovery after multi-key envelope support exists
- Add dependency and container vulnerability scanning to CI
- Obtain an independent external review covering authentication, authorization, session management, email links, proxy configuration, CORS, deployment manifests, and operational access
- Record findings, severity, remediation owner, evidence, and retest status without placing exploit secrets in the repository

This document is an internal readiness record, not an external audit report or security certification.
