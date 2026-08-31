# ADR-059: Mermaid Renderer backpressure after readiness

## Status

Accepted

## Context

The isolated Mermaid Renderer has an eight-request pending limit, but callers may arrive concurrently while the hidden WebView is still completing its readiness and ACL handshake. A limit checked before that asynchronous wait is not a reservation: every caller can observe the same empty pending map and later enter together.

## Decision

The main-window adapter validates source size before IPC, awaits Renderer recovery/readiness, and only then checks the current pending count immediately before allocating a request ID, timeout, and pending entry. JavaScript continuation ordering makes each resumed caller observe the entries reserved by earlier continuations. The ninth concurrent request therefore receives `mermaid_renderer_busy` without being emitted.

The packaged QA profile exercises the complete pressure sequence:

1. reject 20,001 source code units before IPC;
2. render a dense but permitted 200-edge flowchart;
3. hold exactly eight QA sentinel requests;
4. reject the ninth request as busy;
5. allow the first timeout to recreate the Renderer and reject all held work with only stable timeout/restart errors;
6. render a normal diagram through the replacement Renderer.

The pressure harness is dynamically loaded only by the separately identified QA application. It is not part of normal execution.

## Consequences

The pending count is now a real concurrency bound across Renderer startup and recovery, preventing a burst from allocating unbounded timers and request state. Work is never queued invisibly: callers beyond the bound must retry explicitly. Platform-specific WebView memory behavior still requires Windows WebView2 and Linux WebKitGTK packaged passes.

