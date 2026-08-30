import { describe, expect, test } from "bun:test";
import { appendContinuationBranch, confirmHandoff, createHandoffPreview } from "@komyaku/ai-gateway";
import { createConversation, createMessage } from "@komyaku/conversation-schema";
import { createLocalAiHandoffStore } from "../src/services/local-ai-handoff.js";

async function fixture() {
  const base = createConversation({ title: "Persist" });
  const source = createMessage(base.id, {
    sourceProvider: "generic", role: "user",
    contentParts: [{ type: "text", text: "Question" }]
  });
  const conversation = { ...base, messages: [source] };
  const preview = await createHandoffPreview(conversation, {
    providerConnectionId: crypto.randomUUID(),
    providerType: "openai-compatible",
    modelId: "writer",
    sourceMessageId: source.id,
    selectedMessageIds: [source.id],
    selectedAssetIds: [],
    conversionWarnings: [],
    estimatedInputUnits: 4
  });
  const confirmed = confirmHandoff({ ...preview, outboundPayloadHash: "b".repeat(64) }, {
    expectedPayloadHash: preview.payloadHash,
    consentedBy: crypto.randomUUID()
  });
  const response = {
    providerResponseId: "response-1", modelId: "writer",
    contentParts: [{ type: "text", text: "Answer" }]
  };
  return { confirmed, response, continued: appendContinuationBranch(conversation, confirmed, response) };
}

describe("local AI handoff persistence adapter", () => {
  test("has no browser storage fallback", async () => {
    const store = createLocalAiHandoffStore({ native: false });
    expect(store.isAvailable()).toBe(false);
    expect(await store.list()).toEqual([]);
    expect(await store.load(crypto.randomUUID())).toBeNull();
    await expect(store.save(await fixture())).rejects.toMatchObject({ code: "tauri_database_unavailable" });
  });

  test("uses fixed native commands and restores a validated conversation", async () => {
    const value = await fixture();
    const calls = [];
    const store = createLocalAiHandoffStore({
      native: true,
      invokeImpl: async (command, input) => {
        calls.push({ command, input });
        if (command === "load_local_conversation") return JSON.stringify(value.continued);
        if (command === "list_local_conversations") return [{
          id: value.continued.id,
          title: value.continued.title,
          messageCount: value.continued.messages.length,
          updatedAt: "2026-08-30T00:00:01.000Z"
        }];
        return null;
      }
    });

    await store.save({ conversation: value.continued, confirmed: value.confirmed, response: value.response });
    const restored = await store.load(value.continued.id);
    const summaries = await store.list();

    expect(restored).toEqual(value.continued);
    expect(summaries).toHaveLength(1);
    expect(calls.map((call) => call.command)).toEqual([
      "save_local_ai_handoff_atomic",
      "load_local_conversation",
      "list_local_conversations"
    ]);
    expect(JSON.stringify(calls)).not.toContain("apiKey");
  });
});
