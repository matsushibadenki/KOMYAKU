import { describe, expect, test } from "bun:test";
import { DOCUMENT_SCHEMA_ID } from "@komyaku/document-schema";
import {
  LocalDraftPersistenceError,
  createBrowserLocalDraftBackend,
  loadLocalDraft,
  saveLocalDraft
} from "../src/services/local-database.js";

const DOCUMENT_ID = "00000000-0000-4000-8000-000000000001";

function fixture(text = "復旧する本文 / Restored text / 恢复正文") {
  return {
    schemaId: DOCUMENT_SCHEMA_ID,
    schemaVersion: 1,
    id: DOCUMENT_ID,
    type: "document",
    attrs: { language: "ja", direction: "auto", writingMode: "horizontal-tb" },
    metadata: { title: "Recovery fixture" },
    extensions: {},
    content: [{
      id: "00000000-0000-4000-8000-000000000002",
      schemaVersion: 1,
      metadata: {},
      extensions: {},
      renderArtifacts: [],
      type: "paragraph",
      attrs: { lang: "ja", dir: "auto" },
      content: [{ type: "text", text, marks: [], metadata: {}, extensions: {} }]
    }]
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, value); }
  };
}

describe("local Canonical draft persistence", () => {
  test("round-trips a validated multilingual draft and its monotonic revision", async () => {
    const backend = createBrowserLocalDraftBackend(memoryStorage());
    const content = fixture();

    await saveLocalDraft({
      documentId: DOCUMENT_ID,
      schemaVersion: 1,
      content,
      localRevision: 7,
      updatedAt: "2026-08-24T00:00:00.000Z"
    }, { backend });

    const restored = await loadLocalDraft(DOCUMENT_ID, { backend });
    expect(restored.content).toEqual(content);
    expect(restored.localRevision).toBe(7);
    expect(restored.updatedAt).toBe("2026-08-24T00:00:00.000Z");
  });

  test("fails closed when stored JSON is corrupt", async () => {
    const storage = memoryStorage();
    storage.setItem(`komyaku:local-draft:${DOCUMENT_ID}`, "{broken");
    const backend = createBrowserLocalDraftBackend(storage);

    await expect(loadLocalDraft(DOCUMENT_ID, { backend })).rejects.toMatchObject({
      name: "LocalDraftPersistenceError",
      code: "invalid_local_draft"
    });
  });

  test("rejects a draft whose canonical document identity does not match the storage key", async () => {
    const backend = createBrowserLocalDraftBackend(memoryStorage());
    await expect(saveLocalDraft({
      documentId: "00000000-0000-4000-8000-000000000099",
      schemaVersion: 1,
      content: fixture(),
      localRevision: 1
    }, { backend })).rejects.toBeInstanceOf(LocalDraftPersistenceError);
  });

  test("rejects stale revisions instead of overwriting newer local work", async () => {
    const backend = createBrowserLocalDraftBackend(memoryStorage());
    const input = { documentId: DOCUMENT_ID, schemaVersion: 1, content: fixture(), localRevision: 2 };
    await saveLocalDraft(input, { backend });

    await expect(saveLocalDraft({ ...input, localRevision: 1 }, { backend })).rejects.toMatchObject({
      code: "stale_local_revision"
    });
    expect((await loadLocalDraft(DOCUMENT_ID, { backend })).localRevision).toBe(2);
  });
});
