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

export function App() {
  const { t, i18n } = useTranslation();
  const replicas = useMemo(() => {
    const local = createCollaborativeWorkingState(createWelcomeDocument());
    const second = createEmptyCollaborativeWorkingState();
    connectCollaborativeWorkingStates(local, second)();
    return { local, second };
  }, []);
  const primarySelection = useRef(null);
  const secondarySelection = useRef(null);
  const composingEditors = useRef(new Set());
  const checkpointTimer = useRef(null);
  const checkpointSequence = useRef(0);
  const [secondaryConnected, setSecondaryConnected] = useState(true);
  const [checkpoint, setCheckpoint] = useState(null);
  const [checkpointStatus, setCheckpointStatus] = useState("pending");

  const createCheckpoint = useCallback(async () => {
    const sequence = ++checkpointSequence.current;
    setCheckpointStatus("saving");
    try {
      const nextCheckpoint = await createCanonicalCheckpoint(replicas.local);
      if (sequence !== checkpointSequence.current) return;
      setCheckpoint({ ...nextCheckpoint, createdAt: new Date() });
      setCheckpointStatus("ready");
    } catch {
      if (sequence === checkpointSequence.current) setCheckpointStatus("error");
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
    void createCheckpoint();
    return () => {
      if (checkpointTimer.current) window.clearTimeout(checkpointTimer.current);
    };
  }, [createCheckpoint]);

  useEffect(() => {
    if (!secondaryConnected) return undefined;
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
      </footer>
    </main>
  );
}
