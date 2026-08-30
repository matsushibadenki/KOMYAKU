import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  canonicalConversationSchema,
  conversationMessageSchema
} from "@komyaku/conversation-schema";

export const AI_PROVIDER_ADAPTER_METHODS = Object.freeze([
  "listModels",
  "describeCapabilities",
  "estimate",
  "convert",
  "send",
  "stream",
  "cancel"
]);

export const providerCapabilitiesSchema = z.object({
  text: z.boolean().default(true),
  images: z.boolean().default(false),
  files: z.boolean().default(false),
  audio: z.boolean().default(false),
  toolCalls: z.boolean().default(false),
  citations: z.boolean().default(false),
  streaming: z.boolean().default(false),
  maximumContextUnits: z.number().int().positive()
});

export const aiProviderConnectionSchema = z.object({
  id: z.string().uuid(),
  mode: z.enum(["local", "byok"]),
  providerType: z.string().min(1).max(100),
  displayName: z.string().min(1).max(300),
  endpoint: z.string().url().max(2000),
  credentialReference: z.string().min(1).max(300).nullable().default(null)
}).superRefine((connection, context) => {
  const url = new URL(connection.endpoint);
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash) {
    context.addIssue({ code: "custom", path: ["endpoint"], message: "Endpoint credentials, query, and fragment are not allowed" });
  }
  if (connection.mode === "local" && !loopback) {
    context.addIssue({ code: "custom", path: ["endpoint"], message: "Local providers must use a loopback endpoint" });
  }
  if (connection.mode === "byok" && (url.protocol !== "https:" || !connection.credentialReference)) {
    context.addIssue({ code: "custom", path: ["endpoint"], message: "BYOK providers require HTTPS and a credential reference" });
  }
});

export const providerModelSchema = z.object({
  id: z.string().min(1).max(300),
  displayName: z.string().min(1).max(300)
});

const SENSITIVE_PATTERNS = Object.freeze([
  { kind: "private_key", expression: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { kind: "api_key", expression: /\b(?:sk-ant-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})\b/g },
  { kind: "bearer_token", expression: /\bBearer\s+[A-Za-z0-9._~+\/-]{12,}={0,2}\b/gi },
  { kind: "labeled_secret", expression: /\b(?:api[_ -]?key|access[_ -]?token|password|secret)\s*[:=]\s*[^\s,;]{8,}/gi },
  { kind: "email", expression: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi }
]);

function maskText(text) {
  const matches = [];
  for (const pattern of SENSITIVE_PATTERNS) {
    pattern.expression.lastIndex = 0;
    for (const match of text.matchAll(pattern.expression)) {
      matches.push({ start: match.index, end: match.index + match[0].length, kind: pattern.kind });
    }
  }
  matches.sort((left, right) => left.start - right.start || right.end - left.end);
  const accepted = [];
  let coveredUntil = -1;
  for (const match of matches) {
    if (match.start < coveredUntil) continue;
    accepted.push(match);
    coveredUntil = match.end;
  }
  if (accepted.length === 0) return { text, kinds: [] };
  let cursor = 0;
  let masked = "";
  for (const match of accepted) {
    masked += text.slice(cursor, match.start);
    masked += `[REDACTED:${match.kind.toUpperCase()}]`;
    cursor = match.end;
  }
  return { text: masked + text.slice(cursor), kinds: accepted.map((match) => match.kind) };
}

export function prepareSensitiveHandoff(conversationInput, selectedMessageIds) {
  const conversation = canonicalConversationSchema.parse(conversationInput);
  const selected = new Set(z.array(z.string().uuid()).min(1).parse(selectedMessageIds));
  const counts = new Map();
  const messages = conversation.messages.map((message) => {
    if (!selected.has(message.id)) return message;
    let changed = false;
    const contentParts = message.contentParts.map((part) => {
      if (part.type !== "text") return part;
      const result = maskText(part.text);
      for (const kind of result.kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
      if (result.text === part.text) return part;
      changed = true;
      return { ...part, text: result.text };
    });
    return changed ? { ...message, contentParts } : message;
  });
  return Object.freeze({
    maskedConversation: counts.size > 0
      ? canonicalConversationSchema.parse({ ...conversation, messages })
      : conversation,
    findings: [...counts.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, count]) => Object.freeze({ kind, count }))
  });
}

