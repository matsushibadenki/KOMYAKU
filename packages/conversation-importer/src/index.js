import { canonicalConversationSchema } from "@komyaku/conversation-schema";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

export const GENERIC_JSON_PARSER_NAME = "komyaku-generic-json";
export const GENERIC_JSON_PARSER_VERSION = "1.0.0";
export const DEFAULT_MAX_IMPORT_BYTES = 10 * 1024 * 1024;
export const DEFAULT_MAX_IMPORT_MESSAGES = 10_000;

const optionsSchema = z.object({
  sourceProvider: z.string().min(1).max(100).default("generic"),
  importId: z.string().uuid().optional(),
  conversationId: z.string().uuid().optional(),
  maxBytes: z.number().int().positive().default(DEFAULT_MAX_IMPORT_BYTES),
  maxMessages: z.number().int().positive().default(DEFAULT_MAX_IMPORT_MESSAGES)
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
  if (rawBytes.byteLength > options.maxBytes) {
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

  const importId = options.importId ?? uuidv7();
  const conversationId = options.conversationId ?? uuidv7();
  const sourceHash = await sha256Hex(rawBytes);
  const warnings = [];
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

    const internalId = uuidv7();
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
          parserName: GENERIC_JSON_PARSER_NAME,
          parserVersion: GENERIC_JSON_PARSER_VERSION
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
      importedBy: GENERIC_JSON_PARSER_NAME,
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
    rawBytes
  });
}
