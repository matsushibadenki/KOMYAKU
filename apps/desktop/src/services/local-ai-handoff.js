import { invoke } from "@tauri-apps/api/core";
import { canonicalConversationSchema } from "@komyaku/conversation-schema";
import { confirmedHandoffSchema } from "@komyaku/ai-gateway";

const MAX_LOCAL_CONVERSATION_BYTES = 12 * 1024 * 1024;
const MAX_LOCAL_CONVERSATION_LIST_ITEMS = 100;

export class LocalAiHandoffPersistenceError extends Error {
  constructor(code, options) {
    super(code, options);
    this.name = "LocalAiHandoffPersistenceError";
    this.code = code;
  }
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function stableCode(error, fallback) {
  return typeof error === "string" && /^[a-z0-9_]+$/.test(error) ? error : fallback;
}

function parseSummary(value) {
  if (!value || typeof value !== "object"
    || typeof value.id !== "string"
    || typeof value.title !== "string"
    || !Number.isSafeInteger(value.messageCount) || value.messageCount < 0
    || typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new LocalAiHandoffPersistenceError("invalid_local_conversation");
  }
  canonicalConversationSchema.shape.id.parse(value.id);
  return Object.freeze({
    id: value.id,
    title: value.title,
    messageCount: value.messageCount,
    updatedAt: value.updatedAt
  });
}

export function createLocalAiHandoffStore({ invokeImpl = invoke, native = isTauriRuntime() } = {}) {
  return Object.freeze({
    isAvailable() {
      return native;
    },
    async list() {
      if (!native) return [];
      try {
        const values = await invokeImpl("list_local_conversations");
        if (!Array.isArray(values) || values.length > MAX_LOCAL_CONVERSATION_LIST_ITEMS) {
          throw new LocalAiHandoffPersistenceError("invalid_local_conversation");
        }
        return values.map(parseSummary);
      } catch (error) {
        if (error instanceof LocalAiHandoffPersistenceError) throw error;
        throw new LocalAiHandoffPersistenceError(stableCode(error, "local_ai_handoff_storage_failure"), { cause: error });
      }
    },
    async load(conversationId) {
      if (!native) return null;
      try {
        const stored = await invokeImpl("load_local_conversation", { conversationId });
        if (stored === null) return null;
        if (typeof stored !== "string" || new TextEncoder().encode(stored).byteLength > MAX_LOCAL_CONVERSATION_BYTES) {
          throw new LocalAiHandoffPersistenceError("invalid_local_conversation");
        }
        return canonicalConversationSchema.parse(JSON.parse(stored));
      } catch (error) {
        if (error instanceof LocalAiHandoffPersistenceError) throw error;
        throw new LocalAiHandoffPersistenceError(stableCode(error, "local_ai_handoff_storage_failure"), { cause: error });
      }
    },
    async save({ conversation, confirmed, response, completedAt = new Date().toISOString() }) {
      if (!native) throw new LocalAiHandoffPersistenceError("tauri_database_unavailable");
      const canonical = canonicalConversationSchema.parse(conversation);
      const handoff = confirmedHandoffSchema.parse(confirmed);
      const resultMessage = canonical.messages.at(-1);
      if (!resultMessage || !canonical.edges.some((edge) => (
        edge.parentMessageId === handoff.sourceMessageId
        && edge.childMessageId === resultMessage.id
        && edge.kind === "ai_continuation"
      ))) {
        throw new LocalAiHandoffPersistenceError("invalid_local_ai_handoff");
      }
      try {
        await invokeImpl("save_local_ai_handoff_atomic", {
          input: {
            conversationJson: JSON.stringify(canonical),
            handoffJson: JSON.stringify(handoff),
            resultMessageId: resultMessage.id,
            providerResponseId: response.providerResponseId ?? null,
            completedAt
          }
        });
      } catch (error) {
        throw new LocalAiHandoffPersistenceError(stableCode(error, "local_ai_handoff_storage_failure"), { cause: error });
      }
      return canonical;
    }
  });
}

export const localAiHandoffStore = createLocalAiHandoffStore();
