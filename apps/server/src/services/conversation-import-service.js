import {
  CHATGPT_EXPORT_PARSER_NAME, CHATGPT_EXPORT_PARSER_VERSION,
  CLAUDE_EXPORT_PARSER_NAME, CLAUDE_EXPORT_PARSER_VERSION,
  DEFAULT_MAX_IMPORT_BYTES,
  GEMINI_EXPORT_PARSER_NAME, GEMINI_EXPORT_PARSER_VERSION,
  GENERIC_JSON_PARSER_NAME, GENERIC_JSON_PARSER_VERSION,
  detectConversationExportProvider, importChatGptExport, importClaudeExport,
  importGeminiExport, importGenericJsonConversation
} from "@komyaku/conversation-importer";
import { buildImportObjectKey, sha256 } from "@komyaku/storage-core";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

const requestSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().default(null),
  actorId: z.string().uuid(),
  sourceProvider: z.enum(["auto", "generic", "chatgpt", "claude", "gemini"]).default("auto"),
  sourceFormat: z.string().min(1).max(100).optional(),
  contentType: z.string().min(1).max(255).default("application/json; charset=utf-8"),
  raw: z.union([z.string(), z.instanceof(Uint8Array)]),
  visibility: z.enum(["private", "restricted", "unlisted", "public"]).default("private"),
  aiTrainingPolicy: z.enum(["deny", "allow"]).default("deny")
});

const parserByProvider = Object.freeze({
  generic: { name: GENERIC_JSON_PARSER_NAME, version: GENERIC_JSON_PARSER_VERSION },
  chatgpt: { name: CHATGPT_EXPORT_PARSER_NAME, version: CHATGPT_EXPORT_PARSER_VERSION },
  claude: { name: CLAUDE_EXPORT_PARSER_NAME, version: CLAUDE_EXPORT_PARSER_VERSION },
  gemini: { name: GEMINI_EXPORT_PARSER_NAME, version: GEMINI_EXPORT_PARSER_VERSION }
});

function rawBytes(raw) {
  return typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
}

function importerFor(provider) {
  if (provider === "chatgpt") return importChatGptExport;
  if (provider === "claude") return importClaudeExport;
  if (provider === "gemini") return importGeminiExport;
  return null;
}

export class ConversationImportError extends Error {
  constructor(message, { importId, cause }) {
    super(message, { cause });
    this.name = "ConversationImportError";
    this.importId = importId;
  }
}

export function createConversationImportService({
  objectStore, repository, authorizeImport, maxImportBytes = DEFAULT_MAX_IMPORT_BYTES
}) {
  if (!objectStore?.putImmutable) throw new Error("Conversation import object store is required");
  if (!repository?.persistSuccessfulBundleImport || !repository?.persistFailedImport) {
    throw new Error("Conversation import repository is required");
  }
  if (typeof authorizeImport !== "function") throw new Error("Conversation import authorization policy is required");
  if (!Number.isSafeInteger(maxImportBytes) || maxImportBytes <= 0) {
    throw new Error("Conversation import byte limit must be a positive integer");
  }

  async function importJson(requestInput) {
    const request = requestSchema.parse(requestInput);
    const authorized = await authorizeImport({
      workspaceId: request.workspaceId, actorId: request.actorId, action: "conversation:import"
    });
    if (authorized !== true) throw new Error("Conversation import is not authorized");

    const importId = uuidv7();
    const bytes = rawBytes(request.raw);
    if (bytes.byteLength > maxImportBytes) {
      throw new Error(`Conversation import exceeds the ${maxImportBytes} byte limit`);
    }
    let detectedProvider = request.sourceProvider;
    if (request.sourceProvider === "auto") {
      try {
        detectedProvider = detectConversationExportProvider(bytes);
      } catch {
        detectedProvider = null;
      }
    }
    const sourceProvider = detectedProvider ?? "generic";
    const parser = parserByProvider[sourceProvider];
    const sourceFormat = request.sourceFormat ?? `${sourceProvider}-json`;
    const checksum = await sha256(bytes);
    const storageKey = buildImportObjectKey({ workspaceId: request.workspaceId, importId });
    const archive = {
      id: uuidv7(), workspaceId: request.workspaceId, mediaType: request.contentType,
      byteSize: bytes.byteLength, contentHash: checksum.hex, storageKey, createdBy: request.actorId
    };

    const stored = await objectStore.putImmutable({
      key: storageKey, body: bytes, contentType: request.contentType,
      metadata: { "import-id": importId, "source-provider": sourceProvider }
    });
    if (stored.contentHash !== checksum.hex) {
      throw new Error("Archived conversation checksum did not match the source payload");
    }

    let parsed;
    try {
      const providerImporter = importerFor(sourceProvider);
      if (providerImporter) {
        parsed = await providerImporter(bytes, {
          importId, identityScope: request.workspaceId, maxBytes: maxImportBytes
        });
      } else {
        const single = await importGenericJsonConversation(bytes, {
          importId, identityScope: request.workspaceId, sourceProvider, maxBytes: maxImportBytes
        });
        parsed = { ...single, provider: sourceProvider, conversations: [single.conversation] };
      }
    } catch (error) {
      await repository.persistFailedImport({
        archive,
        importRecord: {
          id: importId, workspaceId: request.workspaceId, sourceProvider, sourceFormat,
          parserName: parser.name, parserVersion: parser.version, sourceHash: checksum.hex,
          warnings: ["The source was archived, but canonical parsing failed"], importedBy: request.actorId
        }
      });
      throw new ConversationImportError("Conversation source was archived but could not be imported", {
        importId, cause: error
      });
    }

    await repository.persistSuccessfulBundleImport({
      archive,
      importRecord: {
        id: importId, workspaceId: request.workspaceId, sourceProvider, sourceFormat,
        sourceSchemaVersion: null, parserName: parser.name, parserVersion: parser.version,
        sourceHash: parsed.sourceHash, status: parsed.status, warnings: parsed.warnings,
        importedBy: request.actorId
      },
      conversations: parsed.conversations,
      projectId: request.projectId,
      visibility: request.visibility,
      aiTrainingPolicy: request.aiTrainingPolicy,
      createdBy: request.actorId
    });
    const conversationIds = parsed.conversations.map(({ id }) => id);
    return {
      importId, conversationId: conversationIds[0], conversationIds, sourceProvider,
      sourceHash: parsed.sourceHash, status: parsed.status, warnings: parsed.warnings
    };
  }

  return Object.freeze({
    importProviderJson: importJson,
    importGenericJson(requestInput) {
      return importJson({ ...requestInput, sourceProvider: "generic" });
    }
  });
}
