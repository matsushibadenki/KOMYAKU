import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { SandboxedStaticPreview } from "./SandboxedStaticPreview.jsx";
import { renderMermaidInIsolatedWebview } from "../services/mermaid-renderer.js";
import { resolveLocalPngPreview } from "../services/local-image-preview.js";

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function MermaidPreview({ source, language, labels }) {
  const [state, setState] = useState(() => ({ status: "loading", descriptor: null, error: null }));

  useEffect(() => {
    let active = true;
    if (!isTauriRuntime()) {
      setState({ status: "unavailable", descriptor: null, error: null });
      return () => { active = false; };
    }
    setState({ status: "loading", descriptor: null, error: null });
    void renderMermaidInIsolatedWebview(source, { language })
      .then((descriptor) => {
        if (active) setState({ status: "ready", descriptor, error: null });
      })
      .catch((error) => {
        if (active) setState({ status: "error", descriptor: null, error: error?.message ?? "mermaid_render_failed" });
      });
    return () => { active = false; };
  }, [language, source]);

  if (state.status === "ready") {
    return <SandboxedStaticPreview descriptor={state.descriptor} title={labels.title} className="sandboxed-preview diagram-preview-frame" />;
  }
  return (
    <div className="diagram-preview-status" role="status" data-state={state.status}>
      <strong>{labels[state.status]}</strong>
      {state.error ? <code>{state.error}</code> : null}
    </div>
  );
}

function ImagePreview({ assetId, altText, language, labels, resolver }) {
  const [state, setState] = useState(() => ({ status: "loading", descriptor: null, error: null }));

  useEffect(() => {
    let active = true;
    setState({ status: "loading", descriptor: null, error: null });
    void resolver({ assetId, altText, language })
      .then((descriptor) => {
        if (active) setState({ status: "ready", descriptor, error: null });
      })
      .catch((error) => {
        if (active) setState({ status: "error", descriptor: null, error: error?.message ?? "image_preview_failed" });
      });
    return () => { active = false; };
  }, [altText, assetId, language, resolver]);

  if (state.status === "ready") {
    return <SandboxedStaticPreview descriptor={state.descriptor} title={labels.imageTitle} className="sandboxed-preview image-preview-frame" />;
  }
  return (
    <div className="diagram-preview-status image-preview-status" role="status" data-state={state.status}>
      <strong>{state.status === "loading" ? labels.imageLoading : labels.imageError}</strong>
      {state.error ? <code>{state.error}</code> : null}
    </div>
  );
}

export function createStructuredPreviewNodeViews({
  language,
  labels,
  resolveImagePreview = resolveLocalPngPreview,
  onSelectImage = () => {}
}) {
  return {
    diagram(node) {
      const dom = document.createElement("figure");
      dom.className = "komyaku-source-node structured-diagram-node";
      dom.dataset.nodeType = "diagram";
      dom.dataset.sourceType = node.attrs.sourceType;
      dom.contentEditable = "false";

      const source = document.createElement("pre");
      source.className = "structured-diagram-source";
      const previewMount = document.createElement("div");
      previewMount.className = "structured-diagram-preview";
      const root = createRoot(previewMount);
      dom.append(source, previewMount);

      function render(current) {
        source.textContent = current.attrs.source;
        if (current.attrs.sourceType === "mermaid") {
          root.render(<MermaidPreview source={current.attrs.source} language={language} labels={labels} />);
        } else {
          root.render(<div className="diagram-preview-status" role="status"><strong>{labels.unavailable}</strong></div>);
        }
      }
      render(node);

      return {
        dom,
        update(updated) {
          if (updated.type.name !== "diagram") return false;
          dom.dataset.sourceType = updated.attrs.sourceType;
          render(updated);
          return true;
        },
        stopEvent: () => true,
        destroy() {
          // ProseMirror may destroy this NodeView while React Strict Mode is
          // still completing its development render. Defer the nested root
          // teardown to avoid a synchronous cross-root unmount race.
          queueMicrotask(() => root.unmount());
        }
      };
    },
    image(node) {
      const dom = document.createElement("figure");
      dom.className = "komyaku-asset-node structured-image-node";
      dom.dataset.nodeType = "image";
      dom.contentEditable = "false";

      const identity = document.createElement("div");
      identity.className = "structured-image-identity";
      const alternative = document.createElement("div");
      alternative.className = "structured-image-alt-text";
      const caption = document.createElement("figcaption");
      caption.className = "structured-image-caption";
      const previewMount = document.createElement("div");
      previewMount.className = "structured-image-preview";
      const root = createRoot(previewMount);
      dom.tabIndex = 0;
      dom.append(identity, alternative, previewMount, caption);

      let currentNode = node;
      const selectImage = () => onSelectImage({ ...currentNode.attrs });
      dom.addEventListener("click", selectImage);
      dom.addEventListener("focus", selectImage);

      function render(current) {
        currentNode = current;
        identity.textContent = `${current.attrs.mediaType} · ${current.attrs.assetId}`;
        alternative.textContent = current.attrs.altText;
        dom.setAttribute("aria-label", current.attrs.altText || labels.imageTitle);
        caption.textContent = (current.attrs.caption ?? []).map((inline) => {
          if (inline.type === "text") return inline.text;
          if (inline.type === "hard_break") return "\n";
          return inline.source ?? "";
        }).join("");
        caption.hidden = caption.textContent.length === 0;
        root.render(<ImagePreview
          assetId={current.attrs.assetId}
          altText={current.attrs.altText}
          language={language}
          labels={labels}
          resolver={resolveImagePreview}
        />);
      }
      render(node);

      return {
        dom,
        update(updated) {
          if (updated.type.name !== "image") return false;
          render(updated);
          return true;
        },
        stopEvent: () => true,
        destroy() {
          dom.removeEventListener("click", selectImage);
          dom.removeEventListener("focus", selectImage);
          queueMicrotask(() => root.unmount());
        }
      };
    }
  };
}
