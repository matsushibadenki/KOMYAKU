import { emitTo, listen } from "@tauri-apps/api/event";
import {
  MERMAID_RENDER_MAX_PENDING,
  MERMAID_RENDER_REQUEST_EVENT,
  MERMAID_RENDER_RESULT_EVENT,
  MERMAID_RENDER_PING_EVENT,
  MERMAID_RENDER_READY_EVENT,
  MERMAID_RENDER_READY_TIMEOUT_MS,
  MERMAID_RENDER_TIMEOUT_MS,
  MERMAID_RENDERER_WINDOW,
  isMermaidRenderResult
} from "./mermaid-renderer-protocol.js";

const pending = new Map();
let listenerPromise;
let readyPromise;
let recoveryPromise;

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

function ensureReady() {
  if (readyPromise) return readyPromise;
  readyPromise = (async () => {
    const nonce = crypto.randomUUID().toLowerCase();
    let retry;
    let timeout;
    let unsubscribe;
    try {
      const result = await new Promise(async (resolve, reject) => {
        unsubscribe = await listen(MERMAID_RENDER_READY_EVENT, ({ payload }) => {
          if (payload?.nonce === nonce && typeof payload.ok === "boolean") resolve(payload.ok);
        });
        const ping = () => {
          void emitTo(MERMAID_RENDERER_WINDOW, MERMAID_RENDER_PING_EVENT, { nonce }).catch(() => {});
        };
        ping();
        retry = setInterval(ping, 150);
        timeout = setTimeout(() => reject(new Error("mermaid_renderer_not_ready")), MERMAID_RENDER_READY_TIMEOUT_MS);
      });
      if (!result) throw new Error("mermaid_renderer_boundary_failed");
      return true;
    } finally {
      if (retry) clearInterval(retry);
      if (timeout) clearTimeout(timeout);
      if (unsubscribe) unsubscribe();
    }
  })().catch((error) => {
    readyPromise = null;
    throw error;
  });
  return readyPromise;
}

async function recoverRendererWebview() {
  if (recoveryPromise) return recoveryPromise;
  recoveryPromise = (async () => {
    readyPromise = null;
    for (const [requestId, request] of pending) {
      clearTimeout(request.timer);
      request.reject(new Error("mermaid_renderer_restarted"));
      pending.delete(requestId);
    }
    const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const existing = await WebviewWindow.getByLabel(MERMAID_RENDERER_WINDOW);
    if (existing) await existing.close();
    const previewQa = new URLSearchParams(window.location.search).get("previewQa") === "1";
    const renderer = new WebviewWindow(MERMAID_RENDERER_WINDOW, {
      url: previewQa ? "/?mode=mermaid-renderer&previewQa=1" : "/?mode=mermaid-renderer",
      title: "KOMYAKU Mermaid Renderer",
      width: 800,
      height: 600,
      visible: false,
      resizable: false,
      skipTaskbar: true
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("mermaid_renderer_recreate_timeout")), 4_000);
      void renderer.once("tauri://created", () => {
        clearTimeout(timeout);
        resolve();
      });
      void renderer.once("tauri://error", () => {
        clearTimeout(timeout);
        reject(new Error("mermaid_renderer_recreate_failed"));
      });
    });
    await ensureReady();
  })().finally(() => { recoveryPromise = null; });
  return recoveryPromise;
}

export async function renderMermaidInIsolatedWebview(source, { language = "und" } = {}) {
  if (typeof source !== "string" || source.length === 0 || source.length > 20_000) {
    throw new Error("invalid_mermaid_source");
  }
  if (recoveryPromise) await recoveryPromise;
  await Promise.all([ensureListener(), ensureReady()]);
  // Check after readiness awaits. Concurrent callers can all enter while the
  // Renderer starts; each resumed caller must reserve against current state.
  if (pending.size >= MERMAID_RENDER_MAX_PENDING) throw new Error("mermaid_renderer_busy");
  const requestId = crypto.randomUUID().toLowerCase();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error("mermaid_render_timeout"));
      void recoverRendererWebview().catch(() => {});
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
