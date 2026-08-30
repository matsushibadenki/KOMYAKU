import { v7 as uuidv7 } from "uuid";
import { CloudAiHandoffError } from "../services/cloud-ai-handoff-service.js";

async function contentHash(parts) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function uuidArrayLiteral(values) {
  if (!Array.isArray(values) || values.some((value) => (
    typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ))) {
    throw new CloudAiHandoffError("invalid_cloud_ai_handoff");
  }
  return `{${values.join(",")}}`;
}

export function createCloudAiHandoffRepository(sql) {
  if (!sql?.begin) throw new Error("SQL transaction client is required");

  return Object.freeze({
    async listAvailableProviderConnections({ workspaceId, actorId }) {
      const rows = await sql`
        SELECT apc.id, apc.provider_type, apc.display_name, apc.endpoint_origin,
               CASE WHEN apc.workspace_id IS NOT NULL THEN 'workspace' ELSE 'user' END AS owner_type
        FROM ai_provider_connections apc
        JOIN workspace_members wm ON wm.workspace_id = ${workspaceId} AND wm.user_id = ${actorId}
        JOIN users u ON u.id = wm.user_id
        WHERE wm.revoked_at IS NULL
          AND u.deleted_at IS NULL
          AND u.email_verified_at IS NOT NULL
          AND apc.connection_status = 'active'
          AND apc.revoked_at IS NULL
          AND (apc.workspace_id = ${workspaceId} OR apc.user_id = ${actorId})
        ORDER BY apc.display_name ASC, apc.id ASC
        LIMIT 100
      `;
      return rows.map((row) => ({
        id: row.id,
        providerType: row.provider_type,
        displayName: row.display_name,
        endpointOrigin: row.endpoint_origin,
        ownerType: row.owner_type
      }));
    },
    async findCompletedHandoff({ handoffId, workspaceId, actorId }) {
      const rows = await sql`
        SELECT ah.id, ah.conversation_id, ah.result_root_message_id
        FROM ai_handoffs ah
        JOIN conversations c ON c.id = ah.conversation_id
        JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
        JOIN users u ON u.id = wm.user_id
        WHERE ah.id = ${handoffId}
          AND ah.handoff_status = 'completed'
          AND c.workspace_id = ${workspaceId}
          AND c.deleted_at IS NULL
          AND wm.user_id = ${actorId}
          AND wm.revoked_at IS NULL
          AND u.deleted_at IS NULL
          AND u.email_verified_at IS NOT NULL
        LIMIT 1
      `;
      const row = rows[0];
      return row ? {
        handoffId: row.id,
        conversationId: row.conversation_id,
        resultMessageId: row.result_root_message_id,
        replayed: true
      } : null;
    },
    async persistCompletedHandoff({ workspaceId, actorId, confirmed, responseMessage, providerResponseId, completedAt }) {
      const responseHash = await contentHash(responseMessage.contentParts);
      const selectedMessageIds = uuidArrayLiteral(confirmed.selectedMessageIds);
      const selectedAssetIds = uuidArrayLiteral(confirmed.selectedAssetIds);
      let replayed = false;
      await sql.begin(async (tx) => {
        const access = await tx`
          SELECT c.id
          FROM conversations c
          JOIN workspace_members wm ON wm.workspace_id = c.workspace_id
          JOIN users u ON u.id = wm.user_id
          JOIN ai_provider_connections apc ON apc.id = ${confirmed.providerConnectionId}
          WHERE c.id = ${confirmed.conversationId}
            AND c.workspace_id = ${workspaceId}
            AND c.deleted_at IS NULL
            AND wm.user_id = ${actorId}
            AND wm.revoked_at IS NULL
            AND u.deleted_at IS NULL
            AND u.email_verified_at IS NOT NULL
            AND apc.connection_status = 'active'
            AND apc.revoked_at IS NULL
            AND apc.provider_type = ${confirmed.providerType}
            AND (apc.workspace_id = c.workspace_id OR apc.user_id = ${actorId})
          FOR UPDATE OF c
        `;
        if (!access[0]) throw new CloudAiHandoffError("cloud_ai_handoff_forbidden");

        const existing = await tx`
          SELECT result_root_message_id, payload_hash, outbound_payload_hash, provider_response_id
          FROM ai_handoffs WHERE id = ${confirmed.id} LIMIT 1
        `;
        if (existing[0]) {
          const same = existing[0].result_root_message_id === responseMessage.id
            && existing[0].payload_hash === confirmed.payloadHash
            && existing[0].outbound_payload_hash === confirmed.outboundPayloadHash
            && existing[0].provider_response_id === providerResponseId;
          if (!same) throw new CloudAiHandoffError("cloud_ai_handoff_conflict");
          replayed = true;
          return;
        }

        const branch = await tx`
          WITH selected AS (
            SELECT message_id, ordinal
            FROM unnest(${selectedMessageIds}::uuid[]) WITH ORDINALITY AS item(message_id, ordinal)
          )
          SELECT
            (SELECT COUNT(*)::int FROM selected s
             JOIN conversation_messages m ON m.id = s.message_id
             WHERE m.conversation_id = ${confirmed.conversationId}) AS message_count,
            (SELECT COUNT(*)::int FROM selected child
             JOIN selected parent ON parent.ordinal = child.ordinal - 1
             JOIN conversation_edges e
               ON e.conversation_id = ${confirmed.conversationId}
              AND e.parent_message_id = parent.message_id
              AND e.child_message_id = child.message_id) AS edge_count
        `;
        if (!branch[0]
          || branch[0].message_count !== confirmed.selectedMessageIds.length
          || branch[0].edge_count !== confirmed.selectedMessageIds.length - 1
          || confirmed.selectedMessageIds.at(-1) !== confirmed.sourceMessageId) {
          throw new CloudAiHandoffError("invalid_cloud_ai_handoff");
        }

        const insertedMessage = await tx`
          INSERT INTO conversation_messages
            (id, conversation_id, source_provider, source_message_id, message_role, author_label,
             content_parts, model_metadata, tool_metadata, created_at_source, edited_at_source, content_hash)
          VALUES
            (${responseMessage.id}, ${confirmed.conversationId}, ${responseMessage.sourceProvider},
             ${responseMessage.sourceMessageId ?? null}, ${responseMessage.role}, ${responseMessage.authorLabel ?? null},
             ${JSON.stringify(responseMessage.contentParts)}::text::jsonb,
             ${JSON.stringify(responseMessage.modelMetadata)}::text::jsonb,
             ${JSON.stringify(responseMessage.toolMetadata)}::text::jsonb,
             ${responseMessage.createdAtSource ?? null}, ${responseMessage.editedAtSource ?? null}, ${responseHash})
          ON CONFLICT (id) DO NOTHING
          RETURNING id
        `;
        if (!insertedMessage[0]) throw new CloudAiHandoffError("cloud_ai_handoff_conflict");

        await tx`
          INSERT INTO conversation_edges (conversation_id, parent_message_id, child_message_id, edge_kind)
          VALUES (${confirmed.conversationId}, ${confirmed.sourceMessageId}, ${responseMessage.id}, 'ai_continuation')
        `;
        await tx`
          INSERT INTO ai_handoffs
            (id, conversation_id, source_message_id, provider_connection_id, provider_type, model_id,
             selected_message_ids, selected_asset_ids, conversion_warnings, payload_hash,
             outbound_payload_hash, estimated_input_units, estimated_cost_minor, currency,
             consented_by, consented_at, handoff_status, provider_response_id,
             result_root_message_id, created_at, completed_at)
          VALUES
            (${confirmed.id}, ${confirmed.conversationId}, ${confirmed.sourceMessageId},
             ${confirmed.providerConnectionId}, ${confirmed.providerType}, ${confirmed.modelId},
             ${selectedMessageIds}::uuid[], ${selectedAssetIds}::uuid[],
             ${JSON.stringify(confirmed.conversionWarnings)}::text::jsonb, ${confirmed.payloadHash},
             ${confirmed.outboundPayloadHash}, ${confirmed.estimatedInputUnits},
             ${confirmed.estimatedCostMinor ?? null}, ${confirmed.currency ?? null}, ${actorId},
             ${confirmed.consentedAt}, 'completed', ${providerResponseId}, ${responseMessage.id},
             ${confirmed.createdAt}, ${completedAt})
        `;
        await tx`UPDATE conversations SET updated_at = ${completedAt} WHERE id = ${confirmed.conversationId}`;
        await tx`
          INSERT INTO outbox_events
            (id, aggregate_type, aggregate_id, event_type, schema_version, partition_key, idempotency_key, payload)
          VALUES
            (${uuidv7()}, 'ai_handoff', ${confirmed.id}, 'conversation.ai_handoff_completed', 1,
             ${workspaceId}, ${`ai-handoff:${confirmed.id}`},
             ${JSON.stringify({
               handoffId: confirmed.id,
               conversationId: confirmed.conversationId,
               resultMessageId: responseMessage.id,
               workspaceId
             })}::text::jsonb)
        `;
      });
      return { handoffId: confirmed.id, conversationId: confirmed.conversationId, resultMessageId: responseMessage.id, replayed };
    }
  });
}
