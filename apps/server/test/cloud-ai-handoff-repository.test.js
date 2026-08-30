import { describe, expect, test } from "bun:test";
import { createCloudAiHandoffRepository } from "../src/repositories/cloud-ai-handoff-repository.js";

function sqlHarness({ authorized = true, existing = null } = {}) {
  const queries = [];
  const tx = async (strings, ...values) => {
    const statement = strings.join("?").replace(/\s+/g, " ").trim();
    queries.push({ statement, values });
    if (statement.startsWith("SELECT c.id")) return authorized ? [{ id: values[0] }] : [];
    if (statement.startsWith("SELECT result_root_message_id")) return existing ? [existing] : [];
    if (statement.startsWith("WITH selected AS")) {
      const selected = values[0] === "{}" ? [] : values[0].slice(1, -1).split(",");
      return [{ message_count: selected.length, edge_count: selected.length - 1 }];
    }
    if (statement.includes("INSERT INTO conversation_messages")) return [{ id: values[0] }];
    return [];
  };
  const sql = { async begin(operation) { return operation(tx); } };
  return { sql, queries };
}

function input() {
  const conversationId = crypto.randomUUID();
  const sourceMessageId = crypto.randomUUID();
  const resultMessageId = crypto.randomUUID();
  const handoffId = crypto.randomUUID();
  return {
    workspaceId: crypto.randomUUID(), actorId: crypto.randomUUID(), providerResponseId: "response-1",
    completedAt: "2026-08-30T12:00:00.000Z",
    confirmed: {
      id: handoffId, conversationId, sourceMessageId, providerConnectionId: crypto.randomUUID(),
      providerType: "openai-compatible", modelId: "writer", selectedMessageIds: [sourceMessageId],
      selectedAssetIds: [], conversionWarnings: [], payloadHash: "a".repeat(64),
      outboundPayloadHash: "b".repeat(64), estimatedInputUnits: 2,
      consentedBy: crypto.randomUUID(), consentedAt: "2026-08-30T11:59:59.000Z",
      createdAt: "2026-08-30T11:59:58.000Z"
    },
    responseMessage: {
      id: resultMessageId, conversationId, sourceProvider: "openai-compatible", role: "assistant",
      contentParts: [{ type: "text", text: "Sensitive response body" }], modelMetadata: {}, toolMetadata: {}
    }
  };
}

describe("Cloud AI handoff repository", () => {
  test("writes Message, Edge, Handoff, Conversation update, and Outbox in one transaction", async () => {
    const harness = sqlHarness();
    const repository = createCloudAiHandoffRepository(harness.sql);
    const value = input();
    value.confirmed.consentedBy = value.actorId;
    const result = await repository.persistCompletedHandoff(value);
    expect(result).toMatchObject({ handoffId: value.confirmed.id, resultMessageId: value.responseMessage.id, replayed: false });
    expect(harness.queries.map(({ statement }) => statement)).toEqual(expect.arrayContaining([
      expect.stringContaining("INSERT INTO conversation_messages"),
      expect.stringContaining("INSERT INTO conversation_edges"),
      expect.stringContaining("INSERT INTO ai_handoffs"),
      expect.stringContaining("UPDATE conversations"),
      expect.stringContaining("INSERT INTO outbox_events")
    ]));
    const outbox = harness.queries.find(({ statement }) => statement.includes("INSERT INTO outbox_events"));
    expect(JSON.stringify(outbox)).not.toContain("Sensitive response body");
  });

  test("fails before mutation when transactional authorization is absent", async () => {
    const harness = sqlHarness({ authorized: false });
    const repository = createCloudAiHandoffRepository(harness.sql);
    await expect(repository.persistCompletedHandoff(input())).rejects.toMatchObject({ code: "cloud_ai_handoff_forbidden" });
    expect(harness.queries).toHaveLength(1);
  });

  test("replays an identical completed handoff without another mutation", async () => {
    const value = input();
    const harness = sqlHarness({ existing: {
      result_root_message_id: value.responseMessage.id,
      payload_hash: value.confirmed.payloadHash,
      outbound_payload_hash: value.confirmed.outboundPayloadHash,
      provider_response_id: value.providerResponseId
    } });
    const result = await createCloudAiHandoffRepository(harness.sql).persistCompletedHandoff(value);
    expect(result.replayed).toBe(true);
    expect(harness.queries).toHaveLength(2);
  });
});