export const convertedHandoffSchema = z.object({
  request: z.record(z.string(), z.unknown()),
  warnings: z.array(z.string().min(1).max(300)).default([]),
  estimatedInputUnits: z.number().int().nonnegative(),
  estimatedCostMinor: z.number().int().nonnegative().nullable().default(null),
  currency: z.string().length(3).nullable().default(null)
});

export const handoffSelectionSchema = z.object({
  providerConnectionId: z.string().uuid(),
  providerType: z.string().min(1).max(100),
  modelId: z.string().min(1).max(300),
  sourceMessageId: z.string().uuid(),
  selectedMessageIds: z.array(z.string().uuid()).min(1),
  selectedAssetIds: z.array(z.string().uuid()).default([]),
  conversionWarnings: z.array(z.string().max(1000)).default([]),
  estimatedInputUnits: z.number().int().nonnegative(),
  estimatedCostMinor: z.number().int().nonnegative().nullable().default(null),
  currency: z.string().length(3).nullable().default(null)
});

export const handoffPreviewSchema = handoffSelectionSchema.extend({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  outboundPayloadHash: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  createdAt: z.string().datetime({ offset: true })
});

export const confirmedHandoffSchema = handoffPreviewSchema.extend({
  consentedBy: z.string().uuid(),
  consentedAt: z.string().datetime({ offset: true })
});

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, stableValue(nested)])
    );
  }
  return value;
}

export async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function handoffContextHash(conversationId, selection, selectedMessages) {
  return sha256Hex({
    conversationId,
    providerConnectionId: selection.providerConnectionId,
    providerType: selection.providerType,
    modelId: selection.modelId,
    selectedMessages,
    selectedAssetIds: selection.selectedAssetIds,
    conversionWarnings: selection.conversionWarnings
  });
}

function selectedBranch(conversation, selection) {
  const messagesById = new Map(conversation.messages.map((message) => [message.id, message]));
  const edgeKeys = new Set(conversation.edges.map((edge) => `${edge.parentMessageId}:${edge.childMessageId}`));
  const selected = selection.selectedMessageIds.map((id) => {
    const message = messagesById.get(id);
    if (!message) throw new Error("selected_message_not_in_conversation");
    return message;
  });
  if (selected.at(-1)?.id !== selection.sourceMessageId) throw new Error("source_message_must_end_selection");
  for (let index = 1; index < selected.length; index += 1) {
    if (!edgeKeys.has(`${selected[index - 1].id}:${selected[index].id}`)) {
      throw new Error("selected_messages_must_form_one_branch");
    }
  }
  return selected;
}

export async function createHandoffPreview(conversationInput, selectionInput) {
  const conversation = canonicalConversationSchema.parse(conversationInput);
  const selection = handoffSelectionSchema.parse(selectionInput);
  const messagesById = new Map(conversation.messages.map((message) => [message.id, message]));

  if (!messagesById.has(selection.sourceMessageId)) {
    throw new Error("Source message is not part of the conversation");
  }

  const selectedMessages = selection.selectedMessageIds.map((id) => {
    const message = messagesById.get(id);
    if (!message) throw new Error(`Selected message is not part of the conversation: ${id}`);
    return message;
  });

  if (!selection.selectedMessageIds.includes(selection.sourceMessageId)) {
    throw new Error("Selected messages must include the source message");
  }

  const payloadHash = await handoffContextHash(conversation.id, selection, selectedMessages);

  return handoffPreviewSchema.parse({
    ...selection,
    id: uuidv7(),
    conversationId: conversation.id,
    payloadHash,
    createdAt: new Date().toISOString()
  });
}

function assertAdapter(adapter) {
  for (const method of ["describeCapabilities", "convert", "send"]) {
    if (typeof adapter?.[method] !== "function") throw new Error(`provider_adapter_missing_${method}`);
  }
  return adapter;
}

