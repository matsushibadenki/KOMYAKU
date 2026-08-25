import { v7 as uuidv7 } from "uuid";

async function contentHash(parts) {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function insertArchive(tx, archive) {
  await tx`
    INSERT INTO assets (id, workspace_id, media_type, byte_size, content_hash, storage_key, created_by)
    VALUES (${archive.id}, ${archive.workspaceId}, ${archive.mediaType}, ${archive.byteSize},
            ${archive.contentHash}, ${archive.storageKey}, ${archive.createdBy})
  `;
}

async function insertConversation(tx, { conversation, importRecord, projectId, visibility, aiTrainingPolicy, createdBy, messageHashes }) {
  await tx`
    INSERT INTO conversations
      (id, workspace_id, project_id, title, default_language, visibility, ai_training_policy, created_by)
    VALUES
      (${conversation.id}, ${importRecord.workspaceId}, ${projectId}, ${conversation.title},
       ${conversation.defaultLanguage}, ${visibility}, ${aiTrainingPolicy}, ${createdBy})
  `;

  for (const [index, message] of conversation.messages.entries()) {
    await tx`
      INSERT INTO conversation_messages
        (id, conversation_id, source_provider, source_message_id, message_role, author_label,
         content_parts, model_metadata, tool_metadata, created_at_source, edited_at_source, content_hash)
      VALUES
        (${message.id}, ${conversation.id}, ${message.sourceProvider}, ${message.sourceMessageId ?? null},
         ${message.role}, ${message.authorLabel ?? null}, ${JSON.stringify(message.contentParts)}::text::jsonb,
         ${JSON.stringify(message.modelMetadata)}::text::jsonb, ${JSON.stringify(message.toolMetadata)}::text::jsonb,
         ${message.createdAtSource ?? null}, ${message.editedAtSource ?? null}, ${messageHashes[index]})
    `;
  }

  for (const edge of conversation.edges) {
    await tx`
      INSERT INTO conversation_edges (conversation_id, parent_message_id, child_message_id, edge_kind)
      VALUES (${conversation.id}, ${edge.parentMessageId}, ${edge.childMessageId}, ${edge.kind})
    `;
  }
}

export function createConversationImportRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  async function persistSuccessfulBundleImport({
    archive,
    importRecord,
    conversations,
    projectId,
    visibility,
    aiTrainingPolicy,
    createdBy
  }) {
    if (!Array.isArray(conversations) || conversations.length === 0) {
      throw new Error("A successful conversation import must contain at least one conversation");
    }
    const hashes = await Promise.all(conversations.map((conversation) =>
      Promise.all(conversation.messages.map((message) => contentHash(message.contentParts)))
    ));

    await sql.begin(async (tx) => {
      await insertArchive(tx, archive);
      for (const [index, conversation] of conversations.entries()) {
        await insertConversation(tx, {
          conversation, importRecord, projectId, visibility, aiTrainingPolicy, createdBy,
          messageHashes: hashes[index]
        });
      }

      await tx`
        INSERT INTO conversation_imports
          (id, conversation_id, workspace_id, source_provider, source_format, source_schema_version,
           parser_name, parser_version, raw_asset_id, source_hash, import_status, warnings, imported_by, imported_at)
        VALUES
          (${importRecord.id}, ${conversations[0].id}, ${importRecord.workspaceId}, ${importRecord.sourceProvider},
           ${importRecord.sourceFormat}, ${importRecord.sourceSchemaVersion}, ${importRecord.parserName},
           ${importRecord.parserVersion}, ${archive.id}, ${importRecord.sourceHash}, ${importRecord.status},
           ${JSON.stringify(importRecord.warnings)}::text::jsonb, ${importRecord.importedBy}, now())
      `;

      for (const [ordinal, conversation] of conversations.entries()) {
        await tx`
          INSERT INTO conversation_import_items (import_id, conversation_id, source_conversation_id, ordinal)
          VALUES (${importRecord.id}, ${conversation.id},
                  ${conversation.providerMetadata?.sourceConversationId ?? null}, ${ordinal})
        `;
      }

      const conversationIds = conversations.map(({ id }) => id);
      await tx`
        INSERT INTO outbox_events
          (id, aggregate_type, aggregate_id, event_type, schema_version, partition_key, idempotency_key, payload)
        VALUES
          (${uuidv7()}, 'conversation_import', ${importRecord.id}, 'conversation.imported', 1,
           ${importRecord.workspaceId}, ${`conversation-import:${importRecord.id}`},
           ${JSON.stringify({
             importId: importRecord.id,
             conversationId: conversationIds[0],
             conversationIds,
             workspaceId: importRecord.workspaceId,
             status: importRecord.status
           })}::text::jsonb)
      `;
    });
  }

  return Object.freeze({
    async findImportResult({ importId, workspaceId, userId }) {
      const rows = await sql`
        SELECT ci.id, ci.conversation_id, ci.source_hash, ci.import_status, ci.warnings
        FROM conversation_imports ci
        JOIN workspace_members wm ON wm.workspace_id = ci.workspace_id
        JOIN users u ON u.id = wm.user_id
        WHERE ci.id = ${importId}
          AND ci.workspace_id = ${workspaceId}
          AND wm.user_id = ${userId}
          AND wm.revoked_at IS NULL
          AND u.email_verified_at IS NOT NULL
          AND u.deleted_at IS NULL
        LIMIT 1
      `;
      const row = rows[0];
      if (!row) return null;
      const items = await sql`
        SELECT conversation_id
        FROM conversation_import_items
        WHERE import_id = ${importId}
        ORDER BY ordinal
      `;
      const conversationIds = items.length > 0
        ? items.map((item) => item.conversation_id)
        : row.conversation_id ? [row.conversation_id] : [];
      return {
        importId: row.id,
        conversationId: row.conversation_id,
        conversationIds,
        sourceHash: row.source_hash,
        status: row.import_status,
        warnings: row.warnings
      };
    },
    persistSuccessfulBundleImport,
    async persistSuccessfulImport({ conversation, ...input }) {
      return persistSuccessfulBundleImport({ ...input, conversations: [conversation] });
    },

    async persistFailedImport({ archive, importRecord }) {
      await sql.begin(async (tx) => {
        await insertArchive(tx, archive);
        await tx`
          INSERT INTO conversation_imports
            (id, conversation_id, workspace_id, source_provider, source_format, parser_name, parser_version,
             raw_asset_id, source_hash, import_status, warnings, imported_by, imported_at)
          VALUES
            (${importRecord.id}, NULL, ${importRecord.workspaceId}, ${importRecord.sourceProvider},
             ${importRecord.sourceFormat}, ${importRecord.parserName}, ${importRecord.parserVersion},
             ${archive.id}, ${importRecord.sourceHash}, 'failed',
             ${JSON.stringify(importRecord.warnings)}::text::jsonb, ${importRecord.importedBy}, now())
        `;
      });
    }
  });
}
