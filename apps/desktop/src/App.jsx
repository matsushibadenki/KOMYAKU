import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DOCUMENT_SCHEMA_ID, parseCanonicalDocument } from "@komyaku/document-schema";
import {
  createCanonicalCheckpoint,
  connectCollaborativeWorkingStates,
  createCollaborativeWorkingState,
  createEmptyCollaborativeWorkingState
} from "@komyaku/editor-core";
import { CollaborativeEditor } from "./components/CollaborativeEditor.jsx";
import { ConversationImportPanel } from "./components/ConversationImportPanel.jsx";
import { PreviewQaRecoveryProbe } from "./components/PreviewQaRecoveryProbe.jsx";
import { loadLocalDraft, saveLocalDraft } from "./services/local-database.js";
import { reconcileCloudDocumentAssets } from "./services/cloud-asset-reconciliation.js";
import { createVerifiedCloudDocumentExport } from "./services/cloud-document-export.js";
import { verifyLocalKomyakuImport } from "./services/local-komyaku-import.js";
import {
  createEditorImagePreviewResolver,
  LOCAL_EDITOR_WORKSPACE
} from "./services/editor-workspace-preview.js";

function id(number) {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

function createWelcomeDocument({ previewQa = false } = {}) {
  const qaDiagrams = previewQa ? [
    {
      id: id(4), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [],
      type: "diagram", sourceType: "mermaid",
      source: "flowchart LR\n  Draft[原稿] --> Review[確認]\n  Review --> Version[Version]",
      altText: "Preview QA valid diagram", caption: []
    },
    {
      id: id(5), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [],
      type: "diagram", sourceType: "mermaid",
      source: "flowchart LR\n  A -->",
      altText: "Preview QA malformed diagram", caption: []
    },
    {
      id: id(6), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [],
      type: "diagram", sourceType: "mermaid",
      source: "%%{init: {'securityLevel': 'loose'}}%%\nflowchart LR\nA-->B",
      altText: "Preview QA forbidden authored configuration", caption: []
    }
  ] : [];
  return parseCanonicalDocument({
    schemaId: DOCUMENT_SCHEMA_ID,
    schemaVersion: 1,
    id: id(1),
    type: "document",
    attrs: { language: "ja", direction: "auto", writingMode: "horizontal-tb" },
    metadata: { title: "KOMYAKU collaborative draft" },
    extensions: {},
    content: [
      {
        id: id(2), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [],
        type: "heading", attrs: { level: 1, lang: "ja", dir: "auto" },
        content: [{ type: "text", text: "稿脈を、同じ時間に書く。", marks: [], metadata: {}, extensions: {} }]
      },
      {
        id: id(3), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [],
        type: "paragraph", attrs: { lang: "ja", dir: "auto" },
        content: [{
          type: "text",
          text: "左右の編集欄は同じ文書です。片方を書き換えると、もう片方にも変更が届きます。",
          marks: [], metadata: {}, extensions: {}
        }]
      },
      ...qaDiagrams
    ]
  });
}

function createReplicas(document) {
  const local = createCollaborativeWorkingState(document);
  const second = createEmptyCollaborativeWorkingState();
  connectCollaborativeWorkingStates(local, second)();
  return { local, second };
}

function localPersistenceErrorCode(error) {
  const codes = [];
  let current = error;
  while (current && codes.length < 3) {
    if (typeof current.code === "string") codes.push(current.code);
    if (Array.isArray(current.issues) && current.issues[0]) {
      const issue = current.issues[0];
      const path = Array.isArray(issue.path) ? issue.path.join(".") : "unknown";
      codes.push(`schema_${issue.code}_${path}`);
    }
    current = current.cause;
  }
  return codes.length > 0 ? codes.join("/") : "unexpected_local_persistence_error";
}

export function App() {
  const { t, i18n } = useTranslation();
  const previewQa = new URLSearchParams(window.location.search).get("previewQa") === "1";
  const welcomeDocument = useMemo(() => createWelcomeDocument({ previewQa }), [previewQa]);
  const [replicas, setReplicas] = useState(null);
  const primarySelection = useRef(null);
  const secondarySelection = useRef(null);
  const composingEditors = useRef(new Set());
  const checkpointTimer = useRef(null);
  const checkpointSequence = useRef(0);
  const archiveImportRef = useRef(null);
  const localRevision = useRef(0);
  const persistenceQueue = useRef(Promise.resolve());
  const persistenceBlocked = useRef(false);
  const [secondaryConnected, setSecondaryConnected] = useState(true);
  const [checkpoint, setCheckpoint] = useState(null);
  const [checkpointStatus, setCheckpointStatus] = useState("pending");
  const [persistenceStatus, setPersistenceStatus] = useState("loading");
  const [persistenceErrorCode, setPersistenceErrorCode] = useState(null);
  const [editorWorkspace, setEditorWorkspace] = useState(LOCAL_EDITOR_WORKSPACE);
  const [cloudAssetStatus, setCloudAssetStatus] = useState("idle");
  const [documentExportStatus, setDocumentExportStatus] = useState("idle");
  const [archiveImportStatus, setArchiveImportStatus] = useState("idle");
  const [packagedImageQaStatus, setPackagedImageQaStatus] = useState("waiting");

  useEffect(() => {
    let cancelled = false;
    void loadLocalDraft(welcomeDocument.id)
      .then((draft) => {
        if (cancelled) return;
        localRevision.current = draft?.localRevision ?? 0;
        setReplicas(createReplicas(draft?.content ?? welcomeDocument));
        setPersistenceStatus(draft ? "restored" : "empty");
      })
      .catch((error) => {
        if (cancelled) return;
        persistenceBlocked.current = true;
        setPersistenceErrorCode(localPersistenceErrorCode(error));
        setReplicas(createReplicas(welcomeDocument));
        setPersistenceStatus("error");
      });
    return () => { cancelled = true; };
  }, [welcomeDocument]);

  const createCheckpoint = useCallback(async () => {
    if (!replicas) return;
    const sequence = ++checkpointSequence.current;
    setCheckpointStatus("saving");
    try {
      const nextCheckpoint = await createCanonicalCheckpoint(replicas.local);
      if (sequence !== checkpointSequence.current) return;
      if (!persistenceBlocked.current) {
        const persistence = persistenceQueue.current.then(async () => {
          const nextRevision = localRevision.current + 1;
          await saveLocalDraft({
            documentId: nextCheckpoint.document.id,
            schemaVersion: nextCheckpoint.document.schemaVersion,
            content: nextCheckpoint.document,
            contentJson: nextCheckpoint.json,
            localRevision: nextRevision
          });
          localRevision.current = nextRevision;
          if (editorWorkspace.mode === "cloud") {
            setCloudAssetStatus("saving");
            try {
              await reconcileCloudDocumentAssets({
                token: editorWorkspace.token,
                workspaceId: editorWorkspace.workspaceId,
                document: nextCheckpoint.document,
                revision: nextRevision
              });
              setCloudAssetStatus("ready");
            } catch {
              setCloudAssetStatus("error");
            }
          }
        });
        persistenceQueue.current = persistence.catch(() => {});
        await persistence;
        if (sequence !== checkpointSequence.current) return;
        setPersistenceStatus("saved");
      }
      setCheckpoint({ ...nextCheckpoint, createdAt: new Date() });
      setCheckpointStatus("ready");
      return true;
    } catch (error) {
      if (sequence === checkpointSequence.current) {
        persistenceBlocked.current = true;
        setPersistenceErrorCode(localPersistenceErrorCode(error));
        setPersistenceStatus("error");
        setCheckpointStatus("error");
      }
      return false;
    }
  }, [editorWorkspace, replicas]);

  const scheduleCheckpoint = useCallback(() => {
    if (composingEditors.current.size > 0) return;
    if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
    setCheckpointStatus("pending");
    checkpointTimer.current = window.setTimeout(() => {
      checkpointTimer.current = null;
      void createCheckpoint();
    }, 450);
  }, [createCheckpoint]);

  const exportDocument = async () => {
    if (editorWorkspace.mode !== "cloud" || !checkpoint?.document) return;
    setDocumentExportStatus("saving");
    try {
      await createVerifiedCloudDocumentExport({
        token: editorWorkspace.token, workspaceId: editorWorkspace.workspaceId,
        document: checkpoint.document
      });
      setDocumentExportStatus("ready");
    } catch {
      setDocumentExportStatus("error");
    }
  };

  const importArchive = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setArchiveImportStatus("loading");
    try {
      const imported = await verifyLocalKomyakuImport(new Uint8Array(await file.arrayBuffer()));
      const existing = await loadLocalDraft(imported.document.id);
      localRevision.current = existing?.localRevision ?? 0;
      persistenceBlocked.current = false;
      setReplicas(createReplicas(imported.document));
      setArchiveImportStatus("ready");
    } catch {
      setArchiveImportStatus("error");
    }
  };

  const handlePackagedImageQaStatus = useCallback((status) => {
    if (status !== "inserted") {
      setPackagedImageQaStatus(status);
      return;
    }
    if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
    checkpointTimer.current = null;
    setPackagedImageQaStatus("saving");
    void createCheckpoint().then((saved) => {
      setPackagedImageQaStatus(saved ? "inserted-durable" : "failed-durable-checkpoint");
    });
  }, [createCheckpoint]);

  const handleCompositionChange = useCallback((editorId, isComposing) => {
    if (isComposing) {
      composingEditors.current.add(editorId);
      if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
      checkpointTimer.current = null;
      setCheckpointStatus("composing");
      return;
    }
    composingEditors.current.delete(editorId);
    scheduleCheckpoint();
  }, [scheduleCheckpoint]);

  const handleDocumentChange = useCallback(() => scheduleCheckpoint(), [scheduleCheckpoint]);

  useEffect(() => {
    if (!replicas) return undefined;
    void createCheckpoint();
    return () => {
      if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
    };
  }, [createCheckpoint]);

  useEffect(() => {
    if (!replicas || !secondaryConnected) return undefined;
    return connectCollaborativeWorkingStates(replicas.local, replicas.second);
  }, [replicas, secondaryConnected]);

  function changeLocale(event) {
    const locale = event.target.value;
    void i18n.changeLanguage(locale);
    document.documentElement.lang = locale;
  }

  const checkpointTime = checkpoint?.createdAt
    ? new Intl.DateTimeFormat(i18n.resolvedLanguage, {
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).format(checkpoint.createdAt)
    : "—";
  const previewLabels = useMemo(() => ({
    title: t("structuredPreview.mermaidTitle"),
    loading: t("structuredPreview.loading"),
    unavailable: t("structuredPreview.unavailable"),
    error: t("structuredPreview.error"),
    imageTitle: t("structuredPreview.imageTitle"),
    imageLoading: t("structuredPreview.imageLoading"),
    imageError: t("structuredPreview.imageError")
  }), [t]);
  const resolveImagePreview = useMemo(
    () => createEditorImagePreviewResolver(editorWorkspace),
    [editorWorkspace]
  );
  const handleWorkspaceSessionChange = useCallback((nextWorkspace) => {
    setEditorWorkspace((current) => {
      if (
        current.mode === nextWorkspace.mode &&
        current.token === nextWorkspace.token &&
        current.workspaceId === nextWorkspace.workspaceId
      ) return current;
      return nextWorkspace.mode === "cloud"
        ? Object.freeze({
          mode: "cloud",
          token: nextWorkspace.token,
          workspaceId: nextWorkspace.workspaceId
        })
        : LOCAL_EDITOR_WORKSPACE;
    });
  }, []);

  if (!replicas) {
    return (
      <main className="app-shell loading-shell" aria-busy="true">
        <p className="wordmark">KOMYAKU <span aria-hidden="true">/</span> 稿脈</p>
        <h1>{t("recovery.loading")}</h1>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <p className="wordmark">KOMYAKU <span aria-hidden="true">/</span> 稿脈</p>
          <h1>
            <span className="meaning-line">{t("app.titleLead")}</span>{" "}
            <span className="meaning-line">{t("app.titleClose")}</span>
          </h1>
        </div>
        <label className="locale-control">
          <span>{t("settings.language")}</span>
          <select value={i18n.resolvedLanguage} onChange={changeLocale}>
            <option value="ja">日本語</option>
            <option value="en">English</option>
            <option value="zh-Hans">简体中文</option>
          </select>
        </label>
      </header>

      <section className="workbench" aria-labelledby="workbench-title">
        <div className="workbench-heading">
          <div>
            <h2 id="workbench-title">{t("collaboration.title")}</h2>
            <p>{t("collaboration.description")}</p>
          </div>
          <button
            type="button"
            className="connection-button"
            data-state={secondaryConnected ? "success" : "default"}
            aria-pressed={secondaryConnected}
            onClick={() => setSecondaryConnected((connected) => !connected)}
          >
            <span className="connection-mark" aria-hidden="true" />
            {secondaryConnected ? t("collaboration.disconnect") : t("collaboration.reconnect")}
          </button>
        </div>

        <div className="editor-grid">
          <article className="editor-panel">
            <header className="editor-panel-heading">
              <h3>{t("collaboration.localEditor")}</h3>
              <span>{t("collaboration.connected")}</span>
            </header>
            <CollaborativeEditor
              editorId="local"
              enableImageInsertion
              enableImageAccessibilityEditing
              packagedImageQa={previewQa}
              onPackagedImageQaStatus={handlePackagedImageQaStatus}
              document={replicas.local}
              label={t("collaboration.localEditorLabel")}
              language={i18n.resolvedLanguage}
              previewLabels={previewLabels}
              resolveImagePreview={resolveImagePreview}
              workspace={editorWorkspace}
              imageInsertionLabels={{
                altText: t("imageInsertion.altText"),
                altPlaceholder: t("imageInsertion.altPlaceholder"),
                choose: t("imageInsertion.choose"),
                saving: t("imageInsertion.saving"),
                desktopOnly: t("imageInsertion.desktopOnly"),
                cloudConnectionRequired: t("imageInsertion.cloudConnectionRequired"),
                ready: t("imageInsertion.ready"),
                error: t("imageInsertion.error"),
                limit: t("imageInsertion.limit"),
                fileChoose: t("imageInsertion.fileChoose"),
                fileSaving: t("imageInsertion.fileSaving"),
                fileReady: t("imageInsertion.fileReady"),
                fileError: t("imageInsertion.fileError"),
                fileLimit: t("imageInsertion.fileLimit"),
                editTitle: t("imageInsertion.editTitle"),
                caption: t("imageInsertion.caption"),
                captionEmpty: t("imageInsertion.captionEmpty"),
                captionTextSegment: t("imageInsertion.captionTextSegment"),
                captionMathSegment: t("imageInsertion.captionMathSegment"),
                captionLineBreak: t("imageInsertion.captionLineBreak"),
                textFormatting: t("imageInsertion.textFormatting"),
                latexSource: t("imageInsertion.latexSource"),
                addText: t("imageInsertion.addText"),
                addMath: t("imageInsertion.addMath"),
                addLineBreak: t("imageInsertion.addLineBreak"),
                moveUp: t("imageInsertion.moveUp"),
                moveDown: t("imageInsertion.moveDown"),
                removeSegment: t("imageInsertion.removeSegment"),
                marks: {
                  bold: t("imageInsertion.marks.bold"),
                  italic: t("imageInsertion.marks.italic"),
                  underline: t("imageInsertion.marks.underline"),
                  strike: t("imageInsertion.marks.strike"),
                  code: t("imageInsertion.marks.code")
                },
                saveMetadata: t("imageInsertion.saveMetadata"),
                closeEditor: t("imageInsertion.closeEditor"),
                metadataSaved: t("imageInsertion.metadataSaved"),
                metadataError: t("imageInsertion.metadataError"),
                quarantineTitle: t("imageInsertion.quarantineTitle"),
                quarantineDescription: t("imageInsertion.quarantineDescription"),
                quarantineOpen: t("imageInsertion.quarantineOpen"),
                quarantineLoading: t("imageInsertion.quarantineLoading"),
                quarantineEmpty: t("imageInsertion.quarantineEmpty"),
                recoveryAltText: t("imageInsertion.recoveryAltText"),
                restoreAsset: t("imageInsertion.restoreAsset"),
                assetRestored: t("imageInsertion.assetRestored"),
                quarantineError: t("imageInsertion.quarantineError")
              }}
              selectionRef={primarySelection}
              onCompositionChange={handleCompositionChange}
              onDocumentChange={handleDocumentChange}
            />
          </article>

          <article className="editor-panel" data-state={secondaryConnected ? "connected" : "disconnected"}>
            <header className="editor-panel-heading">
              <h3>{t("collaboration.secondEditor")}</h3>
              <span>{secondaryConnected ? t("collaboration.connected") : t("collaboration.disconnected")}</span>
            </header>
            {secondaryConnected ? (
              <CollaborativeEditor
                editorId="second"
                document={replicas.second}
                label={t("collaboration.secondEditorLabel")}
                language={i18n.resolvedLanguage}
                previewLabels={previewLabels}
                resolveImagePreview={resolveImagePreview}
                selectionRef={secondarySelection}
                onCompositionChange={handleCompositionChange}
                onDocumentChange={handleDocumentChange}
              />
            ) : (
              <div className="offline-state" role="status">
                <p>{t("collaboration.offlineMessage")}</p>
                <span>{t("collaboration.offlineDetail")}</span>
              </div>
            )}
          </article>
        </div>
      </section>

      <ConversationImportPanel onWorkspaceSessionChange={handleWorkspaceSessionChange} />

      {previewQa ? <PreviewQaRecoveryProbe /> : null}
      {previewQa ? (
        <aside className="preview-qa-probe" data-preview-qa-image={packagedImageQaStatus} role="status">
          Preview QA image: {packagedImageQaStatus}
        </aside>
      ) : null}

      <aside className="checkpoint-strip" aria-live="polite">
        <div>
          <span className="checkpoint-label">{t("checkpoint.label")}</span>
          <strong>{t(`checkpoint.${checkpointStatus}`)}</strong>
        </div>
        <dl>
          <div><dt>{t("checkpoint.time")}</dt><dd>{checkpointTime}</dd></div>
          <div><dt>{t("checkpoint.size")}</dt><dd>{checkpoint ? `${checkpoint.byteLength.toLocaleString(i18n.resolvedLanguage)} B` : "—"}</dd></div>
          <div><dt>{t("checkpoint.hash")}</dt><dd>{checkpoint ? checkpoint.hash.slice(0, 12) : "—"}</dd></div>
        </dl>
        {editorWorkspace.mode === "cloud" ? (
          <div>
            <p className="persistence-status" role="status" data-state={cloudAssetStatus}>
              {t(`cloudAssets.${cloudAssetStatus}`)}
            </p>
            <button type="button" disabled={!checkpoint || documentExportStatus === "saving"} onClick={exportDocument}>
              {documentExportStatus === "saving" ? t("documentExport.saving") : t("documentExport.create")}
            </button>
            <p className="persistence-status" role="status" data-state={documentExportStatus}>
              {t(`documentExport.${documentExportStatus}`)}
            </p>
          </div>
        ) : null}
        <div>
          <input ref={archiveImportRef} type="file" accept=".komyaku,application/vnd.komyaku.archive+zip" hidden onChange={importArchive} />
          <button type="button" disabled={archiveImportStatus === "loading"} onClick={() => archiveImportRef.current?.click()}>
            {archiveImportStatus === "loading" ? t("archiveImport.loading") : t("archiveImport.choose")}
          </button>
          <p className="persistence-status" role="status" data-state={archiveImportStatus}>
            {t(`archiveImport.${archiveImportStatus}`)}
          </p>
        </div>
      </aside>

      <footer className="app-footer">
        <p>{t("collaboration.privacy")}</p>
        <p className="persistence-status" role="status" data-state={persistenceStatus}>
          {t(`recovery.${persistenceStatus}`)}
          {persistenceErrorCode ? ` ${t("recovery.errorCode")}: ${persistenceErrorCode}` : ""}
        </p>
      </footer>
    </main>
  );
}
