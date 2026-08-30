import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { confirmHandoff, createHandoffPreview } from "@komyaku/ai-gateway";
import { createConversation, createMessage } from "@komyaku/conversation-schema";
import { createCloudAiHandoffRepository } from "../../src/repositories/cloud-ai-handoff-repository.js";
import { createCloudAiHandoffService } from "../../src/services/cloud-ai-handoff-service.js";

const integration = Bun.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

async function hashParts(parts) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(parts)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

integration("Cloud AI handoff PostgreSQL repository", () => {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const providerConnectionId = crypto.randomUUID();
  const conversation = createConversation({ title: "Cloud handoff integration" });
  const source = createMessage(conversation.id, {
    sourceProvider: "generic", role: "user", contentParts: [{ type: "text", text: "原文" }]
  });
  const sql = new SQL(Bun.env.DATABASE_URL ?? "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku");
  let confirmed;

  beforeAll(async () => {
    await sql`INSERT INTO users (id, email, display_name, email_verified_at) VALUES (${userId}, ${`handoff-${userId}@example.invalid`}, 'Handoff', now())`;
    await sql`INSERT INTO workspaces (id, name, created_by) VALUES (${workspaceId}, 'Handoff integration', ${userId})`;
    await sql`INSERT INTO workspace_members (workspace_id, user_id, member_role) VALUES (${workspaceId}, ${userId}, 'owner')`;
    await sql`
      INSERT INTO conversations (id, workspace_id, title, created_by)
      VALUES (${conversation.id}, ${workspaceId}, ${conversation.title}, ${userId})
    `;
    await sql`
      INSERT INTO conversation_messages
        (id, conversation_id, source_provider, message_role, content_parts, content_hash)
      VALUES (${source.id}, ${conversation.id}, ${source.sourceProvider}, ${source.role},
              ${JSON.stringify(source.contentParts)}::text::jsonb, ${await hashParts(source.contentParts)})
    `;
    await sql`
      INSERT INTO ai_provider_connections
        (id, user_id, provider_type, display_name, secret_reference, endpoint_origin)
      VALUES (${providerConnectionId}, ${userId}, 'openai-compatible', 'Integration provider',
              'integration-secret-reference', 'https://provider.example.invalid')
    `;
    const preview = await createHandoffPreview({ ...conversation, messages: [source] }, {
      providerConnectionId, providerType: "openai-compatible", modelId: "writer",
      sourceMessageId: source.id, selectedMessageIds: [source.id], selectedAssetIds: [],
      conversionWarnings: [], estimatedInputUnits: 2
    });
    confirmed = confirmHandoff({ ...preview, outboundPayloadHash: "b".repeat(64) }, {
      expectedPayloadHash: preview.payloadHash, consentedBy: userId
    });
  });

  afterAll(async () => {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM outbox_events WHERE partition_key = ${workspaceId}`;
      await tx`DELETE FROM ai_handoffs WHERE conversation_id = ${conversation.id}`;
      await tx`DELETE FROM conversation_edges WHERE conversation_id = ${conversation.id}`;
      await tx`DELETE FROM conversation_messages WHERE conversation_id = ${conversation.id}`;
      await tx`DELETE FROM conversations WHERE id = ${conversation.id}`;
      await tx`DELETE FROM ai_provider_connections WHERE id = ${providerConnectionId}`;
      await tx`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId}`;
      await tx`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await tx`DELETE FROM users WHERE id = ${userId}`;
    });
    await sql.close();
  });

  test("atomically commits and idempotently replays a completed continuation", async () => {
    const responseMessage = createMessage(conversation.id, {
      sourceProvider: "openai-compatible", role: "assistant",
      contentParts: [{ type: "text", text: "続き" }], modelMetadata: { modelId: "writer" }
    });
    const input = {
      workspaceId, actorId: userId, confirmed, responseMessage,
      providerResponseId: "provider-response-1", completedAt: "2026-08-30T12:00:00.000Z"
    };
    const repository = createCloudAiHandoffRepository(sql);
    const service = createCloudAiHandoffService({ repository });
    expect(await repository.listAvailableProviderConnections({ workspaceId, actorId: userId }))
      .toEqual([{
        id: providerConnectionId,
        providerType: "openai-compatible",
        displayName: "Integration provider",
        endpointOrigin: "https://provider.example.invalid",
        ownerType: "user"
      }]);
    expect(await service.persistCompleted(input)).toMatchObject({ replayed: false, resultMessageId: responseMessage.id });
    expect(await service.persistCompleted(input)).toMatchObject({ replayed: true, resultMessageId: responseMessage.id });

    const rows = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM ai_handoffs WHERE conversation_id = ${conversation.id}) AS handoffs,
        (SELECT COUNT(*)::int FROM conversation_messages WHERE conversation_id = ${conversation.id}) AS messages,
        (SELECT COUNT(*)::int FROM conversation_edges WHERE conversation_id = ${conversation.id}) AS edges,
        (SELECT COUNT(*)::int FROM outbox_events WHERE aggregate_id = ${confirmed.id}) AS events
    `;
    expect(rows[0]).toEqual({ handoffs: 1, messages: 2, edges: 1, events: 1 });
    const event = await sql`SELECT payload FROM outbox_events WHERE aggregate_id = ${confirmed.id}`;
    expect(JSON.stringify(event[0].payload)).not.toContain("続き");
  });
});
