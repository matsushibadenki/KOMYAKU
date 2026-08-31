# ADR-052: Capability-minimized Mermaid WebView

- Status: Accepted
- Date: 2026-08-30

## Context

Mermaid needs DOM and script execution to turn authored diagram source into SVG. Executing it in the main Desktop WebView would place a complex parser and renderer beside document editing, SQLite, cloud sessions, and provider credentials. An ordinary script-enabled iframe does not establish a Tauri IPC boundary.

Tauri application commands also require an application ACL manifest. Without that manifest, merely omitting a command from a Window capability is not a sufficient command boundary.

## Decision

The Desktop declares a hidden `mermaid-renderer` WebView with its own `/?mode=mermaid-renderer` entry mode. It receives only `core:event:allow-listen` and `core:event:allow-emit-to`. It receives neither `core:default`, SQL permissions, nor any KOMYAKU application command permission.

All application commands are registered in the Tauri build-time `AppManifest` and their generated `allow-*` permissions are granted only to the `main` Window. New commands must be added to both the manifest and the main capability deliberately. The renderer communicates through bounded request/result envelopes, has at most eight outstanding requests, and the main caller abandons a request after eight seconds.

The harmless `acl_boundary_canary` command is also granted only to `main`. The renderer attempts that command and a read-only SQL plugin load at startup, and enables rendering only when Tauri rejects both invocations. If a future configuration accidentally exposes application commands or SQL to the renderer, a canary succeeds and Mermaid fails closed with `mermaid_renderer_boundary_failed`. No credential or authored data is read by either probe.

When a render exceeds eight seconds, `main` rejects the request, clears other pending work, closes the hidden renderer, and creates a fresh hidden WebView with the same fixed label and URL. Recovery completes only after the new host passes the readiness handshake and both denial canaries. The WebView-create and Window-close capabilities used for this reset are granted only to `main`; they are not added to the renderer capability.

The renderer validates Mermaid source under the fixed policy, renders in its own document, sanitizes the resulting SVG into a new allowlisted XML document, and returns only the static preview Descriptor. The main WebView displays that Descriptor in the existing script-free sandboxed iframe. Authored source remains Canonical.

The renderer module is dynamically imported only for the hidden renderer entry mode, so the editor's initial JavaScript graph does not eagerly execute Mermaid.

Main establishes a nonce-bound readiness handshake before sending authored source. It registers its listeners first, retries a capability-limited ping within a four-second budget, and accepts readiness only when the Renderer reports that its ACL canary was denied. This prevents startup event loss without weakening the privilege boundary.

## Consequences

- Compromising Mermaid does not directly grant SQL, secure-session, provider-credential, or other KOMYAKU command access.
- Event IPC is intentionally retained, so this is capability-minimized rather than literally IPC-free.
- The event response remains untrusted and is sanitized before display.
- Packaged macOS QA proves the deterministic request-timeout, WebView replacement, fresh canary handshake, and successful post-recovery render path. This does not prove CPU or memory termination. WebView process sharing is platform-dependent, so pressure tests remain required across supported platforms.
- Capability configuration and the fail-closed canary logic have automated regression coverage. Packaged supported-platform QA must still exercise the live request path and direct denial attempts against sensitive command classes.
