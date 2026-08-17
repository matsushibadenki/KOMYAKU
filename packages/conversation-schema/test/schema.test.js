import { describe, expect, test } from "bun:test";
import {
  canonicalConversationSchema,
  createConversation,
  createMessage
} from "../src/index.js";

describe("canonical conversation schema", () => {
  test("preserves multilingual authored content and branches", () => {
    const conversation = createConversation({ title: "研究メモ", defaultLanguage: "ja" });
    const root = createMessage(conversation.id, {
      sourceProvider: "generic",
      role: "user",
      contentParts: [{ type: "text", text: "é é 👨‍👩‍👧‍👦 العربية ภาษาไทย" }]
    });
    const first = createMessage(conversation.id, {
      sourceProvider: "provider-a",
      role: "assistant",
      contentParts: [{ type: "text", text: "第一案" }]
    });
    const second = createMessage(conversation.id, {
      sourceProvider: "provider-b",
      role: "assistant",
      contentParts: [{ type: "text", text: "第二案" }]
    });

    const parsed = canonicalConversationSchema.parse({
      ...conversation,
      messages: [root, first, second],
      edges: [
        { parentMessageId: root.id, childMessageId: first.id, kind: "reply" },
        { parentMessageId: root.id, childMessageId: second.id, kind: "reply" }
      ]
    });

    expect(parsed.messages[0].contentParts[0].text).toBe("é é 👨‍👩‍👧‍👦 العربية ภาษาไทย");
    expect(parsed.edges).toHaveLength(2);
  });

  test("rejects dangling graph edges", () => {
    const conversation = createConversation();
    const message = createMessage(conversation.id, {
      sourceProvider: "generic",
      role: "user"
    });

    expect(() => canonicalConversationSchema.parse({
      ...conversation,
      messages: [message],
      edges: [{ parentMessageId: message.id, childMessageId: crypto.randomUUID() }]
    })).toThrow("missing message");
  });

  test("rejects cyclic conversation graphs", () => {
    const conversation = createConversation();
    const first = createMessage(conversation.id, { sourceProvider: "generic", role: "user" });
    const second = createMessage(conversation.id, { sourceProvider: "generic", role: "assistant" });

    expect(() => canonicalConversationSchema.parse({
      ...conversation,
      messages: [first, second],
      edges: [
        { parentMessageId: first.id, childMessageId: second.id },
        { parentMessageId: second.id, childMessageId: first.id }
      ]
    })).toThrow("must not contain cycles");
  });
});
