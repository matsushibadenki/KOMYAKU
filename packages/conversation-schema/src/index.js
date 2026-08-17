import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

export const CONVERSATION_SCHEMA_VERSION = 1;

const uuidSchema = z.string().uuid();
const optionalTimestampSchema = z.string().datetime({ offset: true }).nullable().optional();
const metadataSchema = z.record(z.string(), z.unknown());

export const importProvenanceSchema = z.object({
  importId: uuidSchema,
  sourceProvider: z.string().min(1).max(100),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  parserName: z.string().min(1).max(100),
  parserVersion: z.string().min(1).max(50)
});

export const contentPartSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }),
  z.object({ type: z.literal("image_reference"), assetId: uuidSchema, alt: z.string().optional() }),
  z.object({ type: z.literal("file_reference"), assetId: uuidSchema, name: z.string().optional() }),
  z.object({ type: z.literal("audio_reference"), assetId: uuidSchema }),
  z.object({ type: z.literal("tool_call"), callId: z.string().min(1), name: z.string().min(1), arguments: z.unknown() }),
  z.object({ type: z.literal("tool_result"), callId: z.string().min(1), result: z.unknown() }),
  z.object({ type: z.literal("citation"), label: z.string(), uri: z.string().optional() }),
  z.object({ type: z.literal("reasoning_placeholder"), available: z.boolean().default(false) }),
  z.object({ type: z.literal("unknown_provider_part"), providerType: z.string().min(1), raw: z.unknown() })
]);

export const conversationMessageSchema = z.object({
  id: uuidSchema,
  conversationId: uuidSchema,
  sourceProvider: z.string().min(1).max(100),
  sourceMessageId: z.string().max(500).nullable().optional(),
  role: z.string().min(1).max(100),
  authorLabel: z.string().max(300).nullable().optional(),
  contentParts: z.array(contentPartSchema),
  createdAtSource: optionalTimestampSchema,
  editedAtSource: optionalTimestampSchema,
  modelMetadata: metadataSchema.default({}),
  toolMetadata: metadataSchema.default({}),
  attachmentIds: z.array(uuidSchema).default([]),
  importProvenance: importProvenanceSchema.nullable().optional()
});

export const conversationEdgeSchema = z.object({
  parentMessageId: uuidSchema,
  childMessageId: uuidSchema,
  kind: z.string().min(1).max(100).default("reply")
}).refine((edge) => edge.parentMessageId !== edge.childMessageId, {
  message: "A conversation message cannot be its own parent"
});

export const canonicalConversationSchema = z.object({
  schemaVersion: z.literal(CONVERSATION_SCHEMA_VERSION),
  id: uuidSchema,
  title: z.string().max(1000),
  defaultLanguage: z.string().min(1).max(100).default("und"),
  messages: z.array(conversationMessageSchema),
  edges: z.array(conversationEdgeSchema),
  providerMetadata: metadataSchema.default({})
}).superRefine((conversation, context) => {
  const messageIds = new Set(conversation.messages.map((message) => message.id));
  const uniqueIds = messageIds.size === conversation.messages.length;
  if (!uniqueIds) {
    context.addIssue({ code: "custom", path: ["messages"], message: "Message IDs must be unique" });
  }

  for (const [index, message] of conversation.messages.entries()) {
    if (message.conversationId !== conversation.id) {
      context.addIssue({ code: "custom", path: ["messages", index, "conversationId"], message: "Message belongs to another conversation" });
    }
  }

  for (const [index, edge] of conversation.edges.entries()) {
    if (!messageIds.has(edge.parentMessageId) || !messageIds.has(edge.childMessageId)) {
      context.addIssue({ code: "custom", path: ["edges", index], message: "Conversation edge references a missing message" });
    }
  }

  const edgeKeys = new Set();
  const children = new Map(conversation.messages.map((message) => [message.id, []]));
  for (const [index, edge] of conversation.edges.entries()) {
    const edgeKey = `${edge.parentMessageId}:${edge.childMessageId}:${edge.kind}`;
    if (edgeKeys.has(edgeKey)) {
      context.addIssue({ code: "custom", path: ["edges", index], message: "Conversation edges must be unique" });
    }
    edgeKeys.add(edgeKey);
    children.get(edge.parentMessageId)?.push(edge.childMessageId);
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(messageId) {
    if (visiting.has(messageId)) return true;
    if (visited.has(messageId)) return false;
    visiting.add(messageId);
    for (const childId of children.get(messageId) ?? []) {
      if (visit(childId)) return true;
    }
    visiting.delete(messageId);
    visited.add(messageId);
    return false;
  }

  for (const messageId of messageIds) {
    if (visit(messageId)) {
      context.addIssue({ code: "custom", path: ["edges"], message: "Conversation graph must not contain cycles" });
      break;
    }
  }
});

export const conversationImportEnvelopeSchema = z.object({
  sourceProvider: z.string().min(1).max(100),
  sourceFormat: z.string().min(1).max(100),
  sourceSchemaVersion: z.string().max(100).nullable().optional(),
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  rawAssetId: uuidSchema,
  parserName: z.string().min(1).max(100),
  parserVersion: z.string().min(1).max(50)
});

export function createConversation({ title = "", defaultLanguage = "und" } = {}) {
  const id = uuidv7();
  return canonicalConversationSchema.parse({
    schemaVersion: CONVERSATION_SCHEMA_VERSION,
    id,
    title,
    defaultLanguage,
    messages: [],
    edges: [],
    providerMetadata: {}
  });
}

export function createMessage(conversationId, {
  sourceProvider,
  role,
  contentParts = [],
  ...metadata
}) {
  return conversationMessageSchema.parse({
    id: uuidv7(),
    conversationId,
    sourceProvider,
    role,
    contentParts,
    ...metadata
  });
}
