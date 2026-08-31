# Packaged Mermaid preview validation

## Purpose

Validate the real Tauri WebView boundary without reading or modifying a normal KOMYAKU profile. The QA build uses product name `KOMYAKU Preview QA`, Bundle ID `app.komyaku.desktop.preview-qa`, and therefore a separate Application Support and SQLite namespace.

## Build

From `apps/desktop`:

```sh
bun run test:preview:package
```

The command merges `src-tauri/tauri.preview-qa.conf.json`, builds a debug macOS application, and opens the main Window at `/?previewQa=1`. The ordinary production configuration never enables these fixture nodes.

The fixture contains:

- one valid bounded flowchart;
- one malformed flowchart;
- one diagram with forbidden authored Mermaid initialization configuration.

## Expected results

| Fixture | Expected packaged result |
| --- | --- |
| Valid flowchart | one `about:srcdoc` iframe with an image role; source remains visible |
| Malformed flowchart | stable `mermaid_parse_failed`; source remains visible; no iframe |
| Authored init directive | stable `mermaid_author_config_forbidden`; source remains visible; no iframe |
| Full quit and relaunch | valid iframe returns; stable failures return; no timeout |

Because the feasibility screen displays two independent Yjs replicas, each result appears twice.

## 2026-08-30 macOS result

The first packaged pass failed closed with `mermaid_render_timeout` for all fixtures. Investigation found an initialization race: main emitted requests before the hidden Renderer registered its event listener. No Canonical source was lost and no raw output entered the editor DOM.

A nonce-bound readiness handshake now starts a bounded ping after the main listener is installed. The Renderer answers only after its main-only ACL canary is denied. Requests begin only after that response. Pings retry every 150 ms for at most four seconds; failure remains closed.

After rebuilding:

- two valid static preview frames rendered;
- malformed input returned two stable parse failures;
- authored configuration returned two stable policy failures;
- no timeout remained;
- complete quit and relaunch reproduced the same successful and failed states.

## Remaining tests

- Direct packaged denial attempts for SQL plugin commands and each sensitive application-command class.
- A direct SQL plugin load canary is now part of renderer readiness and was denied in the packaged macOS QA profile while valid diagrams continued to render. Remaining sensitive-command classes still need explicit packaged probes.
- The QA-only renderer recognizes one exact sentinel source, `%%KOMYAKU_PREVIEW_QA_TIMEOUT%%`, only when its URL contains `previewQa=1`. It deliberately leaves that request unanswered. The main adapter reaches its eight-second timeout, closes and recreates the hidden renderer, requires a fresh readiness and application-command/SQL denial-canary pass, and then sends a normal recovery diagram.

## Timeout recovery result

Packaged macOS validation on 2026-08-30 completed the deterministic sequence:

1. The isolated QA profile rendered the ordinary valid diagram and continued rejecting malformed and authored-configuration input.
2. The QA sentinel request remained unanswered for eight seconds and returned `mermaid_render_timeout` to the caller.
3. `main` recreated the hidden `mermaid-renderer` WebView with the QA URL; no renderer privilege was added.
4. The replacement host completed the readiness handshake and both denial canaries.
5. A subsequent valid `flowchart` request returned a sanitized static preview.
6. The visible QA state reached `Preview QA recovery: recovered`.

The sentinel and visible probe are absent unless the separately identified QA application is launched with `previewQa=1`. They do not modify normal KOMYAKU documents or the normal application profile.

The same isolated profile now also runs the packaged local-image insertion and restart probe documented in `docs/testing/image-packaged-restart-recovery.md`.

## Backpressure and pressure recovery result

On 2026-08-31 the macOS QA package completed a second deterministic pressure sequence after ordinary timeout recovery:

1. A 20,001-code-unit source was rejected before IPC as `invalid_mermaid_source`.
2. A permitted 200-edge flowchart rendered through the isolated WebView and sanitizer.
3. Eight sentinel requests occupied the complete pending budget.
4. The ninth concurrent request was rejected as `mermaid_renderer_busy` and was not emitted.
5. The first eight-second timeout recreated the Renderer; all held requests failed closed with only `mermaid_render_timeout` or `mermaid_renderer_restarted`.
6. A normal post-pressure diagram rendered through the replacement WebView.
7. The visible packaged state reached `Preview QA recovery: pressure-recovered` while the persisted PNG probe independently remained `recovered`.

An initial 450-edge pressure fixture was rejected by the SVG sanitizer as `svg_has_too_many_nodes`. This demonstrated the node budget working, but the permitted stress fixture was reduced to 200 edges so the packaged sequence could also prove post-load recovery.
- Deliberate CPU/memory pressure inputs and Renderer termination or replacement behavior.
- Windows WebView2 and Linux WebKitGTK packaged passes.
