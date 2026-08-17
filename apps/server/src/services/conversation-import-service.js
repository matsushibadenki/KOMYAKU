import {
  DEFAULT_MAX_IMPORT_BYTES,
  GENERIC_JSON_PARSER_NAME,
  GENERIC_JSON_PARSER_VERSION,
  importGenericJsonConversation
} from "@komyaku/conversation-importer";
import { buildImportObjectKey, sha256 } from "@komyaku/storage-core";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";

const requestSchema = z.object({
  workspaceId: z.string().uuid(),
  projectId: z.string().uuid().nullable().default(null),
  actorId: z.string().uuid(),
  sourceProvider: z.string().min(1).max(100).default("generic"),
  sourceFormat: z.string().min(1).max(100).default("generic-json"),
  contentType: z.string().min(1).max(255).default("application/json; charset=utf-8"),
  raw: z.union([z.string(), z.instanceof(Uint8Array)]),
  visibility: z.enum(["private", "restricted", "unlisted", "public"]).default("private"),
  aiTrainingPolicy: z.enum(["deny", "allow"]).default("deny")
});

function rawBytes(raw) {
  return typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
}

export class ConversationImportError extends Error {
  constructor(message, { importId, cause }) {
    super(message, { cause });
    this.name = "ConversationImportError";
    this.importId = importId;
  }
}

export function createConversationImportService({
  objectStore,
  repository,
  authorizeImport,
  maxImportBytes = DEFAULT_MAX_IMPORT_BYTES
}) {
  if (!objectStore?.putImmutable) throw new Error("Conversation import object store is required");
  if (!repository?.persistSuccessfulImport || !repository?.persistFailedImport) {
    throw new Error("Conversation import repository is required");
  }
  if (typeof authorizeImport !== "function") {
    throw new Error("Conversation import authorization policy is required");
  }
  if (!Number.isSafeInteger(maxImportBytes) || maxImportBytes <= 0) {
    throw new Error("Conversation import byte limit must be a positive integer");
  }

  return Object.freeze({
    async importGenericJson(requestInput) {
      const request = requestSchema.parse(requestInput);
      const authorized = await authorizeImport({
        workspaceId: request.workspaceId,
        actorId: request.actorId,
        action: "conversation:import"
      });
      if (authorized !== true) throw new Error("Conversation import is not authorized");

      const importId = uuidv7();
      const conversationId = uuidv7();
      const assetId = uuidv7();
      const bytes = rawBytes(request.raw);
      if (bytes.byteLength > maxImportBytes) {
        throw new Error(`Conversation import exceeds the ${maxImportBytes} byte limit`);
      }
      const checksum = await sha256(bytes);
      const storageKey = buildImportObjectKey({ workspaceId: request.workspaceId, importId });
      const archive = {
        id: assetId,
        workspaceId: request.workspaceId,
        mediaType: request.contentType,
        byteSize: bytes.byteLength,
        contentHash: checksum.hex,
        storageKey,
        createdBy: request.actorId
      };

      const stored = await objectStore.putImmutable({
        key: storageKey,
        body: bytes,
        contentType: request.contentType,
        metadata: {
          "import-id": importId,
          "source-provider": request.sourceProvider
        }
      });
      if (stored.contentHash !== checksum.hex) {
        throw new Error("Archived conversation checksum did not match the source payload");
      }

      let parsed;
      try {
        parsed = await importGenericJsonConversation(bytes, {
          importId,
          conversationId,
          sourceProvider: request.sourceProvider,
          maxBytes: maxImportBytes
        });
      } catch (error) {
        await repository.persistFailedImport({
          archive,
          importRecord: {
            id: importId,
            workspaceId: request.workspaceId,
            sourceProvider: request.sourceProvider,
            sourceFormat: request.sourceFormat,
            parserName: GENERIC_JSON_PARSER_NAME,
            parserVersion: GENERIC_JSON_PARSER_VERSION,
            sourceHash: checksum.hex,
            warnings: ["The source was archived, but canonical parsing failed"],
            importedBy: request.actorId
          }
        });
        throw new ConversationImportError("Conversation source was archived but could not be imported", {
          importId,
          cause: error
        });
      }

      await repository.persistSuccessfulImport({
        archive,
        importRecord: {
          id: importId,
          workspaceId: request.workspaceId,
          conversationId,
          sourceProvider: request.sourceProvider,
          sourceFormat: request.sourceFormat,
          sourceSchemaVersion: parsed.sourceSchemaVersion,
          parserName: GENERIC_JSON_PARSER_NAME,
          parserVersion: GENERIC_JSON_PARSER_VERSION,
          sourceHash: parsed.sourceHash,
          status: parsed.status,
          warnings: parsed.warnings,
          importedBy: request.actorId
        },
        conversation: parsed.conversation,
        projectId: request.projectId,
        visibility: request.visibility,
        aiTrainingPolicy: request.aiTrainingPolicy,
        createdBy: request.actorId
      });
      return {
        importId,
        conversationId,
        sourceHash: parsed.sourceHash,
        status: parsed.status,
        warnings: parsed.warnings
      };
    }
  });
}
