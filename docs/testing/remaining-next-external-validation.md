# Remaining `[Next]` External Validation

This document describes external Cloud/platform gates; it is not a declaration that all product implementation or validation is complete. The active N0–N3 roadmap still includes local product work and native interaction checks. See [the 2026-09-09 verification matrix](verification-2026-09-09.md) for the latest consolidated evidence and remaining scope. External gates require infrastructure, operating-system input methods, native credential stores, or an evaluator independent from the implementation agent. They must not be marked `[Done]` from unit tests or simulated evidence.

## 1. Intended production topology

Provide a disposable staging topology representative of production. The selected initial option is one XServer VPS Cloud 4GB/50GB application VPS with Managed PostgreSQL 10GB and its daily seven-day backup option, plus an external HTTPS S3-compatible Object Store. NFS remains deferred because the current storage adapter requires S3 semantics and XServer NFS has no customer-restorable backup. Independent AI, batch, or crawler work should run on a separate normal VPS and communicate through HTTPS APIs or a job queue; it must not depend on direct Managed PostgreSQL access. See `docs/architecture/xserver-vps-cloud-small-start.md`.

The operator must provide these values through the documented environment variables or a secret manager, never in chat or committed files:

- staging HTTPS origin and reverse-proxy/load-balancer configuration;
- isolated staging PostgreSQL connection information;
- staging SMTP provider credentials and a controlled recipient domain;
- Object Storage endpoint/bucket credentials;
- monitoring/log destination and alert recipient;
- backup destination, retention period, and a disposable restore target.

Run the production-like authentication harness in `docs/testing/auth-production-like-load-baseline.md`, inject proxy/SMTP/PostgreSQL failure cases, perform one database and Object Storage restore, and retain timestamped redacted reports. Production data must not be used.

## 2. Independent security review

Select an evaluator who did not implement the reviewed code. Give them `docs/security/stage2-external-review-package.md`, a staging account, the exact revision, and the intended deployment diagram. The reviewer must return findings with severity, reproduction evidence, affected revision, and retest status. KOMYAKU engineering then remediates validated findings and the same reviewer or another independent reviewer retests them.

Do not send credentials, private keys, production exports, or user-authored Documents in the review package.

## 3. Windows and Linux packaged renderer QA

Provide either physical or virtual hosts with:

- Windows 11 with current WebView2 Runtime;
- a supported Linux desktop with WebKitGTK and Tauri build dependencies;
- repository checkout at the same revision and permission to build/run the packaged QA application.

Follow `docs/testing/packaged-mermaid-preview-qa.md` and `docs/testing/mermaid-pressure-qa.md`. Record OS/runtime versions, exact build revision, pass/fail results, and screenshots or logs that contain no authored private content.

## 4. Simplified Chinese Pinyin IME — completed on macOS

The user provisioned Simplified Chinese Pinyin and the packaged macOS pass completed on 2026-09-01. Evidence covers composition, candidate conversion, commit, Yjs replication, autosave, full quit/relaunch, and exact caret restoration. See `docs/testing/native-ime-validation.md`. Windows and Linux input behavior may be checked with their future packaged platform passes, but no longer blocks this macOS gate.

## 5. Native credential-store restart QA

Use disposable API credentials with minimal permissions and short expiry. Test macOS Keychain, Windows Credential Manager, and Linux Secret Service/libsecret independently using `docs/testing/ai-handoff-restart-recovery.md`. Confirm opt-in persistence, full-process restart recovery, revocation, deletion, and failure behavior when the credential store is locked or unavailable.

Never provide the credential value as evidence. Record only provider reference, timestamps, stable error codes, and whether recovery/revocation behaved correctly.

## Evidence return format

For each gate, return:

```text
Gate:
OS / topology:
Exact git revision:
Started at / completed at:
Result: PASS | FAIL | BLOCKED
Redacted evidence path:
Observed stable error codes:
Notes:
```

Once evidence is available, engineering can fix failures, update the relevant testing document, and change only genuinely completed Roadmap entries to `[Done]`.
