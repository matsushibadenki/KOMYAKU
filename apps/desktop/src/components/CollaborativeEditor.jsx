import { useEffect, useRef, useState } from "react";
import {
  captureCollaborativeSelection,
  createCollaborativeEditorView,
  insertCollaborativeFile,
  insertCollaborativeImage,
  restoreCollaborativeSelection,
  redoCollaborativeEdit,
  undoCollaborativeEdit,
  updateCollaborativeImageAccessibility
} from "@komyaku/editor-core";
import { createStructuredPreviewNodeViews } from "./StructuredPreviewNodeView.jsx";
import { RichCaptionEditor } from "./RichCaptionEditor.jsx";
import { runEditorInsertion } from "../services/editor-insertion.js";
import { localImageInsertionAvailable, storeLocalPngForInsertion } from "../services/local-image-insertion.js";
import { prepareCloudPngInsertion } from "../services/cloud-image-insertion.js";
import { prepareCloudFileInsertion } from "../services/cloud-file-insertion.js";
import {
  createQuarantinedImageInsertion,
  listQuarantinedLocalAssets,
  localAssetQuarantineAvailable
} from "../services/local-asset-quarantine.js";

const ignorePackagedImageQaStatus = () => {};
const defaultInsertionGuard = () => () => true;
const DEFAULT_WORKSPACE = Object.freeze({ mode: "local" });

