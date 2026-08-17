import { describe, expect, test } from "bun:test";
import { importGenericJsonConversation } from "../src/index.js";

describe("generic JSON conversation importer", () => {
  test("imports a linear multilingual conversation without normalizing authored text", async () => {
    const authored = "é é 日本語 简体中文 👨‍👩‍👧‍👦";
    const result = await importGenericJsonConversation(JSON.stringify({
      title: "研究ログ",
      defaultLanguage: "ja",
      messages: [
        { id: "u1", role: "user", content: authored },
        { id: "a1", role: "assistant", content: [{ type: "text", text: "続き" }] }
      ]
    }));

    expect(result.status).toBe("complete");
    expect(result.conversation.messages[0].contentParts[0].text).toBe(authored);
    expect(result.conversation.edges).toHaveLength(1);
    expect(result.conversation.messages[0].importProvenance.sourceHash).toBe(result.sourceHash);
  });

  test("preserves explicit branches", async () => {
    const result = await importGenericJsonConversation(JSON.stringify([
      { id: "root", parentId: null, role: "user", content: "Question" },
      { id: "left", parentId: "root", role: "assistant", content: "A" },
      { id: "right", parentId: "root", role: "assistant", content: "B" }
    ]));

    expect(result.conversation.edges).toHaveLength(2);
    expect(new Set(result.conversation.edges.map((edge) => edge.parentMessageId)).size).toBe(1);
  });

  test("reports dangling parents and duplicate source IDs as a partial import", async () => {
    const result = await importGenericJsonConversation(JSON.stringify([
      { id: "same", parentId: null, role: "user", content: "one" },
      { id: "same", parentId: "missing", role: "custom-role", content: { type: "vendor", payload: 1 } }
    ]));

    expect(result.status).toBe("partial");
    expect(result.warnings).toHaveLength(2);
    expect(result.conversation.messages[1].sourceMessageId).toBe("same#duplicate-2");
    expect(result.conversation.messages[1].contentParts[0].type).toBe("unknown_provider_part");
    expect(result.conversation.messages[1].role).toBe("custom-role");
  });

  test("rejects size and message count limits", async () => {
    await expect(importGenericJsonConversation("[]", { maxBytes: 1 })).rejects.toThrow("byte limit");
    await expect(importGenericJsonConversation("[{},{}]", { maxMessages: 1 })).rejects.toThrow("message limit");
  });

  test("rejects a cyclic source graph", async () => {
    await expect(importGenericJsonConversation(JSON.stringify([
      { id: "a", parentId: "b", role: "user", content: "A" },
      { id: "b", parentId: "a", role: "assistant", content: "B" }
    ]))).rejects.toThrow("must not contain cycles");
  });
});
