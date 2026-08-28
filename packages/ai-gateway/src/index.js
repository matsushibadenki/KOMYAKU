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

export function createOpenAiCompatibleAdapter({ fetchImpl = fetch, maximumResponseBytes = 10 * 1024 * 1024 } = {}) {
  return Object.freeze({
    async describeCapabilities() {
      return { text: true, maximumContextUnits: 128000 };
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
        request: { model: modelId, messages: convertedMessages, stream: false },
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
          method: "POST", headers, body: JSON.stringify(request), signal
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
