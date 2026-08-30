import { canonicalConversationSchema } from "@komyaku/conversation-schema";
import { v5 as uuidv5, v7 as uuidv7 } from "uuid";
import { z } from "zod";

export const GENERIC_JSON_PARSER_NAME = "komyaku-generic-json";
export const GENERIC_JSON_PARSER_VERSION = "1.1.0";
export const CHATGPT_EXPORT_PARSER_NAME = "komyaku-chatgpt-export";
export const CHATGPT_EXPORT_PARSER_VERSION = "1.1.0";
export const CLAUDE_EXPORT_PARSER_NAME = "komyaku-claude-export";
export const CLAUDE_EXPORT_PARSER_VERSION = "1.1.0";
export const GEMINI_EXPORT_PARSER_NAME = "komyaku-gemini-export";
export const GEMINI_EXPORT_PARSER_VERSION = "1.1.0";
export const DEFAULT_MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_IMPORT_MESSAGES = 10_000;
export const IMPORT_IDENTITY_VERSION = 1;
const IMPORT_IDENTITY_NAMESPACE = "8de88d02-537d-5d6f-9e6b-77ee3f509745";

const optionsSchema = z.object({
  sourceProvider: z.string().min(1).max(100).default("generic"),
  importId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  identityKey: z.string().min(1).max(1000).default("ordinal:0"),
  identityScope: z.string().min(1).max(200).default("local"),
  maxBytes: z.number().int().positive().default(DEFAULT_MAX_IMPORT_BYTES),
  maxMessages: z.number().int().positive().default(DEFAULT_MAX_IMPORT_MESSAGES),
  parserName: z.string().min(1).max(100).default(GENERIC_JSON_PARSER_NAME),
  parserVersion: z.string().min(1).max(50).default(GENERIC_JSON_PARSER_VERSION),
  provenanceRawBytes: z.instanceof(Uint8Array).optional(),
  initialWarnings: z.array(z.string()).default([])
});

const envelopeSchema = z.object({
  title: z.string().max(1000).optional(),
  defaultLanguage: z.string().min(1).max(100).optional(),
  schemaVersion: z.union([z.string(), z.number()]).optional(),
  messages: z.array(z.unknown())
}).passthrough();

function toBytes(input) {
  if (typeof input === "string") return new TextEncoder().encode(input);
  if (input instanceof Uint8Array) return input;
  throw new TypeError("Conversation import input must be a string or Uint8Array");
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function deterministicImportUuid(kind, ...parts) {
  return uuidv5([
    `komyaku-import-identity-v${IMPORT_IDENTITY_VERSION}`,
    kind,
    ...parts
  ].join("\u0000"), IMPORT_IDENTITY_NAMESPACE);
}

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function sourceId(value, index) {
  if (typeof value === "string" || typeof value === "number") return String(value);
  return `message-${index + 1}`;
}

function optionalTimestamp(value, field, index, warnings) {
  if (value === undefined || value === null) return undefined;
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  warnings.push(`messages[${index}].${field} was not a valid timestamp and was preserved in metadata`);
  return undefined;
}

function contentParts(content) {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (content === undefined || content === null) return [];

  const values = Array.isArray(content) ? content : [content];
  return values.map((part) => {
    if (typeof part === "string") return { type: "text", text: part };
    if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
      return { type: "text", text: part.text };
    }
    const providerType = part && typeof part === "object" && typeof part.type === "string"
      ? part.type
      : "unknown";
    return { type: "unknown_provider_part", providerType, raw: part };
  });
}

