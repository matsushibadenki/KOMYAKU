import { useEffect } from "react";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
  renderMermaidPreview,
  renderMermaidSvgInCurrentDocument
} from "@komyaku/preview-core";
import {
  MERMAID_RENDER_REQUEST_EVENT,
  MERMAID_RENDER_RESULT_EVENT,
  isMermaidRenderRequest
} from "../services/mermaid-renderer-protocol.js";

function stableError(error) {
  return typeof error?.code === "string" ? error.code : "mermaid_render_failed";
}

export function MermaidRendererHost() {
  useEffect(() => {
    let disposed = false;
    const unsubscribePromise = listen(MERMAID_RENDER_REQUEST_EVENT, async ({ payload }) => {
      if (!isMermaidRenderRequest(payload)) return;
      const { requestId, source, language } = payload;
      try {
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
    };
  }, []);

  return <main aria-hidden="true" data-renderer="mermaid" />;
}
