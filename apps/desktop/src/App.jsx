import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createEmptyDocument, DOCUMENT_SCHEMA_ID, parseCanonicalDocument } from "@komyaku/document-schema";
import {
  createCanonicalCheckpoint,
  connectCollaborativeWorkingStates,
  createCollaborativeWorkingState,
  createEmptyCollaborativeWorkingState
} from "@komyaku/editor-core";
import { CollaborativeEditor } from "./components/CollaborativeEditor.jsx";
import { ConversationImportPanel } from "./components/ConversationImportPanel.jsx";
import { PreviewQaRecoveryProbe } from "./components/PreviewQaRecoveryProbe.jsx";
import { LocalDocumentLibrary } from "./components/LocalDocumentLibrary.jsx";
import { LocalVersionHistory } from "./components/LocalVersionHistory.jsx";
import { runCheckpointedExport } from "./services/checkpointed-export.js";
import { createLocalMutationGate } from "./services/local-mutation-gate.js";
import { loadLocalDraft, saveLocalDraft } from "./services/local-database.js";
import { reconcileCloudDocumentAssets } from "./services/cloud-asset-reconciliation.js";
import { createVerifiedCloudDocumentExport } from "./services/cloud-document-export.js";
import { LocalArchiveImportConflictError, materializeLocalKomyakuImport } from "./services/local-komyaku-import.js";
import { materializeCloudKomyakuImport } from "./services/cloud-komyaku-import.js";
import { listLocalDocuments, mutateLocalDocument } from "./services/local-document-library.js";
import {
  createVerifiedLocalSnapshotExport,
  downloadLocalExport,
  localExportFileName,
  renderLocalDocumentExport
} from "./services/local-document-export.js";
import {
  createLocalEditSession,
  prepareLocalEditTransition
} from "./services/local-edit-session.js";
import {
  createLocalDocumentVersion,
  compareLocalDocumentVersions,
  getOrCreateLocalVersionAuthorId,
  loadLocalVersionAssets,
  loadLocalVersionSnapshot,
  listLocalVersionHistory,
  localVersionHistoryAvailable,
  restoreLocalDocumentVersion
} from "./services/local-version-history.js";
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
  const query = new URLSearchParams(window.location.search);
  const previewQa = query.get("previewQa") === "1";
  const developmentWorkbench = previewQa || query.get("workbench") === "1";
  const welcomeDocument = useMemo(() => createWelcomeDocument({ previewQa }), [previewQa]);
  const [replicas, setReplicas] = useState(null);
  const primarySelection = useRef(null);
  const secondarySelection = useRef(null);
  const composingEditors = useRef(new Set());
  const checkpointTimer = useRef(null);
  const checkpointSequence = useRef(0);
  const editGeneration = useRef(0);
  const mutationGeneration = useRef(0);
  const [mutationBusy, setMutationBusy] = useState(false);
  const mutationFocus = useRef(null);
  const mutationGate = useRef(null);
  if (!mutationGate.current) mutationGate.current = createLocalMutationGate((busy) => {
    if (busy) {
      mutationGeneration.current += 1;
      const focused = document.activeElement;
      mutationFocus.current = focused?.closest("main") ? {
        target: focused, fallback: focused.closest("section")?.querySelector('h2[tabindex="-1"]')
      } : null;
    }
    setMutationBusy(busy);
  });
  useLayoutEffect(() => {
    if (mutationBusy) return;
    const savedFocus = mutationFocus.current;
    mutationFocus.current = null;
    // Restore only after React removes inert, and never steal focus from a
    // control the user selected outside the locked workspace.
    const frame = requestAnimationFrame(() => {
      const target = savedFocus?.target?.isConnected ? savedFocus.target : savedFocus?.fallback;
      const active = document.activeElement;
      if (target?.isConnected && (active === document.body || active === document.documentElement
        || active?.closest("main"))) target.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [mutationBusy]);
  const archiveImportRef = useRef(null);
  const replicasRef = useRef(null);
  const editSession = useRef(null);
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
  const [localDocuments, setLocalDocuments] = useState([]);
  const [versionHistory, setVersionHistory] = useState(null);
  const [versionStatus, setVersionStatus] = useState("idle");
  const [localExportStatus, setLocalExportStatus] = useState("idle");
  const [versionComparison, setVersionComparison] = useState(null);
  const [comparisonStatus, setComparisonStatus] = useState("idle");
  const [archiveImportConflict, setArchiveImportConflict] = useState(null);
  const historyReadSequence = useRef(0);
  const comparisonReadSequence = useRef(0);
  const libraryReadSequence = useRef(0);

  const refreshLocalDocuments = useCallback(async () => {
    const sequence = ++libraryReadSequence.current;
    try {
      const documents = await listLocalDocuments();
      if (sequence === libraryReadSequence.current) setLocalDocuments(documents);
    } catch {
      if (sequence === libraryReadSequence.current) setLocalDocuments([]);
    }
  }, []);

  const refreshVersionHistory = useCallback(async (documentId) => {
    const session = editSession.current;
    if (session?.documentId !== documentId) return null;
    const sequence = ++historyReadSequence.current;
    const isCurrent = () => editSession.current === session && sequence === historyReadSequence.current;
    setVersionStatus("loading");
    try {
      const history = await listLocalVersionHistory(documentId);
      if (!isCurrent()) return null;
      setVersionHistory(history);
      setVersionStatus("ready");
      return history;
    } catch {
      if (!isCurrent()) return null;
      setVersionHistory(null);
      setVersionStatus("error");
      return null;
    }
  }, []);

  const replaceWorkingDocument = useCallback((document, localRevision) => {
    if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
    checkpointTimer.current = null;
    const nextReplicas = createReplicas(document);
    replicasRef.current = nextReplicas;
    editSession.current = createLocalEditSession({ documentId: document.id, localRevision });
    setReplicas(nextReplicas);
    setCheckpoint(null);
    setCheckpointStatus("pending");
    setPersistenceErrorCode(null);
    setVersionHistory(null);
    setVersionStatus("idle");
    setVersionComparison(null);
    setComparisonStatus("idle");
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadLocalDraft(welcomeDocument.id)
      .then((draft) => {
        if (cancelled) return;
        replaceWorkingDocument(draft?.content ?? welcomeDocument, draft?.localRevision ?? 0);
        setPersistenceStatus(draft ? "restored" : "empty");
      })
      .catch((error) => {
        if (cancelled) return;
        replaceWorkingDocument(welcomeDocument, 0);
        editSession.current.block(error);
        setPersistenceErrorCode(localPersistenceErrorCode(error));
        setPersistenceStatus("error");
      });
    return () => { cancelled = true; };
  }, [replaceWorkingDocument, welcomeDocument]);

  useEffect(() => { void refreshLocalDocuments(); }, [refreshLocalDocuments]);

  useEffect(() => {
    const documentId = checkpoint?.durable ? checkpoint.document.id : null;
    if (editorWorkspace.mode === "local" && documentId) void refreshVersionHistory(documentId);
  }, [checkpoint?.document?.id, checkpoint?.durable, editorWorkspace.mode, refreshVersionHistory]);

  const createCheckpoint = useCallback(async ({ retry = false } = {}) => {
    const sourceReplicas = replicasRef.current;
    const session = editSession.current;
    if (!sourceReplicas || !session) return null;
    const sequence = ++checkpointSequence.current;
    setCheckpointStatus("saving");
    try {
      const saved = await session.enqueue(async (nextRevision) => {
        // Queue preparation as well as persistence: hash completion order must
        // never let an older snapshot receive a newer revision.
        const nextCheckpoint = await createCanonicalCheckpoint(sourceReplicas.local);
        if (editSession.current === session && sequence === checkpointSequence.current) {
          setCheckpoint({ ...nextCheckpoint, createdAt: new Date(), durable: false, revision: null });
          setPersistenceStatus("saving");
        }
        await saveLocalDraft({
          documentId: nextCheckpoint.document.id,
          schemaVersion: nextCheckpoint.document.schemaVersion,
          content: nextCheckpoint.document,
          contentJson: nextCheckpoint.json,
          localRevision: nextRevision
        });
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
        return nextCheckpoint;
      }, { retry });
      const durableCheckpoint = {
        ...saved.result,
        createdAt: new Date(),
        durable: true,
        revision: saved.revision
      };
      if (editSession.current === session && sequence === checkpointSequence.current) {
        setCheckpoint(durableCheckpoint);
        setPersistenceStatus("saved");
        setPersistenceErrorCode(null);
        setCheckpointStatus("ready");
        void refreshLocalDocuments();
      }
      return durableCheckpoint;
    } catch (error) {
      if (editSession.current === session && sequence === checkpointSequence.current) {
        setPersistenceErrorCode(localPersistenceErrorCode(error));
        setPersistenceStatus("error");
        setCheckpointStatus("error");
      }
      return null;
    }
  }, [editorWorkspace, refreshLocalDocuments]);

  const scheduleCheckpoint = useCallback(() => {
    if (composingEditors.current.size > 0) return;
    if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
    setCheckpointStatus("pending");
    setPersistenceStatus("pending");
    checkpointTimer.current = window.setTimeout(() => {
      checkpointTimer.current = null;
      void createCheckpoint();
    }, 450);
  }, [createCheckpoint]);

  const prepareForDocumentTransition = useCallback(async () => {
    const session = editSession.current;
    const generation = editGeneration.current;
    const mutation = mutationGeneration.current;
    const isCurrent = () => editSession.current === session
      && editGeneration.current === generation && composingEditors.current.size === 0
      && mutationGeneration.current === mutation;
    const prepared = await prepareLocalEditTransition({
      isComposing: composingEditors.current.size > 0,
      cancelScheduledSave: () => {
        if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
        checkpointTimer.current = null;
      },
      save: () => createCheckpoint(),
      isCurrent
    });
    if (prepared.reason === "composition_active") {
      setCheckpointStatus("composing");
    }
    return prepared.ok ? { checkpoint: prepared.checkpoint, isCurrent } : null;
  }, [createCheckpoint]);

  const runDocumentMutation = useCallback((operation) => {
    if (composingEditors.current.size > 0) {
      setCheckpointStatus("composing");
      return Promise.resolve(false);
    }
    return mutationGate.current.run(operation);
  }, []);

  const captureInsertionGuard = useCallback(() => {
    const session = editSession.current;
    const mutation = mutationGeneration.current;
    return () => editSession.current === session && mutationGeneration.current === mutation
      && !mutationGate.current.busy && composingEditors.current.size === 0;
  }, []);

  const exportDocument = async () => {
    if (editorWorkspace.mode !== "cloud") return;
    setDocumentExportStatus("saving");
    try {
      await runCheckpointedExport({
        prepare: prepareForDocumentTransition,
        build: async (checkpoint) => checkpoint.document,
        deliver: (document) => createVerifiedCloudDocumentExport({
          token: editorWorkspace.token, workspaceId: editorWorkspace.workspaceId, document
        })
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
    setArchiveImportConflict(null);
    try {
      const canAdopt = await prepareForDocumentTransition();
      if (!canAdopt) throw new Error("local_save_required");
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!canAdopt.isCurrent()) throw new Error("local_edit_changed");
      const imported = editorWorkspace.mode === "cloud"
        ? await materializeCloudKomyakuImport({
          token: editorWorkspace.token, workspaceId: editorWorkspace.workspaceId, bytes
        })
        : await materializeLocalKomyakuImport(bytes);
      const existing = await loadLocalDraft(imported.document.id);
      void refreshLocalDocuments();
      if (!canAdopt.isCurrent()) throw new Error("local_edit_changed");
      replaceWorkingDocument(imported.document, existing?.localRevision ?? 0);
      setArchiveImportStatus("ready");
      void refreshLocalDocuments();
    } catch (error) {
      if (error instanceof LocalArchiveImportConflictError) {
        setArchiveImportConflict({ bytes: new Uint8Array(await file.arrayBuffer()), documentId: error.documentId });
        setArchiveImportStatus("conflict");
      } else setArchiveImportStatus("error");
    }
  };

  const resolveArchiveConflict = async (choice) => {
    const conflict = archiveImportConflict;
    if (!conflict) return;
    setArchiveImportStatus("loading");
    try {
      if (choice === "open") {
        if (!await openLocalDocument(conflict.documentId)) throw new Error("local_save_required");
      }
      else {
        const canAdopt = await prepareForDocumentTransition();
        if (!canAdopt) throw new Error("local_save_required");
        const imported = await materializeLocalKomyakuImport(conflict.bytes, { copy: true });
        void refreshLocalDocuments();
        if (!canAdopt.isCurrent()) throw new Error("local_edit_changed");
        replaceWorkingDocument(imported.document, 1);
      }
      setArchiveImportConflict(null);
      setArchiveImportStatus("ready");
      await refreshLocalDocuments();
    } catch { setArchiveImportStatus("error"); }
  };

  const openLocalDocument = async (documentId) => {
    try {
      if (documentId === editSession.current?.documentId) return true;
      const canAdopt = await prepareForDocumentTransition();
      if (!canAdopt) return false;
      const draft = await loadLocalDraft(documentId);
      if (!draft || !canAdopt.isCurrent()) return false;
      replaceWorkingDocument(draft.content, draft.localRevision);
      setPersistenceStatus("restored");
      return true;
    } catch (error) {
      setPersistenceErrorCode(localPersistenceErrorCode(error));
      setPersistenceStatus("error");
      return false;
    }
  };

  const renameLocalDocument = (documentId, title) => runDocumentMutation(async () => {
    try {
      const active = documentId === editSession.current?.documentId;
      if (active && !await prepareForDocumentTransition()) return false;
      await mutateLocalDocument({ documentId, title: String(title) });
      if (active) {
        const draft = await loadLocalDraft(documentId);
        if (!draft) throw new Error("local_document_not_found");
        replaceWorkingDocument(draft.content, draft.localRevision);
        setPersistenceStatus("saved");
      }
      await refreshLocalDocuments();
      return true;
    } catch (error) {
      setPersistenceErrorCode(localPersistenceErrorCode(error));
      setPersistenceStatus("error");
      return false;
    }
  });

  const archiveLocalDocument = (documentId, archived) => runDocumentMutation(async () => {
    try {
      if (documentId === editSession.current?.documentId && !await prepareForDocumentTransition()) return false;
      await mutateLocalDocument({ documentId, archived });
      await refreshLocalDocuments();
      return true;
    } catch (error) {
      setPersistenceErrorCode(localPersistenceErrorCode(error));
      setPersistenceStatus("error");
      return false;
    }
  });

  const handlePackagedImageQaStatus = useCallback((status) => {
    if (status !== "inserted") {
      setPackagedImageQaStatus(status);
      return;
    }
    if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
    checkpointTimer.current = null;
    setPackagedImageQaStatus("saving");
    void createCheckpoint().then((savedCheckpoint) => {
      setPackagedImageQaStatus(savedCheckpoint ? "inserted-durable" : "failed-durable-checkpoint");
    });
  }, [createCheckpoint]);

  const handleCompositionChange = useCallback((editorId, isComposing) => {
    if (isComposing) {
      editGeneration.current += 1;
      checkpointSequence.current += 1;
      composingEditors.current.add(editorId);
      if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
      checkpointTimer.current = null;
      setCheckpointStatus("composing");
      setPersistenceStatus((status) => status === "error" ? "error" : "pending");
      return;
    }
    composingEditors.current.delete(editorId);
    scheduleCheckpoint();
  }, [scheduleCheckpoint]);

  const handleDocumentChange = useCallback(() => {
    editGeneration.current += 1;
    // A checkpoint captured before this edit cannot announce the draft as saved.
    checkpointSequence.current += 1;
    scheduleCheckpoint();
  }, [scheduleCheckpoint]);

  const createVersion = useCallback(({ kind, label = null, branchName = null }) => runDocumentMutation(async () => {
    if (editorWorkspace.mode !== "local" || !localVersionHistoryAvailable()) return false;
    setVersionStatus("saving");
    try {
      const prepared = await prepareForDocumentTransition();
      if (!prepared) throw new Error("durable_checkpoint_required");
      const savedCheckpoint = prepared.checkpoint;
      const history = await listLocalVersionHistory(savedCheckpoint.document.id);
      if (!prepared.isCurrent()) throw new Error("local_edit_changed");
      await createLocalDocumentVersion({
        document: savedCheckpoint.document, history,
        authorId: getOrCreateLocalVersionAuthorId(), kind, label, branchName
      });
      await refreshVersionHistory(savedCheckpoint.document.id);
      return true;
    } catch {
      setVersionStatus("error");
      return false;
    }
  }), [runDocumentMutation, prepareForDocumentTransition, editorWorkspace.mode, refreshVersionHistory]);

  const restoreVersion = useCallback((targetVersionId) => runDocumentMutation(async () => {
    if (editorWorkspace.mode !== "local" || !localVersionHistoryAvailable()) return false;
    setVersionStatus("saving");
    try {
      const prepared = await prepareForDocumentTransition();
      const savedCheckpoint = prepared?.checkpoint;
      if (!savedCheckpoint?.durable || !Number.isSafeInteger(savedCheckpoint.revision)) {
        throw new Error("durable_checkpoint_required");
      }
      const history = await listLocalVersionHistory(savedCheckpoint.document.id);
      if (!prepared.isCurrent()) throw new Error("local_edit_changed");
      const restored = await restoreLocalDocumentVersion({
        documentId: savedCheckpoint.document.id, targetVersionId, history,
        authorId: getOrCreateLocalVersionAuthorId(), localRevision: savedCheckpoint.revision,
        label: t("versionHistory.restoredLabel")
      });
      replaceWorkingDocument(restored.document, restored.localRevision);
      setPersistenceStatus("restored");
      await refreshVersionHistory(restored.document.id);
      return true;
    } catch {
      setVersionStatus("error");
      return false;
    }
  }), [runDocumentMutation, prepareForDocumentTransition, editorWorkspace.mode, refreshVersionHistory, replaceWorkingDocument, t]);

  const exportLocalDocument = useCallback(async (format) => {
    setLocalExportStatus("saving");
    try {
      const exported = await runCheckpointedExport({
        prepare: prepareForDocumentTransition,
        build: async (savedCheckpoint) => {
          let exported;
          let exportedDocument = savedCheckpoint.document;
          if (format === "komyaku") {
            const history = await listLocalVersionHistory(savedCheckpoint.document.id);
            if (!history.currentVersionId) throw new Error("local_version_not_found");
            const [snapshot, assets] = await Promise.all([
              loadLocalVersionSnapshot({ documentId: history.documentId, versionId: history.currentVersionId }),
              loadLocalVersionAssets({ documentId: history.documentId, versionId: history.currentVersionId })
            ]);
            exportedDocument = snapshot.document;
            exported = await createVerifiedLocalSnapshotExport(exportedDocument, { assets });
          } else exported = renderLocalDocumentExport(exportedDocument, format);
          return { ...exported, fileName: localExportFileName(
            exportedDocument.metadata.title, exported.extension
          ) };
        },
        deliver: downloadLocalExport
      });
      setLocalExportStatus(exported.warnings?.length ? "fidelity" : "ready");
      return true;
    } catch (error) {
      setLocalExportStatus(error?.message === "local_snapshot_assets_required" ? "assetsRequired" : "error");
      return false;
    }
  }, [prepareForDocumentTransition]);

  const compareVersions = useCallback(async (beforeVersionId, afterVersionId) => {
    const documentId = checkpoint?.document?.id;
    if (!documentId || !localVersionHistoryAvailable()) return false;
    const session = editSession.current;
    if (session?.documentId !== documentId) return false;
    const sequence = ++comparisonReadSequence.current;
    const isCurrent = () => editSession.current === session && sequence === comparisonReadSequence.current;
    setComparisonStatus("loading");
    try {
      const comparison = await compareLocalDocumentVersions({
        documentId, beforeVersionId, afterVersionId, locale: i18n.resolvedLanguage
      });
      if (!isCurrent()) return false;
      setVersionComparison(comparison);
      setComparisonStatus("ready");
      return true;
    } catch {
      if (!isCurrent()) return false;
      setVersionComparison(null);
      setComparisonStatus("error");
      return false;
    }
  }, [checkpoint?.document?.id, i18n.resolvedLanguage]);

  const createNewLocalDocument = useCallback(async () => {
    if (!await prepareForDocumentTransition()) return false;
    const locale = i18n.resolvedLanguage === "zh-Hans" ? "zh-Hans" : i18n.resolvedLanguage;
    replaceWorkingDocument(createEmptyDocument({ language: locale, metadata: { title: "" } }), 0);
    setPersistenceStatus("empty");
    return true;
  }, [i18n.resolvedLanguage, prepareForDocumentTransition, replaceWorkingDocument]);

  useEffect(() => {
    if (!replicas) return undefined;
    replicasRef.current = replicas;
    void createCheckpoint();
    return () => {
      if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
    };
  }, [createCheckpoint, replicas]);

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
    <>
    {mutationBusy ? <p className="mutation-status" role="status">{t("documentWorkspace.applyingChange")}</p> : null}
    <main className="app-shell" inert={mutationBusy ? true : undefined} aria-busy={mutationBusy}>
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
            <h2 id="workbench-title">{developmentWorkbench
              ? t("collaboration.title") : t("documentWorkspace.title")}</h2>
            <p>{developmentWorkbench
              ? t("collaboration.description") : t("documentWorkspace.description")}</p>
          </div>
          {developmentWorkbench ? <button
            type="button"
            className="connection-button"
            data-state={secondaryConnected ? "success" : "default"}
            aria-pressed={secondaryConnected}
            onClick={() => setSecondaryConnected((connected) => !connected)}
          >
            <span className="connection-mark" aria-hidden="true" />
            {secondaryConnected ? t("collaboration.disconnect") : t("collaboration.reconnect")}
          </button> : <button type="button" className="connection-button"
            onClick={() => void createNewLocalDocument()}>{t("documentWorkspace.newDocument")}</button>}
        </div>

        <div className="editor-grid" data-layout={developmentWorkbench ? "replicas" : "single"}>
          <article className="editor-panel">
            <header className="editor-panel-heading">
              <h3>{developmentWorkbench ? t("collaboration.localEditor") : t("documentWorkspace.editor")}</h3>
              <span>{t("collaboration.connected")}</span>
            </header>
            <CollaborativeEditor
              captureInsertionGuard={captureInsertionGuard}
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
              showHistoryControls={!developmentWorkbench}
              historyLabels={{
                label: t("documentWorkspace.historyControls"), undo: t("documentWorkspace.undo"),
                redo: t("documentWorkspace.redo"), hint: t("documentWorkspace.undoHint")
              }}
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

          {developmentWorkbench ? <article className="editor-panel" data-state={secondaryConnected ? "connected" : "disconnected"}>
            <header className="editor-panel-heading">
              <h3>{t("collaboration.secondEditor")}</h3>
              <span>{secondaryConnected ? t("collaboration.connected") : t("collaboration.disconnected")}</span>
            </header>
            {secondaryConnected ? (
              <CollaborativeEditor
                captureInsertionGuard={captureInsertionGuard}
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
          </article> : null}
        </div>
      </section>

      {editorWorkspace.mode === "local" ? (
        <>
          <LocalDocumentLibrary
            documents={localDocuments}
            activeDocumentId={checkpoint?.document?.id ?? null}
            onOpen={openLocalDocument}
            onRename={renameLocalDocument}
            onArchive={archiveLocalDocument}
            labels={{
              title: t("documentLibrary.title"), description: t("documentLibrary.description"),
              count: t("documentLibrary.count"), empty: t("documentLibrary.empty"),
              untitled: t("documentLibrary.untitled"), renameLabel: t("documentLibrary.renameLabel"),
              rename: t("documentLibrary.rename"), open: t("documentLibrary.open"),
              opened: t("documentLibrary.opened"), archive: t("documentLibrary.archive"),
              restore: t("documentLibrary.restore"), archiveSource: t("documentLibrary.archiveSource")
            }}
          />
          <LocalVersionHistory
            history={versionHistory}
            available={localVersionHistoryAvailable()}
            status={versionStatus}
            locale={i18n.resolvedLanguage}
            onCreateInitial={() => createVersion({ kind: "initial", branchName: t("versionHistory.mainBranch") })}
            onSaveNamed={(label) => createVersion({ kind: "named", label })}
            onCreateAlternative={(branchName, label) => createVersion({ kind: "alternative", branchName, label })}
            onRestore={restoreVersion}
            onExport={exportLocalDocument}
            exportStatus={localExportStatus}
            onCompare={compareVersions}
            comparison={versionComparison}
            comparisonStatus={comparisonStatus}
            labels={{
              kicker: t("versionHistory.kicker"), title: t("versionHistory.title"),
              description: t("versionHistory.description"), desktopOnly: t("versionHistory.desktopOnly"),
              createInitial: t("versionHistory.createInitial"), currentBranch: t("versionHistory.currentBranch"),
              currentVersion: t("versionHistory.currentVersion"), versionLabel: t("versionHistory.versionLabel"),
              versionLabelPlaceholder: t("versionHistory.versionLabelPlaceholder"), saveNamed: t("versionHistory.saveNamed"),
              branchName: t("versionHistory.branchName"), branchPlaceholder: t("versionHistory.branchPlaceholder"),
              createAlternative: t("versionHistory.createAlternative"),
              restore: t("versionHistory.restore"),
              exportTitle: t("versionHistory.exportTitle"), exportDescription: t("versionHistory.exportDescription"),
              exportSnapshot: t("versionHistory.exportSnapshot"), exportMarkdown: t("versionHistory.exportMarkdown"),
              exportText: t("versionHistory.exportText"),
              exportStatus: {
                idle: t("versionHistory.exportStatus.idle"), saving: t("versionHistory.exportStatus.saving"),
                ready: t("versionHistory.exportStatus.ready"), fidelity: t("versionHistory.exportStatus.fidelity"),
                assetsRequired: t("versionHistory.exportStatus.assetsRequired"),
                error: t("versionHistory.exportStatus.error")
              },
              compareTitle: t("versionHistory.compareTitle"), compareDescription: t("versionHistory.compareDescription"),
              compareFrom: t("versionHistory.compareFrom"), compareTo: t("versionHistory.compareTo"),
              compareAction: t("versionHistory.compareAction"),
              compareStatus: {
                idle: t("versionHistory.compareStatus.idle"), loading: t("versionHistory.compareStatus.loading"),
                ready: t("versionHistory.compareStatus.ready"), error: t("versionHistory.compareStatus.error")
              },
              changeLabels: {
                added: t("versionHistory.changes.added"), removed: t("versionHistory.changes.removed"),
                moved: t("versionHistory.changes.moved"), changed: t("versionHistory.changes.changed"),
                "moved-and-changed": t("versionHistory.changes.movedAndChanged")
              },
              changeSummary: (summary) => t("versionHistory.changeSummary", summary), beforeText: t("versionHistory.beforeText"),
              afterText: t("versionHistory.afterText"),
              reasons: {
                initial: t("versionHistory.reasons.initial"), named: t("versionHistory.reasons.named"),
                restore: t("versionHistory.reasons.restore"), merge: t("versionHistory.reasons.merge"),
                import: t("versionHistory.reasons.import")
              },
              status: {
                idle: t("versionHistory.status.idle"), loading: t("versionHistory.status.loading"),
                ready: t("versionHistory.status.ready"), saving: t("versionHistory.status.saving"),
                error: t("versionHistory.status.error")
              }
            }}
          />
        </>
      ) : null}

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
            <button type="button" disabled={!checkpoint?.durable || documentExportStatus === "saving"} onClick={exportDocument}>
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
          {archiveImportConflict ? (
            <div className="library-actions">
              <button type="button" onClick={() => resolveArchiveConflict("open")}>{t("archiveImport.openExisting")}</button>
              <button type="button" onClick={() => resolveArchiveConflict("copy")}>{t("archiveImport.importCopy")}</button>
            </div>
          ) : null}
        </div>
      </aside>

      <footer className="app-footer">
        <p>{t("collaboration.privacy")}</p>
        <p className="persistence-status" role="status" data-state={persistenceStatus}>
          {t(`recovery.${persistenceStatus}`)}
          {persistenceErrorCode ? ` ${t("recovery.errorCode")}: ${persistenceErrorCode}` : ""}
        </p>
        {persistenceStatus === "error" ? (
          <button type="button" onClick={() => void createCheckpoint({ retry: true })}>
            {t("recovery.retry")}
          </button>
        ) : null}
      </footer>
    </main>
    </>
  );
}
