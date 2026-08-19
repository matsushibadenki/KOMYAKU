# ADR-032: Stage 2 Identity Engineering Completion and Launch Gate

- Status: Accepted
- Date: 2026-08-19

## Context

Stage 2 implementation now covers account creation, password authentication, hashed Sessions, revocation, distributed Rate Limits, email verification, password reset, feature-gated public routes, and encrypted durable notification delivery. A reproducible loopback Route benchmark existed, but it did not exercise PostgreSQL or SMTP. An independent security review cannot truthfully be completed by the implementation agent itself.

## Decision

- Define Stage 2 Engineering Completion as implemented Identity boundaries, automated tests, an isolated real-PostgreSQL/SMTP pipeline baseline, operating documentation, and a review-ready evidence package.
- Keep public authentication disabled by default.
- Treat representative staging tests behind the intended TLS/proxy topology and an independent external security review as Production Launch Gates, not as code features that can be marked complete internally.
- Do not claim security certification or production readiness from local tests.
- Keep Passkey, OAuth/OIDC, MFA, SAML, SCIM, and TanStack Start re-evaluation as explicit post-MVP extensions rather than blocking the Stage 2 Identity foundation.

## Consequences

The roadmap can accurately mark Stage 2 engineering work complete without pretending an external assessment occurred. Operators have a repeatable PostgreSQL/SMTP test and reviewers have a bounded scope and evidence list. Production authentication remains gated until deployment-specific load evidence and independent findings/retests are recorded.

## Rejected alternatives

- Mark the independent review `[Done]` without a third-party report: false and unsafe.
- Leave Stage 2 indefinitely `[Next]` despite complete engineering scope: obscures actual progress.
- Treat future federation and enterprise identity providers as MVP completion requirements: expands scope without improving the already implemented local identity boundary.
