import { useEffect, useRef } from "react";
import {
  captureCollaborativeSelection,
  createCollaborativeEditorView,
  restoreCollaborativeSelection
} from "@komyaku/editor-core";

export function CollaborativeEditor({
  editorId,
  document,
  label,
  selectionRef,
  onCompositionChange,
  onDocumentChange
}) {
  const mountRef = useRef(null);
  const composingRef = useRef(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const view = createCollaborativeEditorView(mount, document, {
      onTransaction({ transaction }) {
        if (transaction.docChanged) onDocumentChange(editorId);
      }
    });

    const startComposition = () => {
      composingRef.current = true;
      onCompositionChange(editorId, true);
    };
    const finishComposition = () => {
      composingRef.current = false;
      onCompositionChange(editorId, false);
      onDocumentChange(editorId);
    };
    const retainSelection = () => {
      selectionRef.current = captureCollaborativeSelection(view);
    };

    view.dom.setAttribute("aria-label", label);
    view.dom.setAttribute("lang", document.getMap("komyaku:document-metadata").get("language") ?? "und");
    view.dom.addEventListener("compositionstart", startComposition);
    view.dom.addEventListener("compositionend", finishComposition);
    view.dom.addEventListener("blur", retainSelection);

    queueMicrotask(() => {
      if (!view.isDestroyed && selectionRef.current) {
        restoreCollaborativeSelection(view, selectionRef.current);
      }
    });

    return () => {
      if (composingRef.current) onCompositionChange(editorId, false);
      selectionRef.current = captureCollaborativeSelection(view);
      view.dom.removeEventListener("compositionstart", startComposition);
      view.dom.removeEventListener("compositionend", finishComposition);
      view.dom.removeEventListener("blur", retainSelection);
      view.destroy();
    };
  }, [document, editorId, label, onCompositionChange, onDocumentChange, selectionRef]);

  return <div ref={mountRef} className="editor-mount" data-editor-id={editorId} />;
}
