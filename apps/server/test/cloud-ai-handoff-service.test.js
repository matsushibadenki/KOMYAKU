import { describe, expect, test } from "bun:test";
import { confirmHandoff, createHandoffPreview } from "@komyaku/ai-gateway";
import { createConversation, createMessage } from "@komyaku/conversation-schema";
import { CloudAiHandoffError, createCloudAiHandoffService } from "../src/services/cloud-ai-handoff-service.js";

async function fixture() {
  const workspaceId = crypto.randomUUID();
  const actorId = crypto.randomUUID();
  const conversation = createConversation({ title: "Cloud continuation" });
  const source = createMessage(conversation.id, {
    sourceProvider: "generic", role: "user", contentParts: [{ type: "text", text: "Continue" }]
  });
  const preview = await createHandoffPreview({ ...conversation, messages: [source] }, {
    providerConnectionId: crypto.randomUUID(), providerType: "openai-compatible", modelId: "writer",
    sourceMessageId: source.id, selectedMessageIds: [source.id], selectedAssetIds: [],
    conversionWarnings: [], estimatedInputUnits: 2
  });
  const confirmed = confirmHandoff({ ...preview, outboundPayloadHash: "b".repeat(64) }, {
    expectedPayloadHash: preview.payloadHash, consentedBy: actorId
  });
  const responseMessage = createMessage(conversation.id, {
    sourceProvider: "openai-compatible", role: "assistant",
    contentParts: [{ type: "text", text: "Cloud response" }], modelMetadata: { modelId: "writer" }
  });
  return { workspaceId, actorId, confirmed, responseMessage, providerResponseId: "response-1", completedAt: "2026-08-30T12:00:00.000Z" };
}

describe("Cloud AI handoff service", () => {
  test("validates actor, response identity, and delegates one completed handoff", async () => {
    const calls = [];
    const service = createCloudAiHandoffService({ repository: {
      async persistCompletedHandoff(input) { calls.push(input); return { handoffId: input.confirmed.id }; }
    } });
    const input = await fixture();
    expect(await service.persistCompleted(input)).toEqual({ handoffId: input.confirmed.id });
    expect(calls).toHaveLength(1);
  });

  test("rejects a consent actor mismatch before storage", async () => {
    const input = await fixture();
    const service = createCloudAiHandoffService({ repository: {
      async persistCompletedHandoff() { throw new Error("must not run"); }
    } });
    await expect(service.persistCompleted({ ...input, actorId: crypto.randomUUID() }))
      .rejects.toMatchObject({ code: "invalid_cloud_ai_handoff" });
  });

  test("maps unexpected repository errors without exposing database details", async () => {
    const service = createCloudAiHandoffService({ repository: {
      async persistCompletedHandoff() { throw new Error("secret database detail"); }
    } });
    await expect(service.persistCompleted(await fixture()))
      .rejects.toEqual(expect.objectContaining({ code: "cloud_ai_handoff_storage_failure" }));
  });

  test("preserves stable repository authorization and conflict errors", async () => {
    const service = createCloudAiHandoffService({ repository: {
      async persistCompletedHandoff() { throw new CloudAiHandoffError("cloud_ai_handoff_forbidden"); }
    } });
    await expect(service.persistCompleted(await fixture()))
      .rejects.toMatchObject({ code: "cloud_ai_handoff_forbidden" });
  });
});
