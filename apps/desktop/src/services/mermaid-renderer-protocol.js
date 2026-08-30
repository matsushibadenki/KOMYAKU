export const MERMAID_RENDER_REQUEST_EVENT = "komyaku://mermaid-render-request";
export const MERMAID_RENDER_RESULT_EVENT = "komyaku://mermaid-render-result";
export const MERMAID_RENDERER_WINDOW = "mermaid-renderer";
export const MERMAID_RENDER_TIMEOUT_MS = 8_000;
export const MERMAID_RENDER_MAX_PENDING = 8;

export function isMermaidRenderRequest(value) {
  return Boolean(value
    && typeof value.requestId === "string"
    && /^[a-f0-9-]{1,64}$/u.test(value.requestId)
    && typeof value.source === "string"
    && value.source.length > 0
    && value.source.length <= 20_000
    && typeof value.language === "string"
    && value.language.length <= 32);
}

export function isMermaidRenderResult(value) {
  return Boolean(value
    && typeof value.requestId === "string"
    && /^[a-f0-9-]{1,64}$/u.test(value.requestId)
    && typeof value.ok === "boolean"
    && (value.ok
      ? value.preview?.kind === "static-html" && typeof value.preview.document === "string"
      : typeof value.error === "string"));
}
