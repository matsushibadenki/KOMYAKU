export const MERMAID_RENDER_REQUEST_EVENT = "komyaku://mermaid-render-request";
export const MERMAID_RENDER_RESULT_EVENT = "komyaku://mermaid-render-result";
export const MERMAID_RENDER_PING_EVENT = "komyaku://mermaid-render-ping";
export const MERMAID_RENDER_READY_EVENT = "komyaku://mermaid-render-ready";
export const MERMAID_RENDERER_WINDOW = "mermaid-renderer";
export const MERMAID_PREVIEW_QA_TIMEOUT_SOURCE = "%%KOMYAKU_PREVIEW_QA_TIMEOUT%%";
export const MERMAID_RENDER_TIMEOUT_MS = 8_000;
export const MERMAID_RENDER_MAX_PENDING = 8;
export const MERMAID_RENDER_READY_TIMEOUT_MS = 4_000;
export const MERMAID_ACL_CANARY_COMMAND = "acl_boundary_canary";
export const MERMAID_SQL_CANARY_COMMAND = "plugin:sql|load";

export async function verifyMermaidRendererBoundary(invokeImpl) {
  if (typeof invokeImpl !== "function") return false;
  try {
    await invokeImpl(MERMAID_ACL_CANARY_COMMAND);
    return false;
  } catch {
    return true;
  }
}

export async function verifyMermaidRendererSqlBoundary(invokeImpl) {
  if (typeof invokeImpl !== "function") return false;
  try {
    // Loading opens the configured pool but neither reads rows nor mutates data.
    // A resolved call means the renderer has SQL plugin capability and must stop.
    await invokeImpl(MERMAID_SQL_CANARY_COMMAND, { db: "sqlite:komyaku.db" });
    return false;
  } catch {
    return true;
  }
}

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
