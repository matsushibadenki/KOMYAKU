import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { canonicalConversationSchema } from "@komyaku/conversation-schema";

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

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

  const payloadHash = await sha256Hex({
    conversationId: conversation.id,
    providerConnectionId: selection.providerConnectionId,
    providerType: selection.providerType,
    modelId: selection.modelId,
    selectedMessages,
    selectedAssetIds: selection.selectedAssetIds,
    conversionWarnings: selection.conversionWarnings
  });

  return handoffPreviewSchema.parse({
    ...selection,
    id: uuidv7(),
    conversationId: conversation.id,
    payloadHash,
    createdAt: new Date().toISOString()
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

