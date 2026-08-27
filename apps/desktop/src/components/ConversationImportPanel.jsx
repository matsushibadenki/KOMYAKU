import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CONVERSATION_PROVIDER_OPTIONS,
  previewConversationExport
} from "../services/conversation-import-preview.js";

function previewErrorCode(error) {
  if (["unsupported_provider", "empty_file", "file_too_large"].includes(error?.message)) return error.message;
  return "invalid_export";
}

export function ConversationImportPanel() {
  const { t, i18n } = useTranslation();
  const inputId = useId();
  const fileInput = useRef(null);
  const [provider, setProvider] = useState("auto");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [status, setStatus] = useState("idle");
  const [errorCode, setErrorCode] = useState(null);
  const [warningsReviewed, setWarningsReviewed] = useState(false);

  async function inspect(nextFile, nextProvider = provider) {
    setFile(nextFile);
    setPreview(null);
    setWarningsReviewed(false);
    setErrorCode(null);
    if (!nextFile) {
      setStatus("idle");
      return;
    }
    setStatus("reading");
    try {
      const result = await previewConversationExport(await nextFile.arrayBuffer(), nextProvider);
      setPreview(result);
      setStatus("ready");
    } catch (error) {
      setErrorCode(previewErrorCode(error));
      setStatus("error");
    }
  }

  function changeProvider(event) {
    const nextProvider = event.target.value;
    setProvider(nextProvider);
    if (file) void inspect(file, nextProvider);
  }

  const needsWarningReview = preview?.status === "partial" && preview.warnings.length > 0;
  const reviewed = preview && (!needsWarningReview || warningsReviewed);

  return (
    <section className="import-panel" aria-labelledby="conversation-import-title">
      <div className="import-heading">
        <div>
          <p className="section-kicker">{t("conversationImport.kicker")}</p>
          <h2 id="conversation-import-title">
            <span className="meaning-line">{t("conversationImport.titleLead")}</span>{" "}
            <span className="meaning-line">{t("conversationImport.titleClose")}</span>
          </h2>
          <p>{t("conversationImport.description")}</p>
        </div>
        <span className="local-review-badge">{t("conversationImport.localOnly")}</span>
      </div>

      <div className="import-controls">
        <label className="provider-control">
          <span>{t("conversationImport.providerLabel")}</span>
          <select value={provider} onChange={changeProvider}>
            {CONVERSATION_PROVIDER_OPTIONS.map((value) => (
              <option key={value} value={value}>{t(`conversationImport.providers.${value}`)}</option>
            ))}
          </select>
        </label>
        <div className="file-control">
          <input
            ref={fileInput}
            id={inputId}
            type="file"
            accept="application/json,.json"
            onChange={(event) => void inspect(event.target.files?.[0] ?? null)}
          />
          <label htmlFor={inputId} className="file-button">{t("conversationImport.chooseFile")}</label>
          <span>{file?.name ?? t("conversationImport.noFile")}</span>
        </div>
      </div>

      <div className="import-review" aria-live="polite" data-state={status}>
        {status === "idle" && <p className="import-empty">{t("conversationImport.empty")}</p>}
        {status === "reading" && <p className="import-empty">{t("conversationImport.reading")}</p>}
        {status === "error" && (
          <div className="import-error" role="alert">
            <strong>{t("conversationImport.errorTitle")}</strong>
            <p>{t(`conversationImport.errors.${errorCode}`)}</p>
          </div>
        )}
        {status === "ready" && preview && (
          <>
            <div className="import-summary">
              <div><span>{t("conversationImport.detectedProvider")}</span><strong>{t(`conversationImport.providers.${preview.provider}`)}</strong></div>
              <div><span>{t("conversationImport.conversations")}</span><strong>{preview.conversationCount.toLocaleString(i18n.resolvedLanguage)}</strong></div>
              <div><span>{t("conversationImport.messages")}</span><strong>{preview.messageCount.toLocaleString(i18n.resolvedLanguage)}</strong></div>
              <div><span>{t("conversationImport.size")}</span><strong>{preview.byteLength.toLocaleString(i18n.resolvedLanguage)} B</strong></div>
            </div>
            <ol className="conversation-preview-list">
              {preview.conversations.slice(0, 5).map((conversation, index) => (
                <li key={conversation.id}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <strong>{conversation.title || t("conversationImport.untitled")}</strong>
                    <small>{t("conversationImport.messageCount", { count: conversation.messageCount })}</small>
                  </div>
                </li>
              ))}
            </ol>
            {preview.conversationCount > 5 && (
              <p className="remaining-count">{t("conversationImport.remaining", { count: preview.conversationCount - 5 })}</p>
            )}
            <div className="provenance-row"><span>SHA-256</span><code>{preview.sourceHash}</code></div>
            {needsWarningReview && (
              <div className="warning-review">
                <strong>{t("conversationImport.warningTitle")}</strong>
                <ul>
                  {preview.warnings.map((warning, index) => (
                    <li key={`${index}:${warning}`}>{t("conversationImport.warningItem", { number: index + 1 })}</li>
                  ))}
                </ul>
                <label>
                  <input
                    type="checkbox"
                    checked={warningsReviewed}
                    onChange={(event) => setWarningsReviewed(event.target.checked)}
                  />
                  <span>{t("conversationImport.warningConfirm")}</span>
                </label>
              </div>
            )}
            <div className="import-next-step" data-state={reviewed ? "ready" : "blocked"}>
              <strong>{reviewed ? t("conversationImport.reviewReady") : t("conversationImport.reviewRequired")}</strong>
              <p>{t("conversationImport.cloudPending")}</p>
            </div>
          </>
        )}
      </div>
      <p className="import-privacy">{t("conversationImport.privacy")}</p>
    </section>
  );
}
