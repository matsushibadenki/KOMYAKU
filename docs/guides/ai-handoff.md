# AI Handoff Guide

## Purpose

AI Handoff continues an imported conversation with a Local OpenAI-compatible service or a user-owned HTTPS compatible API. It never reuses ChatGPT, Claude, or Gemini consumer-site cookies.

## Use

1. Import a supported conversation JSON and finish the local review. If recovery warnings exist, acknowledge them first.
2. Select **Local AI (Loopback)** or **Your API Key (HTTPS)**.
3. Enter the API base URL and Model ID. BYOK mode also asks for an API key; the packaged Tauri app saves it in the operating system credential store.
4. Optionally select **Fetch models from provider** and choose a returned Model. If discovery is unavailable, keep the manually entered Model ID.
5. Select a conversation and the message where the continuation should begin. KOMYAKU follows only the displayed parent chain.
6. If sensitive-data candidates appear, review their kinds and counts. Optionally enable masking; this changes only the outbound copy.
7. Select **Generate and review payload**.
8. Check the destination, model, displayed message bodies, warnings, estimated units, Context SHA-256, and Outbound SHA-256.
9. Check the one-send consent box, then send.

The response appears incrementally. Select **Cancel send** to stop it. KOMYAKU does not add a Branch until the stream completes, so cancelled or malformed partial responses are discarded.

The response is appended as an `ai_continuation` child. It does not overwrite the imported conversation. In the packaged Tauri app, a completed Handoff, assistant Message, Edge, and updated Canonical Conversation are committed to SQLite in one transaction. A failed commit keeps the completed response in memory and offers **Retry save**; retrying persistence does not contact the AI provider again. Loading the same Conversation ID restores its saved Canonical graph.

After restarting the packaged app, use **Local Conversations** below the import review. The list returns at most 100 recently updated records and exposes only title, Message count, and update time. Select **Open** to load and validate that one Conversation, then continue from any displayed point. **Refresh** repeats the bounded metadata query.

Browser development preview intentionally remains memory-only because it has no SQLite fallback. Its success message states this explicitly.

## Security notes

- Local mode is restricted to `localhost`, `127.0.0.1`, or `::1`.
- BYOK mode requires HTTPS and rejects URL credentials, query strings, and fragments.
- API keys are not stored in Local Storage, Session Storage, SQLite, document content, or review records.
- Sensitive-data findings contain only kinds and counts, never matched values. Detection can miss secrets or flag ordinary text.
- Browser-only development preview cannot save a BYOK key because it has no insecure fallback.
- Browser-only development preview does not persist continuation branches to Local Storage or Session Storage.
- AI inference consent is not consent for provider model training. Review the selected provider's retention and data-control terms.
- Treat imported conversation text as untrusted data. It cannot add hidden messages or obtain credentials.

## Current limitations

- Provider-specific pagination and richer model metadata are not yet available; compatible `/models` discovery and manual entry are supported.
- Streaming currently supports OpenAI-compatible text deltas. Tool calls, citations, resume, and reconnect are not yet supported.
- Attachment exclusion assistance is not yet available. Text secret masking is available but remains heuristic.
- Packaged-app restart recovery has an automated SQLite close/reopen regression and a macOS package build gate. Interactive release QA remains required on macOS, Windows, and Linux.
- Cloud synchronization is opt-in after an exact-byte Workspace import and requires an authorized Cloud Provider Connection. Provider credentials remain local.
