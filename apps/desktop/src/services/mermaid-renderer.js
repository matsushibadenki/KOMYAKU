import { emitTo, listen } from "@tauri-apps/api/event";
import {
  MERMAID_RENDER_MAX_PENDING,
  MERMAID_RENDER_REQUEST_EVENT,
  MERMAID_RENDER_RESULT_EVENT,
  MERMAID_RENDER_TIMEOUT_MS,
  MERMAID_RENDERER_WINDOW,
  isMermaidRenderResult
} from "./mermaid-renderer-protocol.js";

const pending = new Map();
let listenerPromise;

function ensureListener() {
  listenerPromise ??= listen(MERMAID_RENDER_RESULT_EVENT, ({ payload }) => {
    if (!isMermaidRenderResult(payload)) return;
    const request = pending.get(payload.requestId);
    if (!request) return;
    pending.delete(payload.requestId);
    clearTimeout(request.timer);
    if (payload.ok) request.resolve(payload.preview);
    else request.reject(new Error(payload.error));
  });
  return listenerPromise;
}

export async function renderMermaidInIsolatedWebview(source, { language = "und" } = {}) {
  if (typeof source !== "string" || source.length === 0 || source.length > 20_000) {
    throw new Error("invalid_mermaid_source");
  }
  if (pending.size >= MERMAID_RENDER_MAX_PENDING) throw new Error("mermaid_renderer_busy");
  await ensureListener();
  const requestId = crypto.randomUUID().toLowerCase();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("mermaid_render_timeout"));
    }, MERMAID_RENDER_TIMEOUT_MS);
    pending.set(requestId, { resolve, reject, timer });
    emitTo(MERMAID_RENDERER_WINDOW, MERMAID_RENDER_REQUEST_EVENT, {
      requestId,
      source,
      language
    }).catch((error) => {
      clearTimeout(timer);
      pending.delete(requestId);
      reject(new Error("mermaid_renderer_unavailable", { cause: error }));
    });
  });
}
