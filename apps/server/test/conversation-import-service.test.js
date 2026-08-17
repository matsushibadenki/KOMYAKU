import { describe, expect, test } from "bun:test";
import {
  ConversationImportError,
  createConversationImportService
} from "../src/services/conversation-import-service.js";

function fixture({ authorized = true } = {}) {
  const events = [];
  const objectStore = {
    async putImmutable(input) {
      events.push(["archive", input]);
      const digest = await crypto.subtle.digest("SHA-256", input.body);
      return {
        key: input.key,
        contentHash: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
      };
    }
  };
  const repository = {
    async persistSuccessfulImport(input) { events.push(["success", input]); },
    async persistFailedImport(input) { events.push(["failure", input]); }
  };
  const service = createConversationImportService({
    objectStore,
    repository,
    authorizeImport: async (input) => {
      events.push(["authorize", input]);
      return authorized;
    }
  });
  return { events, service };
}

const identity = {
  workspaceId: crypto.randomUUID(),
  actorId: crypto.randomUUID()
};

describe("conversation import application service", () => {
  test("authorizes, archives, then persists a canonical conversation", async () => {
    const { events, service } = fixture();
    const result = await service.importGenericJson({
      ...identity,
      sourceProvider: "chatgpt",
      raw: JSON.stringify([{ id: "1", role: "user", content: "秘密の原文" }])
    });

    expect(events.map(([name]) => name)).toEqual(["authorize", "archive", "success"]);
    expect(events[1][1].body).toBeInstanceOf(Uint8Array);
    expect(events[2][1].archive.contentHash).toBe(result.sourceHash);
    expect(events[2][1].aiTrainingPolicy).toBe("deny");
  });

  test("archives invalid JSON and records a failed import", async () => {
    const { events, service } = fixture();
    const operation = service.importGenericJson({ ...identity, raw: "{invalid" });

    await expect(operation).rejects.toBeInstanceOf(ConversationImportError);
    expect(events.map(([name]) => name)).toEqual(["authorize", "archive", "failure"]);
    expect(events[2][1].importRecord.sourceHash).toHaveLength(64);
  });

  test("does not archive an unauthorized source", async () => {
    const { events, service } = fixture({ authorized: false });
    await expect(service.importGenericJson({ ...identity, raw: "[]" })).rejects.toThrow("not authorized");
    expect(events.map(([name]) => name)).toEqual(["authorize"]);
  });

  test("rejects an oversized source before object storage", async () => {
    const events = [];
    const configured = createConversationImportService({
      objectStore: { putImmutable: async () => events.push(["archive"]) },
      repository: {
        persistSuccessfulImport: async () => {},
        persistFailedImport: async () => {}
      },
      authorizeImport: async () => {
        events.push(["authorize"]);
        return true;
      },
      maxImportBytes: 1
    });

    await expect(configured.importGenericJson({ ...identity, raw: "[]" })).rejects.toThrow("byte limit");
    expect(events.map(([name]) => name)).toEqual(["authorize"]);
  });
});
