import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  aiProviderConnectionSchema,
  appendContinuationBranch,
  confirmHandoff,
  createAiProviderGateway,
  createOpenAiCompatibleAdapter,
  prepareSensitiveHandoff
} from "@komyaku/ai-gateway";
import { providerCredentialStore } from "../services/provider-credential.js";
import { localAiHandoffStore } from "../services/local-ai-handoff.js";

function branchTo(conversation, sourceMessageId) {
  const parents = new Map();
  for (const edge of conversation.edges) {
    const values = parents.get(edge.childMessageId) ?? [];
    values.push(edge.parentMessageId);
    parents.set(edge.childMessageId, values);
  }
  const path = [];
  const seen = new Set();
  let current = sourceMessageId;
  while (current) {
    if (seen.has(current)) return null;
    seen.add(current);
    path.push(current);
    const candidates = parents.get(current) ?? [];
    if (candidates.length > 1) return null;
    current = candidates[0] ?? null;
  }
  return path.reverse();
}

function messageText(message) {
  return message.contentParts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

const DEFAULT_CONNECTION = Object.freeze({
  mode: "local",
  displayName: "Local compatible API",
  endpoint: "http://127.0.0.1:11434/v1",
  modelId: "local-model",
  apiKey: ""
});

export function AiHandoffPanel({
  conversations,
  cloudSync = null,
  credentialStore = providerCredentialStore,
  persistenceStore = localAiHandoffStore,
  fetchImpl = fetch
}) {
  const { t, i18n } = useTranslation();
  const actorId = useRef(crypto.randomUUID());
  const connectionReference = useRef(crypto.randomUUID());
  const abortController = useRef(null);
  const [conversationList, setConversationList] = useState(conversations);
  const [conversationId, setConversationId] = useState(conversations[0]?.id ?? "");
  const [sourceMessageId, setSourceMessageId] = useState(conversations[0]?.messages.at(-1)?.id ?? "");
  const [draft, setDraft] = useState(DEFAULT_CONNECTION);
  const [connection, setConnection] = useState(null);
  const [models, setModels] = useState([]);
  const [modelStatus, setModelStatus] = useState("idle");
  const [preview, setPreview] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [maskSensitive, setMaskSensitive] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [pendingPersistence, setPendingPersistence] = useState(null);
  const [persistenceStatus, setPersistenceStatus] = useState(
    persistenceStore.isAvailable() ? "idle" : "memory"
  );
  const [status, setStatus] = useState("setup");
  const [errorCode, setErrorCode] = useState(null);
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudConnections, setCloudConnections] = useState([]);
  const [cloudConnectionId, setCloudConnectionId] = useState("");
  const [cloudConnectionStatus, setCloudConnectionStatus] = useState(cloudSync ? "loading" : "unavailable");
  const [pendingCloudPersistence, setPendingCloudPersistence] = useState(null);
  const [cloudPersistenceStatus, setCloudPersistenceStatus] = useState("idle");

  const gateway = useMemo(() => createAiProviderGateway({
    adapters: { "openai-compatible": createOpenAiCompatibleAdapter({ fetchImpl }) },
    resolveCredential: (reference) => credentialStore.load(reference)
  }), [credentialStore, fetchImpl]);

  useEffect(() => {
    if (!persistenceStore.isAvailable()) return undefined;
    let cancelled = false;
    void Promise.all(conversations.map(async (item) => (
      await persistenceStore.load(item.id) ?? item
    ))).then((restored) => {
      if (cancelled) return;
      setConversationList(restored);
      if (restored.some((item, index) => item.messages.length > conversations[index].messages.length)) {
        setSourceMessageId(restored[0]?.messages.at(-1)?.id ?? "");
        setPersistenceStatus("restored");
      }
    }).catch(() => {
      if (!cancelled) setPersistenceStatus("restore-failed");
    });
    return () => { cancelled = true; };
  }, [conversations, persistenceStore]);

  useEffect(() => {
    if (!cloudSync) {
      setCloudConnectionStatus("unavailable");
      return undefined;
    }
    let cancelled = false;
    setCloudConnectionStatus("loading");
    void cloudSync.apiClient.aiProviderConnections({
      token: cloudSync.token,
      workspaceId: cloudSync.workspaceId
    }).then((result) => {
      if (cancelled) return;
      const compatible = (result?.connections ?? []).filter(
        (item) => item.providerType === "openai-compatible"
      );
      setCloudConnections(compatible);
      setCloudConnectionId(compatible[0]?.id ?? "");
      setCloudConnectionStatus(compatible.length > 0 ? "ready" : "empty");
    }).catch(() => {
      if (!cancelled) setCloudConnectionStatus("failed");
    });
    return () => { cancelled = true; };
  }, [cloudSync?.apiClient, cloudSync?.token, cloudSync?.workspaceId]);

  const conversation = conversationList.find((item) => item.id === conversationId) ?? null;
  const selectedIds = conversation ? branchTo(conversation, sourceMessageId) : null;
  const selectionKey = selectedIds?.join(":") ?? "";
  const sensitivePreparation = useMemo(
    () => conversation && selectedIds ? prepareSensitiveHandoff(conversation, selectedIds) : null,
    [conversation, selectionKey]
  );
  const handoffConversation = maskSensitive
    ? sensitivePreparation?.maskedConversation ?? conversation
    : conversation;
  const selectedMessages = selectedIds && handoffConversation
    ? selectedIds.map((id) => handoffConversation.messages.find((message) => message.id === id))
    : [];

  function resetReview() {
    setPreview(null);
    setConfirmed(false);
    setStreamingText("");
    setErrorCode(null);
    setStatus(connection ? "ready" : "setup");
  }

  function changeConversation(event) {
    const nextId = event.target.value;
    const next = conversationList.find((item) => item.id === nextId);
    setConversationId(nextId);
    setSourceMessageId(next?.messages.at(-1)?.id ?? "");
    setMaskSensitive(false);
    resetReview();
  }

  function selectConversationSet(nextConversations, enabled) {
    setCloudEnabled(enabled);
    setConversationList(nextConversations);
    setConversationId(nextConversations[0]?.id ?? "");
    setSourceMessageId(nextConversations[0]?.messages.at(-1)?.id ?? "");
    setConnection(null);
    setModels([]);
    setModelStatus("idle");
    setPreview(null);
    setConfirmed(false);
    setMaskSensitive(false);
    setStreamingText("");
    setPendingCloudPersistence(null);
    setCloudPersistenceStatus("idle");
    setErrorCode(null);
    setStatus("setup");
  }

  async function saveConnection(event) {
    event.preventDefault();
    setStatus("saving-connection");
    setErrorCode(null);
    const credentialReference = connectionReference.current;
    const id = cloudEnabled ? cloudConnectionId : credentialReference;
    try {
      const proposedConnection = aiProviderConnectionSchema.parse({
        id,
        mode: draft.mode,
        providerType: "openai-compatible",
        displayName: draft.displayName,
        endpoint: draft.endpoint,
        credentialReference: draft.mode === "byok" ? credentialReference : null,
      });
      if (draft.mode === "byok") {
        await credentialStore.save(credentialReference, draft.apiKey);
      } else if (connection?.credentialReference) {
        await credentialStore.clear(credentialReference);
      }
      setConnection({
        ...proposedConnection,
        modelId: draft.modelId
      });
      setModels([]);
      setModelStatus("idle");
      setDraft((current) => ({ ...current, apiKey: "" }));
      setStatus("ready");
    } catch (error) {
      setDraft((current) => ({ ...current, apiKey: "" }));
      setErrorCode(error?.code ?? "connection_invalid");
      setStatus("setup");
    }
  }

  async function discoverModels() {
    if (!connection) return;
    setModelStatus("loading");
    setErrorCode(null);
    try {
      const discovered = await gateway.listModels({ connection });
      setModels(discovered);
      if (discovered.length === 0) {
        setErrorCode("provider_models_empty");
        setModelStatus("idle");
        return;
      }
      const selected = discovered.some((model) => model.id === connection.modelId)
        ? connection.modelId
        : discovered[0].id;
      setConnection((current) => ({ ...current, modelId: selected }));
      setDraft((current) => ({ ...current, modelId: selected }));
      setModelStatus("ready");
      resetReview();
    } catch (error) {
      setErrorCode(error?.message ?? "provider_model_discovery_failed");
      setModelStatus("idle");
    }
  }

  function selectDiscoveredModel(event) {
    const modelId = event.target.value;
    setConnection((current) => current ? { ...current, modelId } : current);
    setDraft((current) => ({ ...current, modelId }));
    resetReview();
  }

  async function createReview() {
    if (!handoffConversation || !connection || !selectedIds) return;
    setStatus("reviewing");
    setErrorCode(null);
    try {
      const next = await gateway.preview({
        conversation: handoffConversation,
        connection,
        modelId: connection.modelId,
        sourceMessageId,
        selectedMessageIds: selectedIds
      });
      setPreview(next);
      setConfirmed(false);
      setStatus("reviewed");
    } catch (error) {
      setErrorCode(error?.message ?? "review_failed");
      setStatus("ready");
    }
  }

  async function sendHandoff() {
    if (!conversation || !handoffConversation || !connection || !preview || !confirmed) return;
    setStatus("sending");
    setErrorCode(null);
    setStreamingText("");
    const controller = new AbortController();
    abortController.current = controller;
    try {
      const consent = confirmHandoff(preview, {
        expectedPayloadHash: preview.payloadHash,
        consentedBy: actorId.current
      });
      const response = await gateway.stream({
        conversation: handoffConversation,
        connection,
        confirmed: consent,
        signal: controller.signal,
        onDelta: (delta) => setStreamingText((current) => current + delta)
      });
      const continued = appendContinuationBranch(conversation, consent, response);
      setConversationList((current) => current.map((item) => item.id === continued.id ? continued : item));
      setSourceMessageId(continued.messages.at(-1).id);
      const completedAt = new Date().toISOString();
      const responseMessage = continued.messages.at(-1);
      const persistence = { conversation: continued, confirmed: consent, response, completedAt };
      setPendingPersistence(persistence);
      if (persistenceStore.isAvailable()) {
        setStatus("saving-result");
        try {
          await persistenceStore.save(persistence);
          setPersistenceStatus("persisted");
          setPendingPersistence(null);
        } catch (error) {
          setPersistenceStatus("failed");
          setErrorCode(error?.code ?? "local_ai_handoff_storage_failure");
          setStatus("persistence-failed");
          return;
        }
      } else {
        setPersistenceStatus("memory");
      }
      if (cloudEnabled && cloudSync) {
        const cloudPersistence = {
          conversationId: continued.id,
          confirmed: consent,
          responseMessage,
          providerResponseId: response.providerResponseId ?? null,
          completedAt
        };
        setPendingCloudPersistence(cloudPersistence);
        setCloudPersistenceStatus("saving");
        setStatus("saving-cloud");
        try {
          await persistCloud(cloudPersistence);
          setPendingCloudPersistence(null);
          setCloudPersistenceStatus("saved");
        } catch (error) {
          setCloudPersistenceStatus("failed");
          setErrorCode(error?.code ?? "cloud_ai_handoff_storage_failure");
          setStatus("cloud-persistence-failed");
          return;
        }
      }
      setStatus("complete");
    } catch (error) {
      setStreamingText("");
      setErrorCode(controller.signal.aborted ? "cancelled" : error?.message ?? "send_failed");
      setStatus("reviewed");
    } finally {
      abortController.current = null;
    }
  }

  async function retryPersistence() {
    if (!pendingPersistence) return;
    setStatus("saving-result");
    setErrorCode(null);
    try {
      await persistenceStore.save(pendingPersistence);
      setPendingPersistence(null);
      setPersistenceStatus("persisted");
      if (cloudEnabled && cloudSync) {
        const cloudPersistence = {
          conversationId: pendingPersistence.conversation.id,
          confirmed: pendingPersistence.confirmed,
          responseMessage: pendingPersistence.conversation.messages.at(-1),
          providerResponseId: pendingPersistence.response.providerResponseId ?? null,
          completedAt: pendingPersistence.completedAt
        };
        setPendingCloudPersistence(cloudPersistence);
        setCloudPersistenceStatus("saving");
        setStatus("saving-cloud");
        try {
          await persistCloud(cloudPersistence);
          setPendingCloudPersistence(null);
          setCloudPersistenceStatus("saved");
        } catch (error) {
          setCloudPersistenceStatus("failed");
          setErrorCode(error?.code ?? "cloud_ai_handoff_storage_failure");
          setStatus("cloud-persistence-failed");
          return;
        }
      }
      setStatus("complete");
    } catch (error) {
      setPersistenceStatus("failed");
      setErrorCode(error?.code ?? "local_ai_handoff_storage_failure");
      setStatus("persistence-failed");
    }
  }

  function persistCloud(value) {
    return cloudSync.apiClient.persistAiHandoff({
      token: cloudSync.token,
      workspaceId: cloudSync.workspaceId,
      ...value,
      idempotencyKey: `ai-handoff:${value.confirmed.id}`
    });
  }

  async function retryCloudPersistence() {
    if (!pendingCloudPersistence) return;
    setStatus("saving-cloud");
    setCloudPersistenceStatus("saving");
    setErrorCode(null);
    try {
      await persistCloud(pendingCloudPersistence);
      setPendingCloudPersistence(null);
      setCloudPersistenceStatus("saved");
      setStatus("complete");
    } catch (error) {
      setCloudPersistenceStatus("failed");
      setErrorCode(error?.code ?? "cloud_ai_handoff_storage_failure");
      setStatus("cloud-persistence-failed");
    }
  }

  if (conversations.length === 0) return null;

  return (
    <section className="handoff-panel" aria-labelledby="ai-handoff-title">
      <div className="import-heading">
        <div>
          <p className="section-kicker">{t("aiHandoff.kicker")}</p>
          <h2 id="ai-handoff-title">
            <span className="meaning-line">{t("aiHandoff.titleLead")}</span>{" "}
            <span className="meaning-line">{t("aiHandoff.titleClose")}</span>
          </h2>
          <p>{t("aiHandoff.description")}</p>
        </div>
        <span className="local-review-badge">{t("aiHandoff.explicitReview")}</span>
      </div>

      {cloudSync ? <div className="handoff-cloud-sync">
        <div>
          <strong>{t("aiHandoff.cloudSyncTitle")}</strong>
          <p>{t("aiHandoff.cloudSyncDescription")}</p>
        </div>
        {cloudConnectionStatus === "loading" ? <p>{t("aiHandoff.cloudConnectionsLoading")}</p> : null}
        {["empty", "failed"].includes(cloudConnectionStatus) ? <p>{t("aiHandoff.cloudConnectionsEmpty")}</p> : null}
        {cloudConnectionStatus === "ready" ? <>
          <label className="handoff-consent">
            <input type="checkbox" checked={cloudEnabled} onChange={(event) => selectConversationSet(
              event.target.checked ? cloudSync.conversations : conversations,
              event.target.checked
            )} />
            <span>{t("aiHandoff.cloudSyncEnable")}</span>
          </label>
          {cloudEnabled ? <label>
            <span>{t("aiHandoff.cloudConnection")}</span>
            <select value={cloudConnectionId} onChange={(event) => {
              setCloudConnectionId(event.target.value);
              setConnection(null);
              setPreview(null);
              setConfirmed(false);
              setErrorCode(null);
              setStatus("setup");
            }}>
              {cloudConnections.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}
            </select>
          </label> : null}
        </> : null}
      </div> : null}

      <form className="handoff-connection" onSubmit={saveConnection}>
        <label>
          <span>{t("aiHandoff.connectionMode")}</span>
          <select value={draft.mode} onChange={(event) => {
            const mode = event.target.value;
            setDraft((current) => ({
              ...current, mode,
              endpoint: mode === "local" ? "http://127.0.0.1:11434/v1" : "https://",
              apiKey: ""
            }));
          }}>
            <option value="local">{t("aiHandoff.local")}</option>
            <option value="byok">{t("aiHandoff.byok")}</option>
          </select>
        </label>
        <label><span>{t("aiHandoff.connectionName")}</span><input required value={draft.displayName} onChange={(event) => setDraft((current) => ({ ...current, displayName: event.target.value }))} /></label>
        <label><span>{t("aiHandoff.endpoint")}</span><input required type="url" value={draft.endpoint} onChange={(event) => setDraft((current) => ({ ...current, endpoint: event.target.value }))} /></label>
        <label><span>{t("aiHandoff.model")}</span><input required value={draft.modelId} onChange={(event) => setDraft((current) => ({ ...current, modelId: event.target.value }))} /></label>
        {draft.mode === "byok" ? (
          <label><span>{t("aiHandoff.apiKey")}</span><input required type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => setDraft((current) => ({ ...current, apiKey: event.target.value }))} /></label>
        ) : null}
        <button className="primary-button" disabled={status === "saving-connection"}>{t("aiHandoff.saveConnection")}</button>
      </form>

      {connection ? <p className="handoff-connection-status">{t("aiHandoff.connectedTo", { name: connection.displayName, model: connection.modelId })}</p> : null}
      {connection ? <div className="handoff-model-discovery">
        <button type="button" className="text-button" disabled={modelStatus === "loading"} onClick={() => void discoverModels()}>
          {t(modelStatus === "loading" ? "aiHandoff.discoveringModels" : "aiHandoff.discoverModels")}
        </button>
        {models.length > 0 ? <label>
          <span>{t("aiHandoff.discoveredModel")}</span>
          <select value={connection.modelId} onChange={selectDiscoveredModel}>
            {models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}
          </select>
        </label> : <p>{t("aiHandoff.modelDiscoveryHint")}</p>}
      </div> : null}
      {errorCode ? <p className="cloud-error" role="alert">{t(`aiHandoff.errors.${errorCode}`, { defaultValue: t("aiHandoff.errors.request_failed") })}</p> : null}

      <div className="handoff-selection">
        <label><span>{t("aiHandoff.conversation")}</span><select value={conversationId} onChange={changeConversation}>{conversationList.map((item) => <option key={item.id} value={item.id}>{item.title || t("conversationImport.untitled")}</option>)}</select></label>
        <label><span>{t("aiHandoff.continueFrom")}</span><select value={sourceMessageId} onChange={(event) => { setSourceMessageId(event.target.value); resetReview(); }}>{conversation?.messages.map((message, index) => <option key={message.id} value={message.id} disabled={!branchTo(conversation, message.id)}>{index + 1}. {message.role} · {messageText(message).slice(0, 72)}</option>)}</select></label>
      </div>

      {sensitivePreparation?.findings.length > 0 ? <div className="handoff-sensitive" role="status">
        <div>
          <strong>{t("aiHandoff.sensitiveTitle")}</strong>
          <p>{t("aiHandoff.sensitiveDescription")}</p>
          <ul>{sensitivePreparation.findings.map((finding) => (
            <li key={finding.kind}>{t(`aiHandoff.sensitiveKinds.${finding.kind}`)} · {t("aiHandoff.findingCount", { count: finding.count })}</li>
          ))}</ul>
        </div>
        <label>
          <input type="checkbox" checked={maskSensitive} onChange={(event) => {
            setMaskSensitive(event.target.checked);
            resetReview();
          }} />
          <span>{t("aiHandoff.maskSensitive")}</span>
        </label>
      </div> : null}

      <div className="handoff-context">
        <div className="handoff-context-heading"><strong>{t("aiHandoff.contextTitle")}</strong><span>{t("aiHandoff.messageCount", { count: selectedMessages.length })}</span></div>
        <ol>{selectedMessages.map((message) => <li key={message.id}><span>{message.role}</span><p>{messageText(message) || t("aiHandoff.nonTextMessage")}</p></li>)}</ol>
      </div>

      <button type="button" className="primary-button" disabled={!connection || !selectedIds || status === "reviewing"} onClick={() => void createReview()}>{t("aiHandoff.reviewPayload")}</button>

      {preview ? <div className="handoff-review">
        <dl>
          <div><dt>{t("aiHandoff.destination")}</dt><dd>{connection.endpoint}</dd></div>
          <div><dt>{t("aiHandoff.model")}</dt><dd>{preview.modelId}</dd></div>
          <div><dt>{t("aiHandoff.estimatedUnits")}</dt><dd>{preview.estimatedInputUnits.toLocaleString(i18n.resolvedLanguage)}</dd></div>
          <div><dt>Context SHA-256</dt><dd><code>{preview.payloadHash}</code></dd></div>
          <div><dt>Outbound SHA-256</dt><dd><code>{preview.outboundPayloadHash}</code></dd></div>
        </dl>
        {preview.conversionWarnings.length > 0 ? <ul>{preview.conversionWarnings.map((warning) => <li key={warning}>{t(`aiHandoff.warnings.${warning}`, { defaultValue: warning })}</li>)}</ul> : null}
        <label className="handoff-consent"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>{t("aiHandoff.confirmSend", { count: selectedMessages.length, provider: connection.displayName })}</span></label>
        <div className="handoff-actions">
          <button type="button" className="primary-button" disabled={!confirmed || ["sending", "saving-result", "saving-cloud", "complete", "persistence-failed", "cloud-persistence-failed"].includes(status)} onClick={() => void sendHandoff()}>{t(status === "sending" ? "aiHandoff.sending" : status === "saving-result" ? "aiHandoff.savingContinuation" : status === "saving-cloud" ? "aiHandoff.cloudSaving" : "aiHandoff.send")}</button>
          {status === "sending" ? <button type="button" className="text-button" onClick={() => abortController.current?.abort()}>{t("aiHandoff.cancel")}</button> : null}
          {status === "persistence-failed" ? <button type="button" className="text-button" onClick={() => void retryPersistence()}>{t("aiHandoff.retryPersistence")}</button> : null}
          {status === "cloud-persistence-failed" ? <button type="button" className="text-button" onClick={() => void retryCloudPersistence()}>{t("aiHandoff.retryCloudPersistence")}</button> : null}
        </div>
        {status === "sending" && streamingText ? <div className="handoff-stream" aria-live="polite">
          <strong>{t("aiHandoff.streamingResponse")}</strong>
          <p>{streamingText}</p>
        </div> : null}
      </div> : null}
      {status === "complete" ? <p className="cloud-success" role="status">{t(cloudPersistenceStatus === "saved" ? "aiHandoff.cloudSaved" : persistenceStatus === "persisted" ? "aiHandoff.completePersisted" : "aiHandoff.completeMemory")}</p> : null}
      {persistenceStatus === "restored" ? <p className="cloud-success" role="status">{t("aiHandoff.restored")}</p> : null}
      {persistenceStatus === "restore-failed" ? <p className="cloud-error" role="alert">{t("aiHandoff.errors.local_ai_handoff_restore_failed")}</p> : null}
      <p className="import-privacy">{t("aiHandoff.privacy")}</p>
    </section>
  );
}
