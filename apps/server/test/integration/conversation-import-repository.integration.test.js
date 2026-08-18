import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { createConversationImportRepository } from "../../src/repositories/conversation-import-repository.js";
import { createConversationImportService } from "../../src/services/conversation-import-service.js";

const integration = Bun.env.RUN_DB_INTEGRATION === "1" ? describe : describe.skip;

integration("conversation import PostgreSQL repository", () => {
  const userId = crypto.randomUUID();
  const workspaceId = crypto.randomUUID();
  const sql = new SQL(Bun.env.DATABASE_URL ?? "postgres://komyaku:komyaku@127.0.0.1:5432/komyaku");

  beforeAll(async () => {
    await sql`
      INSERT INTO users (id, email, display_name, email_verified_at)
      VALUES (${userId}, ${`integration-${userId}@example.invalid`}, 'Importer', now())
    `;
    await sql`INSERT INTO workspaces (id, name, created_by) VALUES (${workspaceId}, 'Import integration', ${userId})`;
    await sql`
      INSERT INTO workspace_members (workspace_id, user_id, member_role)
      VALUES (${workspaceId}, ${userId}, 'owner')
    `;
  });

  afterAll(async () => {
    await sql.begin(async (tx) => {
      await tx`DELETE FROM outbox_events WHERE partition_key = ${workspaceId}`;
      await tx`DELETE FROM conversation_imports WHERE workspace_id = ${workspaceId}`;
      await tx`DELETE FROM conversation_edges WHERE conversation_id IN (SELECT id FROM conversations WHERE workspace_id = ${workspaceId})`;
      await tx`DELETE FROM conversation_messages WHERE conversation_id IN (SELECT id FROM conversations WHERE workspace_id = ${workspaceId})`;
      await tx`DELETE FROM conversations WHERE workspace_id = ${workspaceId}`;
      await tx`DELETE FROM assets WHERE workspace_id = ${workspaceId}`;
      await tx`DELETE FROM workspace_members WHERE workspace_id = ${workspaceId}`;
      await tx`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await tx`DELETE FROM users WHERE id = ${userId}`;
    });
    await sql.close();
  });

  test("commits archive metadata, graph, import record, and outbox event atomically", async () => {
    const repository = createConversationImportRepository(sql);
    const service = createConversationImportService({
      repository,
      authorizeImport: async () => true,
      objectStore: {
        async putImmutable({ key, body }) {
          const digest = await crypto.subtle.digest("SHA-256", body);
          return {
            key,
            contentHash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
          };
        }
      }
    });

    const result = await service.importGenericJson({
      workspaceId,
      actorId: userId,
      raw: JSON.stringify([
        { id: "root", parentId: null, role: "user", content: "原文" },
        { id: "reply", parentId: "root", role: "assistant", content: "response" }
      ])
    });

    const imports = await sql`
      SELECT import_status, conversation_id FROM conversation_imports WHERE id = ${result.importId}
    `;
    const messages = await sql`
      SELECT count(*)::int AS count FROM conversation_messages WHERE conversation_id = ${result.conversationId}
    `;
    const edges = await sql`
      SELECT count(*)::int AS count FROM conversation_edges WHERE conversation_id = ${result.conversationId}
    `;
    const events = await sql`
      SELECT count(*)::int AS count FROM outbox_events WHERE aggregate_id = ${result.importId}
    `;

    expect(imports[0]).toMatchObject({ import_status: "complete", conversation_id: result.conversationId });
    expect(messages[0].count).toBe(2);
    expect(edges[0].count).toBe(1);
    expect(events[0].count).toBe(1);
    expect(await repository.findImportResult({
      importId: result.importId, workspaceId, userId
    })).toMatchObject({
      importId: result.importId,
      conversationId: result.conversationId,
      status: "complete"
    });
  });
});
