import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CONVERSATION_PROVIDER_OPTIONS,
  inspectConversationExport
} from "../services/conversation-import-preview.js";
import { cloudApiClient } from "../services/cloud-api.js";
import { secureSessionStore } from "../services/secure-session.js";
import { AiHandoffPanel } from "./AiHandoffPanel.jsx";
import { LocalConversationLibrary } from "./LocalConversationLibrary.jsx";

function previewErrorCode(error) {
  if (["unsupported_provider", "empty_file", "file_too_large"].includes(error?.message)) return error.message;
  return "invalid_export";
}

export function ConversationImportPanel({ apiClient = cloudApiClient, sessionStore = secureSessionStore }) {
  const { t, i18n } = useTranslation();
  const inputId = useId();
  const fileInput = useRef(null);
  const inspectionSequence = useRef(0);
  const idempotencyKey = useRef(crypto.randomUUID());
  const [provider, setProvider] = useState("auto");
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [canonicalConversations, setCanonicalConversations] = useState([]);
  const [cloudCanonicalConversations, setCloudCanonicalConversations] = useState([]);
  const [localConversationKey, setLocalConversationKey] = useState(null);
  const [status, setStatus] = useState("idle");
  const [errorCode, setErrorCode] = useState(null);
  const [warningsReviewed, setWarningsReviewed] = useState(false);
  const [sourceBytes, setSourceBytes] = useState(null);
  const [cloudConsent, setCloudConsent] = useState(false);
  const [cloudStatus, setCloudStatus] = useState("disconnected");
  const [cloudError, setCloudError] = useState(null);
  const [cloudErrorReference, setCloudErrorReference] = useState(null);
  const [rememberSession, setRememberSession] = useState(false);
  const [sessionPersistence, setSessionPersistence] = useState("memory");
  const [credentials, setCredentials] = useState({ email: "", password: "" });
  const [session, setSession] = useState(null);
  const [workspaces, setWorkspaces] = useState([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [importResult, setImportResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setCloudStatus("restoring");
    void sessionStore.load().then(async (token) => {
      if (!token) {
        if (!cancelled) setCloudStatus("disconnected");
        return;
      }
      const [sessionResult, workspaceResult] = await Promise.all([
        apiClient.session(token),
        apiClient.workspaces(token)
      ]);
      if (cancelled) return;
      const eligible = workspaceResult.workspaces.filter((workspace) => workspace.canImportConversations);
      setSession({ token, user: sessionResult.identity });
      setWorkspaces(workspaceResult.workspaces);
      setWorkspaceId(eligible[0]?.id ?? "");
      setRememberSession(true);
      setSessionPersistence("secure");
      setCloudStatus("connected");
    }).catch(async (error) => {
      const revoked = error?.status === 401;
      if (revoked) {
        try { await sessionStore.clear(); } catch { /* Keep bounded UI state. */ }
      }
      if (cancelled) return;
      setCloudError(revoked ? "saved_session_expired" : "restore_failed");
      setRememberSession(!revoked);
      setSessionPersistence(revoked ? "memory" : "secure");
      setCloudStatus("disconnected");
    });
    return () => { cancelled = true; };
  }, [apiClient, sessionStore]);

  async function inspect(nextFile, nextProvider = provider) {
    const sequence = ++inspectionSequence.current;
    setFile(nextFile);
    setPreview(null);
    setCanonicalConversations([]);
    setCloudCanonicalConversations([]);
    setLocalConversationKey(null);
    setSourceBytes(null);
    setWarningsReviewed(false);
    setCloudConsent(false);
    setImportResult(null);
    if (session) setCloudStatus("connected");
    idempotencyKey.current = crypto.randomUUID();
    setErrorCode(null);
    if (!nextFile) {
      setStatus("idle");
      return;
    }
    setStatus("reading");
    try {
      const bytes = new Uint8Array(await nextFile.arrayBuffer());
      const inspected = await inspectConversationExport(bytes, nextProvider);
      if (sequence !== inspectionSequence.current) return;
      setPreview(inspected.preview);
      setCanonicalConversations(inspected.canonicalConversations);
      setSourceBytes(bytes);
      setStatus("ready");
    } catch (error) {
      if (sequence !== inspectionSequence.current) return;
      setErrorCode(previewErrorCode(error));
      setStatus("error");
    }
  }

  async function connectCloud(event) {
    event.preventDefault();
    setCloudStatus("connecting");
    setCloudError(null);
    setCloudErrorReference(null);
    try {
      const authenticated = await apiClient.login(credentials);
      const workspaceResult = await apiClient.workspaces(authenticated.session.token);
      const eligible = workspaceResult.workspaces.filter((workspace) => workspace.canImportConversations);
      setSession({ token: authenticated.session.token, user: authenticated.user });
      setWorkspaces(workspaceResult.workspaces);
      setWorkspaceId(eligible[0]?.id ?? "");
      setCredentials((current) => ({ ...current, password: "" }));
      if (rememberSession) {
        try {
          await sessionStore.save(authenticated.session.token);
          setSessionPersistence("secure");
        } catch (error) {
          setSessionPersistence("memory");
          setCloudError(error?.code ?? "secure_session_unavailable");
        }
      } else {
        try { await sessionStore.clear(); } catch { /* Login remains memory-only. */ }
        setSessionPersistence("memory");
      }
      setCloudStatus("connected");
    } catch (error) {
      setCredentials((current) => ({ ...current, password: "" }));
      setCloudError(error?.code ?? "connection_failed");
      setCloudErrorReference(error?.reference ?? null);
      setCloudStatus("disconnected");
    }
  }

  async function disconnectCloud() {
    const token = session?.token;
    setCloudStatus("disconnecting");
    try {
      if (token) await apiClient.logout(token);
    } catch {
      // Local session material is cleared even if the server is unavailable.
    } finally {
      try { await sessionStore.clear(); } catch { /* Memory state still clears. */ }
      setSession(null);
      setWorkspaces([]);
      setWorkspaceId("");
      setCloudConsent(false);
      setCloudError(null);
      setCloudErrorReference(null);
      setImportResult(null);
      setRememberSession(false);
      setSessionPersistence("memory");
      setCloudStatus("disconnected");
    }
  }

  function changeWorkspace(event) {
    setWorkspaceId(event.target.value);
    setCloudConsent(false);
    setImportResult(null);
    idempotencyKey.current = crypto.randomUUID();
  }

  async function submitImport() {
    if (!session || !workspaceId || !sourceBytes || !reviewed || !cloudConsent) return;
    setCloudStatus("importing");
    setCloudError(null);
    setCloudErrorReference(null);
    try {
      const result = await apiClient.importConversation({
        token: session.token,
        workspaceId,
        bytes: sourceBytes,
        sourceProvider: provider,
        idempotencyKey: idempotencyKey.current
      });
      const aligned = await inspectConversationExport(sourceBytes, provider, { identityScope: workspaceId });
      const alignedIds = aligned.canonicalConversations.map(({ id }) => id);
      if (JSON.stringify(alignedIds) !== JSON.stringify(result.conversationIds ?? [])) {
        setCloudError("cloud_identity_mismatch");
        setCloudCanonicalConversations([]);
        setCloudStatus("connected");
        return;
      }
      setImportResult(result);
      setCloudCanonicalConversations([...aligned.canonicalConversations]);
      setCloudStatus("imported");
    } catch (error) {
      if (error?.status === 401) {
        setSession(null);
        setWorkspaces([]);
        setWorkspaceId("");
        setCloudConsent(false);
        setCloudError("session_expired");
        setCloudErrorReference(null);
        setCloudStatus("disconnected");
        setSessionPersistence("memory");
        try { await sessionStore.clear(); } catch { /* Revoked token must leave memory regardless. */ }
        return;
      }
      setCloudError(error?.code ?? "import_failed");
      setCloudErrorReference(error?.reference ?? null);
      setCloudStatus("connected");
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

      <LocalConversationLibrary onOpen={(conversation) => {
        setCanonicalConversations([conversation]);
        setLocalConversationKey(conversation.id);
      }} />

      <div className="cloud-boundary" aria-labelledby="cloud-import-title">
        <div className="cloud-heading">
          <div>
            <p className="section-kicker">{t("conversationImport.cloudKicker")}</p>
            <h3 id="cloud-import-title">
              <span className="meaning-line">{t("conversationImport.cloudTitleLead")}</span>{" "}
              <span className="meaning-line">{t("conversationImport.cloudTitleClose")}</span>
            </h3>
          </div>
          {session ? <span>{session.user.email}</span> : null}
        </div>

        {!session ? (
          <form className="cloud-login" onSubmit={connectCloud}>
            <p>{t("conversationImport.cloudLoginDescription")}</p>
            <label>
              <span>{t("conversationImport.email")}</span>
              <input
                type="email"
                autoComplete="email"
                required
                value={credentials.email}
                onChange={(event) => setCredentials((current) => ({ ...current, email: event.target.value }))}
              />
            </label>
            <label>
              <span>{t("conversationImport.password")}</span>
              <input
                type="password"
                autoComplete="current-password"
                required
                value={credentials.password}
                onChange={(event) => setCredentials((current) => ({ ...current, password: event.target.value }))}
              />
            </label>
            <button type="submit" className="primary-button" disabled={cloudStatus === "connecting"}>
              {t(`conversationImport.${cloudStatus === "connecting" ? "connecting" : "connect"}`)}
            </button>
            <label className="remember-session">
              <input
                type="checkbox"
                checked={rememberSession}
                onChange={(event) => setRememberSession(event.target.checked)}
              />
              <span>{t("conversationImport.rememberSession")}</span>
            </label>
          </form>
        ) : (
          <div className="cloud-connected">
            <label>
              <span>{t("conversationImport.workspace")}</span>
              <select value={workspaceId} onChange={changeWorkspace}>
                <option value="">{t("conversationImport.noEligibleWorkspace")}</option>
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id} disabled={!workspace.canImportConversations}>
                    {workspace.name} · {t(`conversationImport.roles.${workspace.role}`)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="text-button" onClick={() => void disconnectCloud()} disabled={cloudStatus === "disconnecting"}>
              {t("conversationImport.disconnect")}
            </button>
          </div>
        )}

        {cloudError ? (
          <div className="cloud-error" role="alert">
            <p>{t(`conversationImport.cloudErrors.${cloudError}`, {
              defaultValue: t("conversationImport.cloudErrors.request_failed")
            })}</p>
            {cloudErrorReference ? <code>{cloudErrorReference}</code> : null}
          </div>
        ) : null}

        {session && reviewed && sourceBytes ? (
          <div className="cloud-confirmation">
            <label>
              <input
                type="checkbox"
                checked={cloudConsent}
                onChange={(event) => setCloudConsent(event.target.checked)}
              />
              <span>{t("conversationImport.cloudConfirm", {
                count: preview.conversationCount,
                bytes: preview.byteLength.toLocaleString(i18n.resolvedLanguage)
              })}</span>
            </label>
            <button
              type="button"
              className="primary-button"
              disabled={!workspaceId || !cloudConsent || cloudStatus === "importing" || cloudStatus === "imported"}
              onClick={() => void submitImport()}
            >
              {t(`conversationImport.${cloudStatus === "importing" ? "importing" : cloudStatus === "imported" ? "imported" : "sendToCloud"}`)}
            </button>
          </div>
        ) : null}

        {importResult ? (
          <div className="cloud-success" role="status">
            <strong>{t("conversationImport.importComplete")}</strong>
            <p>{t("conversationImport.importCompleteDetail", { count: importResult.conversationIds?.length ?? 0 })}</p>
            <code>{importResult.importId}</code>
          </div>
        ) : null}
        <p className="cloud-session-note">{t(`conversationImport.${
          cloudStatus === "restoring" ? "sessionRestoring" : sessionPersistence === "secure" ? "sessionSecure" : "sessionMemoryOnly"
        }`)}</p>
      </div>
      {(reviewed || localConversationKey) && canonicalConversations.length > 0 ? (
        <AiHandoffPanel
          key={localConversationKey ?? `${preview.sourceHash}:${provider}`}
          conversations={canonicalConversations}
          cloudSync={session && importResult && cloudCanonicalConversations.length ? {
            apiClient,
            token: session.token,
            workspaceId,
            conversations: cloudCanonicalConversations
          } : null}
        />
      ) : null}
    </section>
  );
}
