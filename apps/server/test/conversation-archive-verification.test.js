import { describe, expect, test } from "bun:test";
import { createConversationArchiveVerificationHandler } from "../src/services/conversation-archive-verification.js";

const importId = crypto.randomUUID();
const archive = { storageKey: "imports/source.bin", byteSize: 12, contentHash: "a".repeat(64) };

function handler({ record = archive, head } = {}) {
  return createConversationArchiveVerificationHandler({
    repository: { findImportArchive: async () => record },
    objectStore: { head: head ?? (async () => ({ ContentLength: 12, Metadata: { "content-sha256": "a".repeat(64) } })) }
  });
}

describe("conversation archive verification job", () => {
  test("accepts matching immutable object metadata", async () => {
    await expect(handler()({ payload: { importId } })).resolves.toBeUndefined();
  });

  test("treats a missing database record and corrupt metadata as permanent", async () => {
    await expect(handler({ record: null })({ payload: { importId } })).rejects.toMatchObject({
      code: "archive_record_missing", retryable: false
    });
    await expect(handler({ head: async () => ({ ContentLength: 11, Metadata: {} }) })({
      payload: { importId }
    })).rejects.toMatchObject({ code: "archive_size_mismatch", retryable: false });
  });

  test("retries temporary object-store failures", async () => {
    await expect(handler({ head: async () => { throw new Error("offline"); } })({
      payload: { importId }
    })).rejects.toMatchObject({ code: "archive_object_unavailable", retryable: true });
  });
});
