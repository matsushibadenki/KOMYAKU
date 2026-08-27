import {
  DEFAULT_MAX_IMPORT_BYTES,
  detectConversationExportProvider,
  importChatGptExport,
  importClaudeExport,
  importGeminiExport,
  importGenericJsonConversation
} from "@komyaku/conversation-importer";

export const CONVERSATION_PROVIDER_OPTIONS = Object.freeze([
  "auto", "generic", "chatgpt", "claude", "gemini"
]);

function importerFor(provider) {
  if (provider === "chatgpt") return importChatGptExport;
  if (provider === "claude") return importClaudeExport;
  if (provider === "gemini") return importGeminiExport;
  return null;
}

export async function previewConversationExport(input, providerOption = "auto") {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!CONVERSATION_PROVIDER_OPTIONS.includes(providerOption)) {
    throw new Error("unsupported_provider");
  }
  if (bytes.byteLength === 0) throw new Error("empty_file");
  if (bytes.byteLength > DEFAULT_MAX_IMPORT_BYTES) throw new Error("file_too_large");

  let provider = providerOption;
  if (provider === "auto") provider = detectConversationExportProvider(bytes) ?? "generic";
  const importer = importerFor(provider);
  const parsed = importer
    ? await importer(bytes, { maxBytes: DEFAULT_MAX_IMPORT_BYTES })
    : await importGenericJsonConversation(bytes, {
      sourceProvider: "generic", maxBytes: DEFAULT_MAX_IMPORT_BYTES
    });
  const conversations = parsed.conversations ?? [parsed.conversation];

  return Object.freeze({
    provider,
    sourceHash: parsed.sourceHash,
    status: parsed.status,
    warnings: Object.freeze([...parsed.warnings]),
    byteLength: bytes.byteLength,
    conversationCount: conversations.length,
    messageCount: conversations.reduce((sum, conversation) => sum + conversation.messages.length, 0),
    conversations: Object.freeze(conversations.map((conversation) => Object.freeze({
      id: conversation.id,
      title: conversation.title,
      messageCount: conversation.messages.length,
      branchCount: [...conversation.edges.reduce((counts, edge) => {
        counts.set(edge.parentMessageId, (counts.get(edge.parentMessageId) ?? 0) + 1);
        return counts;
      }, new Map()).values()].filter((count) => count > 1).length
    })))
  });
}