export function CollaborativeEditor({
  editorId,
  document,
  label,
  language,
  previewLabels,
  resolveImagePreview,
  workspace = DEFAULT_WORKSPACE,
  imageInsertionLabels,
  enableImageInsertion = false,
  enableImageAccessibilityEditing = false,
  packagedImageQa = false,
  onPackagedImageQaStatus = ignorePackagedImageQaStatus,
  selectionRef,
  onCompositionChange,
  onDocumentChange,
  showHistoryControls = false,
  captureInsertionGuard = defaultInsertionGuard,
  historyLabels
}) {
  const mountRef = useRef(null);
  const viewRef = useRef(null);
  const fileRef = useRef(null);
  const attachmentRef = useRef(null);
  const composingRef = useRef(false);
  const packagedImageQaStarted = useRef(false);
  const [altText, setAltText] = useState("");
  const [insertionStatus, setInsertionStatus] = useState("idle");
  const [fileInsertionStatus, setFileInsertionStatus] = useState("idle");
  const [selectedImage, setSelectedImage] = useState(null);
  const [accessibilityStatus, setAccessibilityStatus] = useState("idle");
  const [quarantine, setQuarantine] = useState({ status: "idle", assets: [], selectedId: null, altText: "" });

  useEffect(() => {
    setInsertionStatus("idle");
    setFileInsertionStatus("idle");
    setAltText("");
    setSelectedImage(null);
  }, [document, workspace]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const view = createCollaborativeEditorView(mount, document, {
      nodeViews: createStructuredPreviewNodeViews({
        language,
        labels: previewLabels,
        resolveImagePreview,
        onSelectImage: enableImageAccessibilityEditing ? (attrs) => {
          setSelectedImage({
            nodeId: attrs.nodeId,
            assetId: attrs.assetId,
            altText: attrs.altText,
            caption: attrs.caption ?? []
          });
          setAccessibilityStatus("idle");
        } : undefined
      }),
      onTransaction({ transaction }) {
        if (transaction.docChanged) onDocumentChange(editorId);
      }
    });
    viewRef.current = view;

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

    if (packagedImageQa && !packagedImageQaStarted.current) {
      packagedImageQaStarted.current = true;
      onPackagedImageQaStatus("running");
      void import("../services/packaged-image-qa.js")
        .then(({ runPackagedImageQa }) => runPackagedImageQa({ view, mount }))
        .then(onPackagedImageQaStatus)
        .catch((error) => onPackagedImageQaStatus(`failed-${error?.message ?? "unexpected"}`));
    }

    return () => {
      if (composingRef.current) onCompositionChange(editorId, false);
      selectionRef.current = captureCollaborativeSelection(view);
      view.dom.removeEventListener("compositionstart", startComposition);
      view.dom.removeEventListener("compositionend", finishComposition);
      view.dom.removeEventListener("blur", retainSelection);
      view.destroy();
      viewRef.current = null;
    };
  }, [document, editorId, enableImageAccessibilityEditing, label, language, onCompositionChange, onDocumentChange, onPackagedImageQaStatus, packagedImageQa, previewLabels, resolveImagePreview, selectionRef]);

  const saveImageAccessibility = (event) => {
    event.preventDefault();
    if (!selectedImage || !viewRef.current) return;
    try {
      updateCollaborativeImageAccessibility(viewRef.current, {
        ...selectedImage,
        caption: selectedImage.caption
      });
      setAccessibilityStatus("saved");
    } catch {
      setAccessibilityStatus("error");
    }
  };

  const insertImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !viewRef.current) return;
    const view = viewRef.current;
    const isCurrent = captureInsertionGuard();
    setInsertionStatus("saving");
    try {
      await runEditorInsertion({ view, getCurrentView: () => viewRef.current, isCurrent,
        prepare: async (assertCurrent) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          assertCurrent();
          return workspace.mode === "cloud"
            ? await prepareCloudPngInsertion({
                token: workspace.token, workspaceId: workspace.workspaceId,
                documentId: document.getMap("komyaku:document-metadata").get("documentId"), bytes, altText
              })
            : await storeLocalPngForInsertion({ bytes, altText });
        }, insert: insertCollaborativeImage });
      setAltText("");
      setInsertionStatus("ready");
    } catch {
      if (viewRef.current === view) setInsertionStatus("error");
    }
  };

  const insertFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !viewRef.current || workspace.mode !== "cloud") return;
    const view = viewRef.current;
    const isCurrent = captureInsertionGuard();
    setFileInsertionStatus("saving");
    try {
      await runEditorInsertion({ view, getCurrentView: () => viewRef.current, isCurrent,
        prepare: async (assertCurrent) => {
          const bytes = new Uint8Array(await file.arrayBuffer());
          assertCurrent();
          return prepareCloudFileInsertion({
            token: workspace.token,
            workspaceId: workspace.workspaceId,
            documentId: document.getMap("komyaku:document-metadata").get("documentId"),
            bytes,
            fileName: file.name,
            mediaType: file.type || "text/plain"
          });
        }, insert: insertCollaborativeFile });
      setFileInsertionStatus("ready");
    } catch {
      if (viewRef.current === view) setFileInsertionStatus("error");
    }
  };

  const loadQuarantine = async () => {
    setQuarantine((current) => ({ ...current, status: "loading" }));
    try {
      const assets = await listQuarantinedLocalAssets();
      setQuarantine({ status: "ready", assets, selectedId: null, altText: "" });
    } catch {
      setQuarantine((current) => ({ ...current, status: "error" }));
    }
  };

  const restoreQuarantinedAsset = (event) => {
    event.preventDefault();
    const asset = quarantine.assets.find(({ assetId }) => assetId === quarantine.selectedId);
    if (!asset || !viewRef.current) return;
    try {
      insertCollaborativeImage(viewRef.current, createQuarantinedImageInsertion(asset, quarantine.altText));
      setQuarantine((current) => ({
        status: "restored",
        assets: current.assets.filter(({ assetId }) => assetId !== asset.assetId),
        selectedId: null,
        altText: ""
      }));
    } catch {
      setQuarantine((current) => ({ ...current, status: "error" }));
    }
  };

  const insertionAvailable = enableImageInsertion && (workspace.mode === "cloud"
    ? Boolean(workspace.token && workspace.workspaceId)
    : localImageInsertionAvailable());
  return (
    <>
      {showHistoryControls ? (
        <div className="editor-history-controls" aria-label={historyLabels.label}>
          <button type="button" onClick={() => undoCollaborativeEdit(viewRef.current)}>{historyLabels.undo}</button>
          <button type="button" onClick={() => redoCollaborativeEdit(viewRef.current)}>{historyLabels.redo}</button>
          <span>{historyLabels.hint}</span>
        </div>
      ) : null}
      {enableImageInsertion ? (
        <div className="image-insertion" data-state={insertionStatus}>
          <label>
            <span>{imageInsertionLabels.altText}</span>
            <input
              type="text"
              value={altText}
              maxLength={1000}
              disabled={!insertionAvailable || insertionStatus === "saving"}
              placeholder={imageInsertionLabels.altPlaceholder}
              onChange={(event) => setAltText(event.target.value)}
            />
          </label>
          <input ref={fileRef} type="file" accept="image/png" hidden onChange={insertImage} />
          <button
            type="button"
            disabled={!insertionAvailable || !altText.trim() || insertionStatus === "saving"}
            onClick={() => fileRef.current?.click()}
          >
            {insertionStatus === "saving" ? imageInsertionLabels.saving : imageInsertionLabels.choose}
          </button>
          <span role="status">
            {!insertionAvailable
              ? workspace.mode === "cloud" ? imageInsertionLabels.cloudConnectionRequired : imageInsertionLabels.desktopOnly
              : insertionStatus === "ready"
                ? imageInsertionLabels.ready
                : insertionStatus === "error" ? imageInsertionLabels.error : imageInsertionLabels.limit}
          </span>
        </div>
      ) : null}
      {enableImageInsertion && workspace.mode === "cloud" ? (
        <div className="image-insertion file-insertion" data-state={fileInsertionStatus}>
          <input
            ref={attachmentRef}
            type="file"
            accept="text/plain,text/markdown,text/csv,text/vnd.mermaid,application/json,.txt,.md,.markdown,.csv,.json,.mmd"
            hidden
            onChange={insertFile}
          />
          <button
            type="button"
            disabled={!insertionAvailable || fileInsertionStatus === "saving"}
            onClick={() => attachmentRef.current?.click()}
          >
            {fileInsertionStatus === "saving" ? imageInsertionLabels.fileSaving : imageInsertionLabels.fileChoose}
          </button>
          <span role="status">
            {fileInsertionStatus === "ready" ? imageInsertionLabels.fileReady
              : fileInsertionStatus === "error" ? imageInsertionLabels.fileError
                : imageInsertionLabels.fileLimit}
          </span>
        </div>
      ) : null}
      {enableImageInsertion && workspace.mode === "local" ? (
        <section className="asset-quarantine" aria-labelledby={`${editorId}-asset-quarantine-title`}>
          <div className="asset-quarantine-heading">
            <div>
              <strong id={`${editorId}-asset-quarantine-title`}>{imageInsertionLabels.quarantineTitle}</strong>
              <span>{imageInsertionLabels.quarantineDescription}</span>
            </div>
            <button
              type="button"
              disabled={!localAssetQuarantineAvailable() || quarantine.status === "loading"}
              onClick={loadQuarantine}
            >
              {quarantine.status === "loading"
                ? imageInsertionLabels.quarantineLoading
                : imageInsertionLabels.quarantineOpen}
            </button>
          </div>
          {!localAssetQuarantineAvailable() ? <p>{imageInsertionLabels.desktopOnly}</p> : null}
          {quarantine.status === "ready" && quarantine.assets.length === 0
            ? <p role="status">{imageInsertionLabels.quarantineEmpty}</p> : null}
          {quarantine.assets.length > 0 ? (
            <ul className="asset-quarantine-list">
              {quarantine.assets.map((asset) => (
                <li key={asset.assetId}>
                  <button
                    type="button"
                    aria-pressed={quarantine.selectedId === asset.assetId}
                    onClick={() => setQuarantine((current) => ({
                      ...current,
                      selectedId: asset.assetId,
                      altText: "",
                      status: "ready"
                    }))}
                  >
                    <code>{asset.assetId}</code>
                    <span>{asset.width} × {asset.height} · {asset.byteSize.toLocaleString(language)} B</span>
                    <time dateTime={asset.quarantinedAt}>{new Date(asset.quarantinedAt).toLocaleString(language)}</time>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {quarantine.selectedId ? (
            <form className="asset-quarantine-restore" onSubmit={restoreQuarantinedAsset}>
              <label>
                <span>{imageInsertionLabels.recoveryAltText}</span>
                <input
                  required
                  maxLength={1000}
                  value={quarantine.altText}
                  placeholder={imageInsertionLabels.altPlaceholder}
                  onChange={(event) => setQuarantine((current) => ({ ...current, altText: event.target.value }))}
                />
              </label>
              <button type="submit" disabled={!quarantine.altText.trim()}>{imageInsertionLabels.restoreAsset}</button>
            </form>
          ) : null}
          <p role="status">
            {quarantine.status === "restored" ? imageInsertionLabels.assetRestored
              : quarantine.status === "error" ? imageInsertionLabels.quarantineError : ""}
          </p>
        </section>
      ) : null}
      {enableImageAccessibilityEditing && selectedImage ? (
        <form className="image-accessibility-editor" onSubmit={saveImageAccessibility}>
          <div className="image-accessibility-heading">
            <strong>{imageInsertionLabels.editTitle}</strong>
            <code>{selectedImage.assetId}</code>
          </div>
          <label>
            <span>{imageInsertionLabels.altText}</span>
            <textarea
              required
              maxLength={10000}
              value={selectedImage.altText}
              onChange={(event) => setSelectedImage((current) => ({ ...current, altText: event.target.value }))}
            />
          </label>
          <RichCaptionEditor
            caption={selectedImage.caption}
            labels={imageInsertionLabels}
            onChange={(caption) => setSelectedImage((current) => ({ ...current, caption }))}
          />
          <div className="image-accessibility-actions">
            <button type="submit" disabled={!selectedImage.altText.trim()}>{imageInsertionLabels.saveMetadata}</button>
            <button type="button" onClick={() => setSelectedImage(null)}>{imageInsertionLabels.closeEditor}</button>
            <span role="status">{accessibilityStatus === "saved"
              ? imageInsertionLabels.metadataSaved
              : accessibilityStatus === "error" ? imageInsertionLabels.metadataError : ""}</span>
          </div>
        </form>
      ) : null}
      <div ref={mountRef} className="editor-mount" data-editor-id={editorId} />
    </>
  );
}
