import { useEffect } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import {
  renderMermaidPreview,
  renderMermaidSvgInCurrentDocument
} from "@komyaku/preview-core";
import {
  MERMAID_RENDER_REQUEST_EVENT,
  MERMAID_RENDER_RESULT_EVENT,
  MERMAID_RENDER_PING_EVENT,
  MERMAID_RENDER_READY_EVENT,
  MERMAID_PREVIEW_QA_TIMEOUT_SOURCE,
  isMermaidRenderRequest,
  verifyMermaidRendererBoundary,
  verifyMermaidRendererSqlBoundary
} from "../services/mermaid-renderer-protocol.js";

function stableError(error) {
  return typeof error?.code === "string" ? error.code : "mermaid_render_failed";
}

export function MermaidRendererHost() {
  const previewQa = new URLSearchParams(window.location.search).get("previewQa") === "1";
  useEffect(() => {
    let disposed = false;
    const boundaryVerified = Promise.all([
      verifyMermaidRendererBoundary(invoke),
      verifyMermaidRendererSqlBoundary(invoke)
    ]).then((results) => results.every(Boolean));
    const pingUnsubscribePromise = listen(MERMAID_RENDER_PING_EVENT, async ({ payload }) => {
      if (!payload || typeof payload.nonce !== "string" || !/^[a-f0-9-]{1,64}$/u.test(payload.nonce)) return;
      const ok = await boundaryVerified;
      if (!disposed) await emitTo("main", MERMAID_RENDER_READY_EVENT, { nonce: payload.nonce, ok });
    });
    const unsubscribePromise = listen(MERMAID_RENDER_REQUEST_EVENT, async ({ payload }) => {
      if (!isMermaidRenderRequest(payload)) return;
      const { requestId, source, language } = payload;
      try {
        if (!(await boundaryVerified)) throw { code: "mermaid_renderer_boundary_failed" };
        if (previewQa && source === MERMAID_PREVIEW_QA_TIMEOUT_SOURCE) {
          await new Promise(() => {});
        }
        const preview = await renderMermaidPreview(source, {
          language,
          isolatedRenderer: ({ source: validatedSource, config }) =>
            renderMermaidSvgInCurrentDocument({
              source: validatedSource,
              config,
              renderId: `komyaku-mermaid-${requestId}`
            })
        });
        if (!disposed) {
          await emitTo("main", MERMAID_RENDER_RESULT_EVENT, { requestId, ok: true, preview });
        }
      } catch (error) {
        if (!disposed) {
          await emitTo("main", MERMAID_RENDER_RESULT_EVENT, {
            requestId,
            ok: false,
            error: stableError(error)
          });
        }
      }
    });
    return () => {
      disposed = true;
      void unsubscribePromise.then((unsubscribe) => unsubscribe());
      void pingUnsubscribePromise.then((unsubscribe) => unsubscribe());
    };
  }, [previewQa]);

  return <main aria-hidden="true" data-renderer="mermaid" />;
}
