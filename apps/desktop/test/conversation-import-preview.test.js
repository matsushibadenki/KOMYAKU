import { describe, expect, test } from "bun:test";
import { previewConversationExport } from "../src/services/conversation-import-preview.js";

function chatGptExport() {
  return new TextEncoder().encode(JSON.stringify([{
    id: "conversation-1",
    title: "Branched discussion",
    mapping: {
      root: { id: "root", parent: null, children: ["prompt"], message: null },
      prompt: {
        id: "prompt", parent: "root", children: ["answer-a", "answer-b"],
        message: { author: { role: "user" }, content: { parts: ["Question"] } }
      },
      "answer-a": {
        id: "answer-a", parent: "prompt", children: [],
        message: { author: { role: "assistant" }, content: { parts: ["A"] } }
      },
      "answer-b": {
        id: "answer-b", parent: "prompt", children: [],
        message: { author: { role: "assistant" }, content: { parts: ["B"] } }
      }
    }
  }]));
}

describe("conversation export local preview", () => {
  test("auto-detects a provider and summarizes branches without returning message content", async () => {
    const preview = await previewConversationExport(chatGptExport());

    expect(preview).toMatchObject({
      provider: "chatgpt", conversationCount: 1, messageCount: 3, status: "complete"
    });
    expect(preview.conversations[0]).toMatchObject({
      title: "Branched discussion", messageCount: 3, branchCount: 1
    });
    expect(JSON.stringify(preview)).not.toContain("Question");
    expect(preview.sourceHash).toHaveLength(64);
  });

  test("rejects empty, oversized, and mismatched exports before a review is shown", async () => {
    await expect(previewConversationExport(new Uint8Array())).rejects.toThrow("empty_file");
    await expect(previewConversationExport(new Uint8Array(10 * 1024 * 1024 + 1))).rejects.toThrow("file_too_large");
    await expect(previewConversationExport(chatGptExport(), "claude")).rejects.toThrow("chat_messages");
  });
});
