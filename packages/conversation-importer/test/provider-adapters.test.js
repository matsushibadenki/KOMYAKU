import { describe, expect, test } from "bun:test";
import {
  CHATGPT_EXPORT_PARSER_NAME,
  CLAUDE_EXPORT_PARSER_NAME,
  GEMINI_EXPORT_PARSER_NAME,
  detectConversationExportProvider,
  importChatGptExport,
  importClaudeExport,
  importGeminiExport
} from "../src/index.js";

const fixtureUrl = (name) => new URL(`./fixtures/${name}`, import.meta.url);
const fixture = (name) => Bun.file(fixtureUrl(name)).text();

describe("provider conversation export adapters", () => {
  test("imports ChatGPT mapping branches with original export provenance", async () => {
    const raw = await fixture("chatgpt-conversations.json");
    const result = await importChatGptExport(raw);
    const conversation = result.conversations[0];

    expect(detectConversationExportProvider(raw)).toBe("chatgpt");
    expect(result.status).toBe("complete");
    expect(conversation.messages).toHaveLength(3);
    expect(conversation.edges).toHaveLength(2);
    expect(new Set(conversation.edges.map((edge) => edge.parentMessageId)).size).toBe(1);
    expect(conversation.messages[0].contentParts[0].text).toBe("日本語 / English / 简体中文");
    expect(conversation.messages[0].importProvenance.parserName).toBe(CHATGPT_EXPORT_PARSER_NAME);
    expect(conversation.messages.every((message) =>
      message.importProvenance.sourceHash === result.sourceHash)).toBe(true);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    const expectedHash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0")).join("");
    expect(result.sourceHash).toBe(expectedHash);
  });

  test("imports Claude chat_messages and maps human to user", async () => {
    const raw = await fixture("claude-conversations.json");
    const result = await importClaudeExport(raw);
    const conversation = result.conversations[0];

    expect(detectConversationExportProvider(raw)).toBe("claude");
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(conversation.edges).toHaveLength(1);
    expect(conversation.messages[0].importProvenance.parserName).toBe(CLAUDE_EXPORT_PARSER_NAME);
  });

  test("imports structured Gemini entries and maps model to assistant", async () => {
    const raw = await fixture("gemini-conversations.json");
    const result = await importGeminiExport(raw);
    const conversation = result.conversations[0];

    expect(detectConversationExportProvider(raw)).toBe("gemini");
    expect(result.status).toBe("complete");
    expect(conversation.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(conversation.messages[1].contentParts[0].text).toBe("次の段階を整理します。");
    expect(conversation.messages[0].importProvenance.parserName).toBe(GEMINI_EXPORT_PARSER_NAME);
  });

  test("preserves flat Gemini My Activity safe HTML without inventing thread membership", async () => {
    const raw = await fixture("gemini-my-activity.json");
    const result = await importGeminiExport(raw);
    const conversation = result.conversations[0];

    expect(detectConversationExportProvider(raw)).toBe("gemini");
    expect(result.status).toBe("partial");
    expect(result.warnings[0]).toContain("flat");
    expect(conversation.messages[1].contentParts[0]).toMatchObject({
      type: "unknown_provider_part",
      providerType: "gemini_safe_html"
    });
  });

  test("enforces a message limit across all conversations", async () => {
    const raw = await fixture("claude-conversations.json");
    const repeated = JSON.stringify([...JSON.parse(raw), ...JSON.parse(raw)]);
    await expect(importClaudeExport(repeated, { maxMessages: 3 })).rejects.toThrow("message limit");
  });

  test("splits a multi-conversation bundle while retaining one provenance identity", async () => {
    const raw = await fixture("claude-conversations.json");
    const repeated = JSON.stringify([...JSON.parse(raw), ...JSON.parse(raw)]);
    const result = await importClaudeExport(repeated);

    expect(result.conversations).toHaveLength(2);
    const provenances = result.conversations.flatMap((conversation) =>
      conversation.messages.map((message) => message.importProvenance));
    expect(new Set(provenances.map((value) => value.importId)).size).toBe(1);
    expect(new Set(provenances.map((value) => value.sourceHash)).size).toBe(1);
  });

  test("produces the same provider Conversation and Message IDs in independent parses", async () => {
    for (const [name, importer] of [
      ["chatgpt-conversations.json", importChatGptExport],
      ["claude-conversations.json", importClaudeExport],
      ["gemini-conversations.json", importGeminiExport],
      ["gemini-my-activity.json", importGeminiExport]
    ]) {
      const raw = await fixture(name);
      const first = await importer(raw, { importId: crypto.randomUUID() });
      const second = await importer(raw, { importId: crypto.randomUUID() });
      expect(second.conversations.map(({ id }) => id)).toEqual(first.conversations.map(({ id }) => id));
      expect(second.conversations.map((conversation) => conversation.messages.map(({ id }) => id)))
        .toEqual(first.conversations.map((conversation) => conversation.messages.map(({ id }) => id)));
    }
  });

  test("rejects an empty provider export", async () => {
    await expect(importChatGptExport("[]")).rejects.toThrow("no conversations");
  });

  test("reports a broken ChatGPT parent chain instead of inventing an edge", async () => {
    const raw = JSON.stringify([{ title: "Broken", mapping: {
      child: {
        parent: "missing",
        message: { id: "child", author: { role: "user" }, content: { parts: ["text"] } }
      }
    } }]);
    const result = await importChatGptExport(raw);

    expect(result.status).toBe("partial");
    expect(result.warnings[0]).toContain("missing node");
    expect(result.conversations[0].edges).toHaveLength(0);
  });

  test("does not guess an unknown JSON provider", () => {
    expect(detectConversationExportProvider('{"messages":[]}')).toBeNull();
  });
});