function recordMetadata(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

export async function importGenericJsonConversation(input, optionsInput = {}) {
  const options = optionsSchema.parse(optionsInput);
  const rawBytes = toBytes(input);
  const provenanceRawBytes = options.provenanceRawBytes ?? rawBytes;
  if (rawBytes.byteLength > options.maxBytes || provenanceRawBytes.byteLength > options.maxBytes) {
    throw new Error(`Conversation import exceeds the ${options.maxBytes} byte limit`);
  }

  let decoded;
  try {
    decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes));
  } catch (error) {
    throw new Error("Conversation import is not valid UTF-8 JSON", { cause: error });
  }

  const envelope = envelopeSchema.parse(Array.isArray(decoded) ? { messages: decoded } : decoded);
  if (envelope.messages.length > options.maxMessages) {
    throw new Error(`Conversation import exceeds the ${options.maxMessages} message limit`);
  }

  const sourceHash = await sha256Hex(provenanceRawBytes);
  const importId = options.importId ?? uuidv7();
  const conversationId = options.conversationId ?? deterministicImportUuid(
    "conversation", options.identityScope, options.parserName, options.parserVersion, sourceHash, options.identityKey
  );
  const warnings = [...options.initialWarnings];
  const sourceToInternal = new Map();
  const duplicateCounts = new Map();

  const prepared = envelope.messages.map((rawMessage, index) => {
    if (!rawMessage || typeof rawMessage !== "object" || Array.isArray(rawMessage)) {
      throw new Error(`messages[${index}] must be an object`);
    }

    const originalSourceId = sourceId(rawMessage.id, index);
    const duplicateNumber = duplicateCounts.get(originalSourceId) ?? 0;
    duplicateCounts.set(originalSourceId, duplicateNumber + 1);
    const effectiveSourceId = duplicateNumber === 0
      ? originalSourceId
      : `${originalSourceId}#duplicate-${duplicateNumber + 1}`;
    if (duplicateNumber > 0) {
      warnings.push(`messages[${index}].id duplicated ${originalSourceId}; retained as ${effectiveSourceId}`);
    }

    const internalId = deterministicImportUuid("message", conversationId, effectiveSourceId);
    if (!sourceToInternal.has(originalSourceId)) sourceToInternal.set(originalSourceId, internalId);

    const createdAtSource = optionalTimestamp(
      rawMessage.createdAt ?? rawMessage.created_at ?? rawMessage.timestamp,
      "createdAt",
      index,
      warnings
    );
    const editedAtSource = optionalTimestamp(
      rawMessage.editedAt ?? rawMessage.edited_at,
      "editedAt",
      index,
      warnings
    );
    const importedMetadata = {
      ...recordMetadata(rawMessage.metadata),
      ...(rawMessage.model !== undefined ? { model: rawMessage.model } : {}),
      ...(duplicateNumber > 0 ? { originalSourceMessageId: originalSourceId } : {}),
      ...(!createdAtSource && (rawMessage.createdAt ?? rawMessage.created_at ?? rawMessage.timestamp) != null
        ? { originalCreatedAt: rawMessage.createdAt ?? rawMessage.created_at ?? rawMessage.timestamp }
        : {}),
      ...(!editedAtSource && (rawMessage.editedAt ?? rawMessage.edited_at) != null
        ? { originalEditedAt: rawMessage.editedAt ?? rawMessage.edited_at }
        : {})
    };

    return {
      rawMessage,
      originalSourceId,
      internalId,
      message: {
        id: internalId,
        conversationId,
        sourceProvider: typeof rawMessage.provider === "string" ? rawMessage.provider : options.sourceProvider,
        sourceMessageId: effectiveSourceId,
        role: typeof rawMessage.role === "string" && rawMessage.role.length > 0 ? rawMessage.role : "unknown",
        authorLabel: typeof rawMessage.author === "string" ? rawMessage.author : undefined,
        contentParts: contentParts(rawMessage.content ?? rawMessage.parts),
        createdAtSource,
        editedAtSource,
        modelMetadata: importedMetadata,
        toolMetadata: recordMetadata(rawMessage.toolMetadata ?? rawMessage.tool_metadata),
        attachmentIds: [],
        importProvenance: {
          importId,
          sourceProvider: options.sourceProvider,
          sourceHash,
          parserName: options.parserName,
          parserVersion: options.parserVersion
        }
      }
    };
  });

  const edges = [];
  for (const [index, item] of prepared.entries()) {
    const { rawMessage, internalId } = item;
    if (own(rawMessage, "parentId") || own(rawMessage, "parent_id")) {
      const rawParentId = own(rawMessage, "parentId") ? rawMessage.parentId : rawMessage.parent_id;
      if (rawParentId === null || rawParentId === undefined) continue;
      const parentId = sourceToInternal.get(String(rawParentId));
      if (!parentId) {
        warnings.push(`messages[${index}] references missing parent ${String(rawParentId)}`);
        continue;
      }
      edges.push({ parentMessageId: parentId, childMessageId: internalId, kind: "reply" });
    } else if (index > 0) {
      edges.push({ parentMessageId: prepared[index - 1].internalId, childMessageId: internalId, kind: "reply" });
    }
  }

  const conversation = canonicalConversationSchema.parse({
    schemaVersion: 1,
    id: conversationId,
    title: envelope.title ?? "",
    defaultLanguage: envelope.defaultLanguage ?? "und",
    messages: prepared.map(({ message }) => message),
    edges,
    providerMetadata: {
      importedBy: options.parserName,
      importIdentityVersion: IMPORT_IDENTITY_VERSION,
      importIdentityScope: options.identityScope,
      importIdentityKey: options.identityKey,
      ...(envelope.sourceConversationId != null
        ? { sourceConversationId: String(envelope.sourceConversationId) }
        : {}),
      ...(envelope.schemaVersion !== undefined ? { sourceSchemaVersion: String(envelope.schemaVersion) } : {})
    }
  });

  return Object.freeze({
    conversation,
    importId,
    sourceHash,
    sourceSchemaVersion: envelope.schemaVersion === undefined ? null : String(envelope.schemaVersion),
    warnings: Object.freeze(warnings),
    status: warnings.length === 0 ? "complete" : "partial",
    rawBytes: provenanceRawBytes
  });
}

