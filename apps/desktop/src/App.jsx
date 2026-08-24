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
import { loadLocalDraft, saveLocalDraft } from "./services/local-database.js";

function id(number) {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

function createWelcomeDocument() {
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
      }
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
  const welcomeDocument = useMemo(() => createWelcomeDocument(), []);
  const [replicas, setReplicas] = useState(null);
  const primarySelection = useRef(null);
  const secondarySelection = useRef(null);
  const composingEditors = useRef(new Set());
  const checkpointTimer = useRef(null);
  const checkpointSequence = useRef(0);
  const localRevision = useRef(0);
  const persistenceQueue = useRef(Promise.resolve());
  const persistenceBlocked = useRef(false);
  const [secondaryConnected, setSecondaryConnected] = useState(true);
  const [checkpoint, setCheckpoint] = useState(null);
  const [checkpointStatus, setCheckpointStatus] = useState("pending");
  const [persistenceStatus, setPersistenceStatus] = useState("loading");
  const [persistenceErrorCode, setPersistenceErrorCode] = useState(null);

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
        });
        persistenceQueue.current = persistence.catch(() => {});
        await persistence;
        if (sequence !== checkpointSequence.current) return;
        setPersistenceStatus("saved");
      }
      setCheckpoint({ ...nextCheckpoint, createdAt: new Date() });
      setCheckpointStatus("ready");
    } catch (error) {
      if (sequence === checkpointSequence.current) {
        persistenceBlocked.current = true;
        setPersistenceErrorCode(localPersistenceErrorCode(error));
        setPersistenceStatus("error");
        setCheckpointStatus("error");
      }
    }
  }, [replicas]);

  const scheduleCheckpoint = useCallback(() => {
    if (composingEditors.current.size > 0) return;
    if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
    setCheckpointStatus("pending");
    checkpointTimer.current = window.setTimeout(() => {
      checkpointTimer.current = null;
      void createCheckpoint();
    }, 450);
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
          <h1>{t("app.title")}</h1>
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
              document={replicas.local}
              label={t("collaboration.localEditorLabel")}
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
