# ADR-051: Isolated static preview boundary

- Status: Accepted
- Date: 2026-08-30

## Context

Canonical Documents preserve authored LaTeX, Mermaid/SVG, images, and files as source or Asset references. Rendering those values directly inside the editor DOM would give parser output the same origin and privileges as credentials, local database commands, and document editing. A preview is derived and disposable; it must never become the Canonical source of truth.

## Decision

KOMYAKU introduces `@komyaku/preview-core` as the renderer-independent policy boundary. A successful static renderer returns a bounded Descriptor rather than mutating a DOM element. The Desktop displays that Descriptor only in an iframe with an empty `sandbox` token set, empty Permissions Policy `allow`, and `no-referrer`. The generated document also carries a deny-by-default CSP, forbids base URLs, forms and navigation, and permits no network source.

LaTeX is the first implemented renderer. KaTeX produces MathML only with `trust: false`, `strict: "error"`, `throwOnError: true`, no shared global macro state, at most 500 macro expansions, a 20 em authored-size cap, a 20,000-code-unit source cap, and a 512 KiB final-document cap. Rendering errors expose only the stable code `latex_render_failed`; authored source from library error messages is not displayed as an error.

Authored SVG is parsed as XML with declaration and resource budgets, then rebuilt into a new SVG document from explicit element and attribute allowlists. Script, foreign namespaces, `foreignObject`, style, animation, `image`, `use`, event attributes, external URLs, and CSS escapes are never copied. Paint-server references are limited to `url(#local-id)`. The sanitized SVG is then placed in the same static iframe Descriptor as MathML.

Mermaid now has a bounded validation and Renderer Adapter contract. Site configuration is fixed to `securityLevel: "strict"`, `startOnLoad: false`, `htmlLabels: false`, 20,000 text units, and 500 edges; the security-related keys are marked secure. Authored frontmatter, directives, click actions, and authored style statements are rejected before parsing. Renderer output is never accepted directly and must pass through the SVG sanitizer. Without an explicitly supplied isolated Renderer Adapter, the call fails with `mermaid_isolated_renderer_unavailable`.

Image and PDF preview functions fail closed until their specific isolation gates are implemented. Their source or attachment identity remains visible and exportable; the application must not silently substitute a lossy preview for Canonical data.

Mermaid 11.17.2 is pinned for parsing and the future Renderer Adapter. The execution host must not share Tauri commands, credentials, storage, or the application DOM. A same-WebView iframe with scripts is not considered sufficient until Tauri capability isolation is demonstrated. Images and PDFs require accepted inspection state, authenticated short-lived reads, verified media type, dedicated preview response headers, and a separate-origin or equivalently isolated frame. PDF JavaScript, forms, embedded files, external retrieval, and active actions remain disabled.

## Consequences

- LaTeX becomes renderable without script execution or external resource loading in the preview frame.
- Basic authored SVG becomes renderable only after lossy security normalization; Canonical SVG source remains unchanged.
- The same Descriptor contract can later accept server-produced immutable preview Assets.
- Mermaid parsing and renderer-output normalization are available; Desktop execution proceeds through the capability-minimized host defined by ADR-052, while editor exposure remains gated on packaged denial and recovery QA. Image/PDF rendering remains unavailable rather than weakening isolation.
- An empty iframe sandbox deliberately excludes `allow-scripts`, `allow-same-origin`, forms, popups, downloads, and top navigation.
