import { useEffect, useState } from "react";
import { MERMAID_PREVIEW_QA_TIMEOUT_SOURCE } from "../services/mermaid-renderer-protocol.js";
import { renderMermaidInIsolatedWebview } from "../services/mermaid-renderer.js";

export function PreviewQaRecoveryProbe() {
  const [status, setStatus] = useState("waiting-for-timeout");

  useEffect(() => {
    let disposed = false;
    void (async () => {
      try {
        await renderMermaidInIsolatedWebview(MERMAID_PREVIEW_QA_TIMEOUT_SOURCE, { language: "en" });
        if (!disposed) setStatus("unexpected-timeout-source-success");
        return;
      } catch (error) {
        if (error?.message !== "mermaid_render_timeout") {
          if (!disposed) setStatus(`unexpected-${error?.message ?? "error"}`);
          return;
        }
      }

      if (!disposed) setStatus("renderer-restarting");
      try {
        await renderMermaidInIsolatedWebview("flowchart LR\n  Timeout --> Restart --> Ready", {
          language: "en"
        });
        if (!disposed) setStatus("running-pressure");
        const { runMermaidPressureQa } = await import("../services/mermaid-pressure-qa.js");
        const pressureStatus = await runMermaidPressureQa(renderMermaidInIsolatedWebview);
        if (!disposed) setStatus(pressureStatus);
      } catch (error) {
        if (!disposed) setStatus(`recovery-failed-${error?.message ?? "error"}`);
      }
    })();
    return () => { disposed = true; };
  }, []);

  return (
    <aside className="preview-qa-probe" data-preview-qa-recovery={status} role="status">
      Preview QA recovery: {status}
    </aside>
  );
}