function decodeExport(input, maxBytes) {
  const rawBytes = toBytes(input);
  if (rawBytes.byteLength > maxBytes) {
    throw new Error(`Conversation import exceeds the ${maxBytes} byte limit`);
  }
  try {
    return {
      rawBytes,
      decoded: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBytes))
    };
  } catch (error) {
    throw new Error("Conversation import is not valid UTF-8 JSON", { cause: error });
  }
}

function timestampFromSeconds(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return value;
  return new Date(value * 1000).toISOString();
}

function bundleResult(results, rawBytes, provider) {
  const warnings = results.flatMap((result, index) =>
    result.warnings.map((warning) => `conversations[${index}]: ${warning}`));
  return Object.freeze({
    provider,
    conversations: Object.freeze(results.map((result) => result.conversation)),
    importId: results[0]?.importId ?? null,
    sourceHash: results[0]?.sourceHash ?? null,
    warnings: Object.freeze(warnings),
    status: warnings.length === 0 ? "complete" : "partial",
    rawBytes
  });
}

async function importProviderEnvelopes(envelopes, rawBytes, options, parser) {
  if (envelopes.length === 0) throw new Error(`${parser.provider} export contains no conversations`);
  const totalMessages = envelopes.reduce((count, envelope) => count + envelope.messages.length, 0);
  if (totalMessages > options.maxMessages) {
    throw new Error(`Conversation import exceeds the ${options.maxMessages} message limit`);
  }
  const importId = options.importId ?? uuidv7();
  const results = [];
  const identityCounts = new Map();
  for (const [index, envelope] of envelopes.entries()) {
    const baseIdentityKey = envelope.sourceConversationId == null
      ? `ordinal:${index}`
      : `source:${String(envelope.sourceConversationId)}`;
    const duplicate = identityCounts.get(baseIdentityKey) ?? 0;
    identityCounts.set(baseIdentityKey, duplicate + 1);
    const identityKey = duplicate === 0 ? baseIdentityKey : `${baseIdentityKey}#duplicate-${duplicate + 1}`;
    results.push(await importGenericJsonConversation(JSON.stringify(envelope), {
      sourceProvider: parser.provider,
      importId,
      maxBytes: options.maxBytes,
      maxMessages: options.maxMessages,
      parserName: parser.name,
      parserVersion: parser.version,
      provenanceRawBytes: rawBytes,
      initialWarnings: [
        ...(envelope.adapterWarnings ?? []),
        ...(duplicate > 0 ? [`source conversation identity duplicated; retained as ${identityKey}`] : [])
      ],
      identityKey,
      identityScope: options.identityScope
    }));
  }
  return bundleResult(results, rawBytes, parser.provider);
}

