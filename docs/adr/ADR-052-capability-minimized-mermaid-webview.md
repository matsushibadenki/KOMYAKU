# ADR-052: Capability-minimized Mermaid WebView

- Status: Accepted
- Date: 2026-08-30

## Context

Mermaid needs DOM and script execution to turn authored diagram source into SVG. Executing it in the main Desktop WebView would place a complex parser and renderer beside document editing, SQLite, cloud sessions, and provider credentials. An ordinary script-enabled iframe does not establish a Tauri IPC boundary.

Tauri application commands also require an application ACL manifest. Without that manifest, merely omitting a command from a Window capability is not a sufficient command boundary.

## Decision

The Desktop declares a hidden `mermaid-renderer` WebView with its own `/?mode=mermaid-renderer` entry mode. It receives only `core:event:allow-listen` and `core:event:allow-emit-to`. It receives neither `core:default`, SQL permissions, nor any KOMYAKU application command permission.

All ten current application commands are registered in the Tauri build-time `AppManifest` and their generated `allow-*` permissions are granted only to the `main` Window. New commands must be added to both the manifest and the main capability deliberately. The renderer communicates through bounded request/result envelopes, has at most eight outstanding requests, and the main caller abandons a request after eight seconds.

The renderer validates Mermaid source under the fixed policy, renders in its own document, sanitizes the resulting SVG into a new allowlisted XML document, and returns only the static preview Descriptor. The main WebView displays that Descriptor in the existing script-free sandboxed iframe. Authored source remains Canonical.

The renderer module is dynamically imported only for the hidden renderer entry mode, so the editor's initial JavaScript graph does not eagerly execute Mermaid.

## Consequences

- Compromising Mermaid does not directly grant SQL, secure-session, provider-credential, or other KOMYAKU command access.
- Event IPC is intentionally retained, so this is capability-minimized rather than literally IPC-free.
- The event response remains untrusted and is sanitized before display.
- The timeout bounds caller waiting but does not prove renderer CPU or memory termination. WebView process sharing is platform-dependent; packaged load, failure, and renderer-recovery tests remain required before exposing Mermaid preview in the editor.
- Capability configuration has automated regression coverage, but a packaged runtime denial test is still required to prove that the renderer cannot invoke every sensitive command on supported platforms.