export function createAiProviderGateway({ adapters, resolveCredential = async () => null } = {}) {
  const registry = new Map(Object.entries(adapters ?? {}).map(([type, adapter]) => [type, assertAdapter(adapter)]));

  function adapterFor(providerType) {
    const adapter = registry.get(providerType);
    if (!adapter) throw new Error("unsupported_ai_provider");
    return adapter;
  }

  return Object.freeze({
    async listModels({ connection: connectionInput, signal } = {}) {
      const connection = aiProviderConnectionSchema.parse(connectionInput);
      const adapter = adapterFor(connection.providerType);
      if (typeof adapter.listModels !== "function") throw new Error("provider_model_discovery_unsupported");
      const credentialInput = connection.credentialReference
        ? await resolveCredential(connection.credentialReference)
        : null;
      if (connection.credentialReference && !credentialInput) throw new Error("provider_credential_unavailable");
      const credential = credentialInput === null
        ? null
        : z.string().min(1).max(10000).parse(credentialInput);
      return z.array(providerModelSchema).max(1000).parse(
        await adapter.listModels({ connection, credential, signal })
      );
    },

    async preview({ conversation: conversationInput, connection: connectionInput, modelId, sourceMessageId, selectedMessageIds, selectedAssetIds = [] }) {
      const conversation = canonicalConversationSchema.parse(conversationInput);
      const connection = aiProviderConnectionSchema.parse(connectionInput);
      const selectedMessages = selectedBranch(conversation, { sourceMessageId, selectedMessageIds });
      const adapter = adapterFor(connection.providerType);
      const capabilities = providerCapabilitiesSchema.parse(await adapter.describeCapabilities({ connection, modelId }));
      const converted = convertedHandoffSchema.parse(await adapter.convert({
        connection, modelId, messages: selectedMessages, selectedAssetIds, capabilities
      }));
      const outboundPayloadHash = await sha256Hex(converted.request);
      const preview = await createHandoffPreview(conversation, {
        providerConnectionId: connection.id,
        providerType: connection.providerType,
        modelId,
        sourceMessageId,
        selectedMessageIds,
        selectedAssetIds,
        conversionWarnings: converted.warnings,
        estimatedInputUnits: converted.estimatedInputUnits,
        estimatedCostMinor: converted.estimatedCostMinor,
        currency: converted.currency
      });
      return handoffPreviewSchema.parse({ ...preview, outboundPayloadHash });
    },

    async send({ conversation: conversationInput, connection: connectionInput, confirmed: confirmedInput, signal }) {
      const conversation = canonicalConversationSchema.parse(conversationInput);
      const connection = aiProviderConnectionSchema.parse(connectionInput);
      const confirmed = confirmedHandoffSchema.parse(confirmedInput);
      if (confirmed.providerConnectionId !== connection.id || confirmed.providerType !== connection.providerType) {
        throw new Error("handoff_connection_changed");
      }
      const selectedMessages = selectedBranch(conversation, confirmed);
      if (await handoffContextHash(conversation.id, confirmed, selectedMessages) !== confirmed.payloadHash) {
        throw new Error("handoff_context_changed_review_required");
      }
      const adapter = adapterFor(connection.providerType);
      const capabilities = providerCapabilitiesSchema.parse(await adapter.describeCapabilities({ connection, modelId: confirmed.modelId }));
      const converted = convertedHandoffSchema.parse(await adapter.convert({
        connection, modelId: confirmed.modelId, messages: selectedMessages,
        selectedAssetIds: confirmed.selectedAssetIds, capabilities
      }));
      if (await sha256Hex(converted.request) !== confirmed.outboundPayloadHash) {
        throw new Error("handoff_payload_changed_review_required");
      }
      const credentialInput = connection.credentialReference
        ? await resolveCredential(connection.credentialReference)
        : null;
      if (connection.credentialReference && !credentialInput) throw new Error("provider_credential_unavailable");
      const credential = credentialInput === null
        ? null
        : z.string().min(1).max(10000).parse(credentialInput);
      return adapter.send({ connection, credential, request: converted.request, signal });
    },

    async stream({ conversation: conversationInput, connection: connectionInput, confirmed: confirmedInput, signal, onDelta }) {
      const conversation = canonicalConversationSchema.parse(conversationInput);
      const connection = aiProviderConnectionSchema.parse(connectionInput);
      const confirmed = confirmedHandoffSchema.parse(confirmedInput);
      if (confirmed.providerConnectionId !== connection.id || confirmed.providerType !== connection.providerType) {
        throw new Error("handoff_connection_changed");
      }
      const selectedMessages = selectedBranch(conversation, confirmed);
      if (await handoffContextHash(conversation.id, confirmed, selectedMessages) !== confirmed.payloadHash) {
        throw new Error("handoff_context_changed_review_required");
      }
      const adapter = adapterFor(connection.providerType);
      if (typeof adapter.stream !== "function") throw new Error("ai_provider_streaming_unsupported");
      const capabilities = providerCapabilitiesSchema.parse(await adapter.describeCapabilities({ connection, modelId: confirmed.modelId }));
      if (!capabilities.streaming) throw new Error("ai_provider_streaming_unsupported");
      const converted = convertedHandoffSchema.parse(await adapter.convert({
        connection, modelId: confirmed.modelId, messages: selectedMessages,
        selectedAssetIds: confirmed.selectedAssetIds, capabilities
      }));
      if (await sha256Hex(converted.request) !== confirmed.outboundPayloadHash) {
        throw new Error("handoff_payload_changed_review_required");
      }
      const credentialInput = connection.credentialReference
        ? await resolveCredential(connection.credentialReference)
        : null;
      if (connection.credentialReference && !credentialInput) throw new Error("provider_credential_unavailable");
      const credential = credentialInput === null
        ? null
        : z.string().min(1).max(10000).parse(credentialInput);
      return adapter.stream({
        connection,
        credential,
        request: converted.request,
        signal,
        onDelta: typeof onDelta === "function" ? onDelta : () => {}
      });
    }
  });
}