function providerOptions(optionsInput = {}) {
  return optionsSchema.pick({ importId: true, identityScope: true, maxBytes: true, maxMessages: true }).parse(optionsInput);
}

function chatGptParent(mapping, node) {
  const visited = new Set();
  let parentId = node?.parent;
  while (parentId != null && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = mapping[parentId];
    if (!parent) return { parentId: null, warning: "mapping parent chain referenced a missing node" };
    if (parent.message) return { parentId, warning: null };
    parentId = parent.parent;
  }
  return parentId == null
    ? { parentId: null, warning: null }
    : { parentId: null, warning: "mapping parent chain contained a cycle" };
}

function normalizeChatGptConversation(conversation, index) {
  if (!conversation || typeof conversation !== "object" || Array.isArray(conversation)) {
    throw new Error(`conversations[${index}] must be an object`);
  }
  const mapping = conversation.mapping;
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new Error(`conversations[${index}].mapping must be an object`);
  }
  const adapterWarnings = [];
  const messages = [];
  for (const [nodeId, node] of Object.entries(mapping)) {
    if (!node || typeof node !== "object" || !node.message) continue;
    const message = node.message;
    const content = message.content && typeof message.content === "object"
      ? message.content
      : {};
    const parent = chatGptParent(mapping, node);
    if (parent.warning) adapterWarnings.push(`mapping.${nodeId}: ${parent.warning}`);
    messages.push({
      id: nodeId,
      parentId: parent.parentId,
      role: message.author?.role ?? "unknown",
      author: message.author?.name,
      content: content.parts ?? [],
      createdAt: timestampFromSeconds(message.create_time),
      editedAt: timestampFromSeconds(message.update_time),
      model: message.metadata?.model_slug,
      metadata: {
        ...(message.metadata && typeof message.metadata === "object" ? message.metadata : {}),
        providerMessageId: message.id,
        contentType: content.content_type
      }
    });
  }
  return {
    sourceConversationId: conversation.id ?? conversation.conversation_id ?? null,
    title: typeof conversation.title === "string" ? conversation.title : "",
    schemaVersion: "chatgpt-mapping",
    messages,
    adapterWarnings
  };
}

export async function importChatGptExport(input, optionsInput = {}) {
  const options = providerOptions(optionsInput);
  const { rawBytes, decoded } = decodeExport(input, options.maxBytes);
  const conversations = Array.isArray(decoded) ? decoded : decoded?.conversations;
  if (!Array.isArray(conversations)) throw new Error("ChatGPT export must contain a conversation array");
  const envelopes = conversations.map(normalizeChatGptConversation);
  return importProviderEnvelopes(envelopes, rawBytes, options, {
    provider: "chatgpt",
    name: CHATGPT_EXPORT_PARSER_NAME,
    version: CHATGPT_EXPORT_PARSER_VERSION
  });
}

function normalizeClaudeConversation(conversation, index) {
  if (!conversation || typeof conversation !== "object" || !Array.isArray(conversation.chat_messages)) {
    throw new Error(`conversations[${index}].chat_messages must be an array`);
  }
  return {
    sourceConversationId: conversation.uuid ?? conversation.id ?? null,
    title: typeof conversation.name === "string" ? conversation.name : "",
    schemaVersion: "claude-chat-messages",
    messages: conversation.chat_messages.map((message, messageIndex) => ({
      id: message.uuid ?? `message-${messageIndex + 1}`,
      role: message.sender === "human" ? "user" : message.sender ?? "unknown",
      content: Array.isArray(message.content) ? message.content : message.text ?? "",
      createdAt: message.created_at,
      editedAt: message.updated_at,
      metadata: {
        ...(Array.isArray(message.attachments) ? { attachments: message.attachments } : {}),
        ...(Array.isArray(message.files) ? { files: message.files } : {})
      }
    }))
  };
}

