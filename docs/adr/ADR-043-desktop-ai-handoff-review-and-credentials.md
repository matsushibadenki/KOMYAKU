# ADR-043: Desktop AI Handoff Review and Provider Credentials

- Status: Accepted
- Date: 2026-08-30

## Context

The provider-independent gateway already binds a handoff to one conversation branch and two hashes, but a safe Desktop flow must make that boundary visible. BYOK credentials must survive without entering React state after setup, Web Storage, SQLite, documents, previews, or logs.

## Decision

The Desktop import flow retains the canonical conversations only in memory and exposes AI Handoff after local import review is complete. The user must:

1. choose a Local loopback or HTTPS BYOK connection;
2. choose the exact conversation endpoint;
3. inspect every text message in the selected single branch;
4. generate a provider-converted review containing endpoint, model, estimated input units, Canonical Context SHA-256, Outbound SHA-256, and conversion warnings;
5. provide explicit consent for that displayed message count and provider; and
6. invoke a separate send action.

Local connections accept loopback endpoints only. BYOK connections require HTTPS. The Desktop generates one opaque UUID credential reference. Tauri stores the secret under service `app.komyaku.desktop` and account `ai-provider-<uuid>` using the platform credential store. JavaScript receives only the reference; the gateway resolves the secret immediately before sending. Replacing the same connection overwrites the same credential entry, and switching it to Local removes the prior secret.

Connection metadata and the post-response continuation branch currently remain in Desktop memory. Persisting the handoff record and new branch atomically is a separate launch gate.

## Consequences

- Imported text cannot silently widen the branch or authorize transmission.
- A changed Canonical context or converted request invalidates consent.
- API keys have no browser-storage fallback and Desktop browser preview cannot save BYOK credentials.
- A running process necessarily holds a resolved secret briefly during a request.
- Model discovery, streaming transport, masking assistance, and transactional persistence remain unfinished.

## Verification

- JavaScript tests verify no Web Storage fallback and fixed native command names.
- Rust tests reject non-UUID credential references and enforce bounded non-empty secrets.
- Browser E2E reaches the enabled send button only after exact review and consent, without sending a network request.
