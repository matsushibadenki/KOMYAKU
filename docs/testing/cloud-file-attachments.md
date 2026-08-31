# Cloud File attachment verification

Automated tests verify:

1. Session-authenticated upload with stable Node identity and percent-encoded multilingual filename.
2. Exact byte forwarding, Workspace-scoped immutable storage, media allowlisting, filename validation, and the 1 MiB body boundary.
3. Pending inspection cannot produce File insertion attributes.
4. Acceptance requires matching detected media and `baseline-signature-v1` after complete-input inspection.
5. Rejection and timeout release the exact Asset reference.
6. Canonical adapters preserve File Node identity and Asset metadata without embedding original bytes.

Before expanding the allowlist, add adversarial fixtures for that format, a parser or full decoder policy, malware-scanner integration, authorized forced-download tests, and retention/reconciliation coverage.