export async function importClaudeExport(input, optionsInput = {}) {
  const options = providerOptions(optionsInput);
  const { rawBytes, decoded } = decodeExport(input, options.maxBytes);
  const conversations = Array.isArray(decoded) ? decoded : decoded?.conversations;
  if (!Array.isArray(conversations)) throw new Error("Claude export must contain a conversation array");
  return importProviderEnvelopes(conversations.map(normalizeClaudeConversation), rawBytes, options, {
    provider: "claude",
    name: CLAUDE_EXPORT_PARSER_NAME,
    version: CLAUDE_EXPORT_PARSER_VERSION
  });
}

function normalizeGeminiStructuredConversation(conversation, index) {
  if (!conversation || typeof conversation !== "object" || !Array.isArray(conversation.entries)) {
    throw new Error(`conversations[${index}].entries must be an array`);
  }
  return {
    sourceConversationId: conversation.id ?? conversation.conversation_id ?? null,
    title: typeof conversation.title === "string" ? conversation.title : "",
    schemaVersion: "gemini-structured-entries",
    messages: conversation.entries.map((entry, entryIndex) => ({
      id: entry.id ?? `entry-${entryIndex + 1}`,
      role: entry.role === "model" ? "assistant" : entry.role ?? "unknown",
      content: entry.content ?? entry.text ?? entry.parts ?? "",
      createdAt: timestampFromSeconds(entry.created_at ?? entry.create_time ?? entry.timestamp),
      metadata: recordMetadata(entry.metadata)
    }))
  };
}

function geminiActivityHtml(entry) {
  if (!Array.isArray(entry.safeHtmlItem)) return [];
  return entry.safeHtmlItem
    .filter((item) => item && typeof item === "object" && typeof item.html === "string")
    .map((item) => ({ type: "gemini_safe_html", html: item.html }));
}

function normalizeGeminiActivity(entry, index) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`activity[${index}] must be an object`);
  }
  const title = typeof entry.title === "string" ? entry.title : `Gemini activity ${index + 1}`;
  const htmlParts = geminiActivityHtml(entry);
  const messages = [{
    id: `activity-${index + 1}-prompt`,
    parentId: null,
    role: "user",
    content: title,
    createdAt: entry.time,
    metadata: { header: entry.header, products: entry.products }
  }];
  if (htmlParts.length > 0) {
    messages.push({
      id: `activity-${index + 1}-response`,
      parentId: `activity-${index + 1}-prompt`,
      role: "assistant",
      content: htmlParts
    });
  }
  return {
    sourceConversationId: null,
    title,
    schemaVersion: "google-takeout-my-activity",
    messages,
    adapterWarnings: [
      "Google Takeout My Activity is flat; conversation membership and complete response text were not inferred"
    ]
  };
}

export async function importGeminiExport(input, optionsInput = {}) {
  const options = providerOptions(optionsInput);
  const { rawBytes, decoded } = decodeExport(input, options.maxBytes);
  const structured = !Array.isArray(decoded) && Array.isArray(decoded?.conversations);
  const conversations = structured ? decoded.conversations : decoded;
  if (!Array.isArray(conversations)) {
    throw new Error("Gemini export must contain structured conversations or a My Activity array");
  }
  const envelopes = structured
    ? conversations.map(normalizeGeminiStructuredConversation)
    : conversations.map(normalizeGeminiActivity);
  return importProviderEnvelopes(envelopes, rawBytes, options, {
    provider: "gemini",
    name: GEMINI_EXPORT_PARSER_NAME,
    version: GEMINI_EXPORT_PARSER_VERSION
  });
}

export function detectConversationExportProvider(input) {
  const { decoded } = decodeExport(input, DEFAULT_MAX_IMPORT_BYTES);
  const conversations = Array.isArray(decoded) ? decoded : decoded?.conversations;
  const first = conversations?.[0];
  if (first?.mapping && typeof first.mapping === "object") return "chatgpt";
  if (Array.isArray(first?.chat_messages)) return "claude";
  if (Array.isArray(first?.entries)) return "gemini";
  if (Array.isArray(decoded) && first && (first.safeHtmlItem || first.products || first.header)) return "gemini";
  return null;
}
