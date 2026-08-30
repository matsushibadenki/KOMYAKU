# ADR-044: Bounded Provider Model Discovery

- Status: Accepted
- Date: 2026-08-30

## Context

Requiring every user to copy a Model ID is error-prone. Model discovery is still an authenticated outbound request and must not weaken the Local/BYOK endpoint or credential boundaries.

## Decision

The AI gateway exposes provider-independent `listModels`. The OpenAI-compatible adapter performs one `GET <base>/models` request only after the user has saved and selected a validated connection.

- Local connections remain restricted to loopback origins.
- BYOK connections remain HTTPS-only.
- Credentials are resolved from OS secure storage immediately before discovery and are sent only in the Authorization header.
- Responses are limited to 1 MiB and 1,000 entries.
- Model IDs must be non-empty strings of at most 300 characters.
- Duplicate IDs are removed and the result is sorted for stable presentation.
- Provider response bodies and credentials are never included in returned errors.
- Discovery failure never blocks a manually entered Model ID.

The Desktop does not fetch models on page load. **Fetch models from provider** is an explicit network action after connection selection. Choosing a discovered model invalidates any prior payload review.

## Consequences

- Compatible Local and BYOK services can populate the model selector without provider-specific UI.
- A malicious endpoint cannot return an unbounded model catalog.
- Provider-specific pagination and richer model metadata are not yet supported.
- Manually entered Model IDs remain the interoperability fallback.
