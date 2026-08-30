# ADR-045: Sensitive AI Handoff Detection and Masking

- Status: Accepted
- Date: 2026-08-30

## Context

Imported conversations can contain credentials and personal identifiers. A warning that repeats the matched value creates another disclosure, while silently rewriting the archive would violate provenance and history guarantees.

## Decision

KOMYAKU scans only the messages in the selected handoff branch, on the device. The bounded first implementation detects:

- private-key blocks;
- common API-key shapes;
- Bearer tokens;
- values attached to labels such as `api_key`, `access_token`, `password`, and `secret`;
- email addresses.

The result contains only a finding kind and count. It never contains the matched substring. The UI shows the original selected context locally and offers an explicit **mask detected candidates** checkbox. When enabled, KOMYAKU creates a temporary outbound copy containing typed placeholders such as `[REDACTED:API_KEY]`. Preview hashes and sending use this copy. The imported archive is never modified, and a provider response is still appended to the original conversation graph.

Changing masking state invalidates any previous payload review. Masking is assistance, not a guarantee: false positives and false negatives are disclosed in the UI.

## Consequences

- Findings and logs do not become a secondary secret store.
- The exact masked payload remains bound by both handoff hashes.
- Users can deliberately send an unmasked value after reviewing it.
- Pattern detection does not replace provider-specific DLP, enterprise policy, or manual review.
