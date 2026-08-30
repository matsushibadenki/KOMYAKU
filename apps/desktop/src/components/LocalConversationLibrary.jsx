import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { localAiHandoffStore } from "../services/local-ai-handoff.js";

export function LocalConversationLibrary({ store = localAiHandoffStore, onOpen }) {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState([]);
  const [status, setStatus] = useState(store.isAvailable() ? "loading" : "unavailable");

  async function refresh() {
    if (!store.isAvailable()) return;
    setStatus("loading");
    try {
      const result = await store.list();
      setItems(result);
      setStatus(result.length ? "ready" : "empty");
    } catch {
      setStatus("error");
    }
  }

  useEffect(() => { void refresh(); }, [store]);

  async function openConversation(id) {
    setStatus("opening");
    try {
      const conversation = await store.load(id);
      if (!conversation) throw new Error("missing");
      onOpen(conversation);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }

  if (!store.isAvailable()) return null;

  return (
    <section className="local-conversation-library" aria-labelledby="local-conversation-library-title">
      <div className="library-heading">
        <div>
          <p className="section-kicker">{t("localConversationLibrary.kicker")}</p>
          <h3 id="local-conversation-library-title">{t("localConversationLibrary.title")}</h3>
          <p>{t("localConversationLibrary.description")}</p>
        </div>
        <button type="button" className="text-button" onClick={() => void refresh()} disabled={status === "loading" || status === "opening"}>
          {t("localConversationLibrary.refresh")}
        </button>
      </div>
      {status === "loading" ? <p role="status">{t("localConversationLibrary.loading")}</p> : null}
      {status === "empty" ? <p>{t("localConversationLibrary.empty")}</p> : null}
      {status === "error" ? <p className="import-error" role="alert">{t("localConversationLibrary.error")}</p> : null}
      {items.length ? (
        <ol className="conversation-preview-list local-library-list">
          {items.map((item, index) => (
            <li key={item.id}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div>
                <strong>{item.title || t("localConversationLibrary.untitled")}</strong>
                <small>{t("localConversationLibrary.summary", {
                  count: item.messageCount,
                  date: new Intl.DateTimeFormat(i18n.resolvedLanguage, { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.updatedAt))
                })}</small>
              </div>
              <button type="button" className="secondary-button" disabled={status === "opening"} onClick={() => void openConversation(item.id)}>
                {t("localConversationLibrary.open")}
              </button>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}