function textFromMessage(message, warnings) {
  const parts = [];
  for (const part of message.contentParts) {
    if (part.type === "text") parts.push(part.text);
    else warnings.add(`omitted_${part.type}`);
  }
  return parts.join("\n");
}

function endpoint(base, suffix) {
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/\/$/, "")}${suffix}`;
  return url.toString();
}

export function createOpenAiCompatibleAdapter({
  fetchImpl = fetch,
  maximumResponseBytes = 10 * 1024 * 1024,
  maximumModelResponseBytes = 1024 * 1024
} = {}) {
  return Object.freeze({
    async listModels({ connection, credential, signal }) {
      const headers = { Accept: "application/json" };
      if (credential) headers.Authorization = `Bearer ${credential}`;
      let response;
      try {
        response = await fetchImpl(endpoint(connection.endpoint, "/models"), {
          method: "GET", headers, signal
        });
      } catch {
        throw new Error("ai_provider_unavailable");
      }
      const declaredLength = Number(response.headers.get("Content-Length"));
      if (declaredLength > maximumModelResponseBytes) throw new Error("provider_model_response_too_large");
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > maximumModelResponseBytes) {
        throw new Error("provider_model_response_too_large");
      }
      if (!response.ok) {
        throw new Error(response.status === 429 ? "ai_provider_rate_limited" : "provider_model_discovery_failed");
      }
      let value;
      try { value = JSON.parse(raw); } catch { throw new Error("invalid_provider_model_response"); }
      if (!Array.isArray(value?.data)) throw new Error("invalid_provider_model_response");
      const identifiers = value.data.map((model) => model?.id);
      if (identifiers.length > 1000 || identifiers.some((id) => typeof id !== "string" || id.length < 1 || id.length > 300)) {
        throw new Error("invalid_provider_model_response");
      }
      return [...new Set(identifiers)]
        .sort((left, right) => left.localeCompare(right))
        .map((id) => ({ id, displayName: id }));
    },
    async describeCapabilities() {
      return { text: true, streaming: true, maximumContextUnits: 128000 };
    },
    async convert({ modelId, messages, selectedAssetIds }) {
      const warnings = new Set();
      if (selectedAssetIds.length > 0) warnings.add("omitted_assets");
      const convertedMessages = messages.map((message) => ({
        role: ["system", "user", "assistant", "tool"].includes(message.role) ? message.role : "user",
        content: textFromMessage(message, warnings)
      }));
      const characters = convertedMessages.reduce((sum, message) => sum + message.content.length, 0);
      return {
        request: { model: modelId, messages: convertedMessages },
        warnings: [...warnings].sort(),
        estimatedInputUnits: Math.ceil(characters / 4),
        estimatedCostMinor: null,
        currency: null
      };
    },
    async send({ connection, credential, request, signal }) {
      const headers = { "Content-Type": "application/json" };
      if (credential) headers.Authorization = `Bearer ${credential}`;
      let response;
      try {
        response = await fetchImpl(endpoint(connection.endpoint, "/chat/completions"), {
          method: "POST", headers, body: JSON.stringify({ ...request, stream: false }), signal
        });
      } catch {
        throw new Error("ai_provider_unavailable");
      }
      const declaredLength = Number(response.headers.get("Content-Length"));
      if (declaredLength > maximumResponseBytes) throw new Error("ai_provider_response_too_large");
      const raw = await response.text();
      if (new TextEncoder().encode(raw).byteLength > maximumResponseBytes) throw new Error("ai_provider_response_too_large");
      if (!response.ok) throw new Error(response.status === 429 ? "ai_provider_rate_limited" : "ai_provider_request_failed");
      let value;
      try { value = JSON.parse(raw); } catch { throw new Error("invalid_ai_provider_response"); }
      const content = value?.choices?.[0]?.message?.content;
      if (typeof content !== "string") throw new Error("invalid_ai_provider_response");
      return {
        providerResponseId: typeof value.id === "string" ? value.id : null,
        modelId: typeof value.model === "string" ? value.model : request.model,
        contentParts: [{ type: "text", text: content }]
      };
    },
    async stream({ connection, credential, request, signal, onDelta }) {
      const headers = { "Content-Type": "application/json", Accept: "text/event-stream" };
      if (credential) headers.Authorization = `Bearer ${credential}`;
      let response;
      try {
        response = await fetchImpl(endpoint(connection.endpoint, "/chat/completions"), {
          method: "POST", headers, body: JSON.stringify({ ...request, stream: true }), signal
        });
      } catch {
        throw new Error(signal?.aborted ? "ai_provider_cancelled" : "ai_provider_unavailable");
      }
      if (!response.ok) throw new Error(response.status === 429 ? "ai_provider_rate_limited" : "ai_provider_request_failed");
      if (!response.body) throw new Error("invalid_ai_provider_stream");
      const contentType = response.headers.get("Content-Type")?.toLowerCase() ?? "";
      if (!contentType.startsWith("text/event-stream")) throw new Error("invalid_ai_provider_stream");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();
      let buffer = "";
      let totalBytes = 0;
      let content = "";
      let providerResponseId = null;
      let responseModelId = request.model;

      const consumeEvent = (event) => {
        const data = event.split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") return data === "[DONE]";
        let value;
        try { value = JSON.parse(data); } catch { throw new Error("invalid_ai_provider_stream"); }
        const delta = value?.choices?.[0]?.delta?.content;
        if (delta !== undefined && typeof delta !== "string") throw new Error("invalid_ai_provider_stream");
        if (typeof value?.id === "string") providerResponseId = value.id;
        if (typeof value?.model === "string") responseModelId = value.model;
        if (delta) {
          content += delta;
          if (encoder.encode(content).byteLength > maximumResponseBytes) throw new Error("ai_provider_response_too_large");
          onDelta(delta);
        }
        return false;
      };

      try {
        let doneEvent = false;
        while (!doneEvent) {
          const chunk = await reader.read();
          if (chunk.done) break;
          totalBytes += chunk.value.byteLength;
          if (totalBytes > maximumResponseBytes) throw new Error("ai_provider_response_too_large");
          buffer += decoder.decode(chunk.value, { stream: true }).replaceAll("\r\n", "\n");
          let boundary;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const event = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            doneEvent = consumeEvent(event);
            if (doneEvent) break;
          }
        }
        if (!content) throw new Error("invalid_ai_provider_stream");
      } catch (error) {
        if (signal?.aborted) throw new Error("ai_provider_cancelled");
        throw error;
      } finally {
        reader.releaseLock();
      }
      return {
        providerResponseId,
        modelId: responseModelId,
        contentParts: [{ type: "text", text: content }]
      };
    }
  });
}

export function appendContinuationBranch(conversationInput, confirmedInput, responseInput) {
  const conversation = canonicalConversationSchema.parse(conversationInput);
  const confirmed = confirmedHandoffSchema.parse(confirmedInput);
  if (confirmed.conversationId !== conversation.id) throw new Error("handoff_conversation_changed");
  const message = conversationMessageSchema.parse({
    id: uuidv7(),
    conversationId: conversation.id,
    sourceProvider: confirmed.providerType,
    sourceMessageId: responseInput.providerResponseId ?? null,
    role: "assistant",
    contentParts: responseInput.contentParts,
    modelMetadata: { modelId: responseInput.modelId, handoffId: confirmed.id },
    toolMetadata: {},
    attachmentIds: []
  });
  return canonicalConversationSchema.parse({
    ...conversation,
    messages: [...conversation.messages, message],
    edges: [...conversation.edges, {
      parentMessageId: confirmed.sourceMessageId,
      childMessageId: message.id,
      kind: "ai_continuation"
    }]
  });
}

export function confirmHandoff(previewInput, { expectedPayloadHash, consentedBy }) {
  const preview = handoffPreviewSchema.parse(previewInput);
  if (preview.payloadHash !== expectedPayloadHash) {
    throw new Error("Handoff context changed and must be reviewed again");
  }

  return confirmedHandoffSchema.parse({
    ...preview,
    consentedBy,
    consentedAt: new Date().toISOString()
  });
}
