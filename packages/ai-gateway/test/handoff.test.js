import { describe, expect, test } from "bun:test";
import { createConversation, createMessage } from "@komyaku/conversation-schema";
import { confirmHandoff, createHandoffPreview } from "../src/index.js";

function fixture() {
  const conversation = createConversation({ title: "Handoff" });
  const message = createMessage(conversation.id, {
    sourceProvider: "generic",
    role: "user",
    contentParts: [{ type: "text", text: "Continue from here" }]
  });
  return { ...conversation, messages: [message], message };
}

describe("AI handoff review boundary", () => {
  test("creates a content-bound preview and explicit confirmation", async () => {
    const conversation = fixture();
    const preview = await createHandoffPreview(conversation, {
      providerConnectionId: crypto.randomUUID(),
      providerType: "compatible-api",
      modelId: "example-model",
      sourceMessageId: conversation.message.id,
      selectedMessageIds: [conversation.message.id],
      estimatedInputUnits: 42
    });

    const confirmed = confirmHandoff(preview, {
      expectedPayloadHash: preview.payloadHash,
      consentedBy: crypto.randomUUID()
    });

    expect(confirmed.payloadHash).toBe(preview.payloadHash);
    expect(confirmed.consentedAt).toBeString();
  });

  test("requires another review when the expected context hash changed", async () => {
    const conversation = fixture();
    const preview = await createHandoffPreview(conversation, {
      providerConnectionId: crypto.randomUUID(),
      providerType: "compatible-api",
      modelId: "example-model",
      sourceMessageId: conversation.message.id,
      selectedMessageIds: [conversation.message.id],
      estimatedInputUnits: 42
    });

    expect(() => confirmHandoff(preview, {
      expectedPayloadHash: "0".repeat(64),
      consentedBy: crypto.randomUUID()
    })).toThrow("reviewed again");
  });
});
