# ADR-046: Bounded AI Streaming and Cancellation

- Status: Accepted
- Date: 2026-08-30

## Context

Long AI responses need progressive feedback and cancellation. A partial network response must not become an apparently complete historical branch, and an unbounded or malformed SSE stream must not exhaust Desktop memory.

## Decision

The OpenAI-compatible adapter supports `text/event-stream` responses from `POST /chat/completions` with `stream: true`.

- The reviewed provider payload contains model and messages. The transport-only `stream` flag is added by the adapter after hash verification.
- Only `data:` SSE fields are consumed. `[DONE]` ends the stream.
- Every JSON delta must contain string content when content is present.
- Raw stream bytes and accumulated response text share the configured response-size ceiling.
- Provider error bodies are not retained or surfaced.
- `AbortSignal` terminates reading and returns `ai_provider_cancelled`.
- Desktop may render accumulated text while receiving it, but calls `appendContinuationBranch` only after the adapter returns a complete validated response.
- Cancellation and parsing failure clear the transient text and create no Message or Edge.

The non-streaming adapter method remains available for compatibility, but Desktop AI Handoff uses streaming.

## Consequences

- Users receive progressive feedback and can stop a long response.
- Partial text is deliberately ephemeral and absent from version history.
- The initial parser supports OpenAI-compatible text deltas only; tool calls, citations, usage trailers, reconnect, and resume require later capability-specific work.
