import { describe, expect, test } from "bun:test";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import { createArchiveImportRepository } from "../src/repositories/archive-import-repository.js";

function fakeDatabase({ documentInsert = true, replay = null } = {}) {
  const calls = [];
  const tx = async (strings, ...values) => {
    const query = strings.join("?").replace(/\s+/g, " ").trim();
    calls.push({ query, values });
    if (query.includes("SELECT 1 FROM workspace_members")) return [{}];
    if (query.includes("FROM cloud_archive_imports imported")) return replay ? [replay] : [];
    if (query.includes("INSERT INTO assets")) return [{
      id: "22222222-2222-4222-8222-222222222222",
      media_type: values[2], byte_size: values[3], content_hash: values[4]
    }];
    if (query.includes("INSERT INTO cloud_documents")) return documentInsert ? [{ id: values[1] }] : [];
    if (query.includes("INSERT INTO cloud_archive_imports")) return [{ id: values[0] }];
    return [];
  };
  const sql = { begin: async (callback) => callback(tx) };
  return { sql, calls };
}

function fixture() {
  const document = createEmptyDocument();
  const originalAssetId = "11111111-1111-4111-8111-111111111111";
  document.content.push(createCanonicalNode("file", {
    assetId: originalAssetId, mediaType: "text/markdown", fileName: "draft.md"
  }));
  return { document, originalAssetId };
}

describe("Archive import repository", () => {
  test("remaps deduplicated Asset identity and commits references, Document, import, and audit together", async () => {
    const database = fakeDatabase();
    const { document, originalAssetId } = fixture();
    const result = await createArchiveImportRepository(database.sql).materialize({
      workspaceId: crypto.randomUUID(), actorId: crypto.randomUUID(), importId: crypto.randomUUID(),
      archiveDigest: "a".repeat(64), document, importedAt: "2026-08-31T00:00:00.000Z",
      assets: [{ id: originalAssetId, mediaType: "text/markdown", byteSize: 5, contentHash: "b".repeat(64), storageKey: "key", detectedMediaType: "text/markdown", policyVersion: "baseline-signature-v1", width: null, height: null }]
    });
    expect(result.document.content[0].assetId).toBe("22222222-2222-4222-8222-222222222222");
    expect(database.calls.some((call) => call.query.includes("INSERT INTO asset_references")
      && call.values.includes("22222222-2222-4222-8222-222222222222"))).toBe(true);
    expect(database.calls.some((call) => call.query.includes("archive.import_materialized"))).toBe(true);
  });

  test("fails closed when another Archive already owns the Document identity", async () => {
    const database = fakeDatabase({ documentInsert: false });
    const { document } = fixture();
    await expect(createArchiveImportRepository(database.sql).materialize({
      workspaceId: crypto.randomUUID(), actorId: crypto.randomUUID(), importId: crypto.randomUUID(),
      archiveDigest: "c".repeat(64), document, assets: [], importedAt: "2026-08-31T00:00:00.000Z"
    })).rejects.toThrow("Document identity conflict");
    expect(database.calls.some((call) => call.query.includes("INSERT INTO cloud_archive_imports"))).toBe(false);
  });

  test("returns the committed Canonical Document for digest replay", async () => {
    const { document } = fixture();
    const importId = crypto.randomUUID();
    const database = fakeDatabase({ replay: { id: importId, document_id: document.id, asset_count: 1, canonical_json: document } });
    const result = await createArchiveImportRepository(database.sql).materialize({
      workspaceId: crypto.randomUUID(), actorId: crypto.randomUUID(), importId: crypto.randomUUID(),
      archiveDigest: "d".repeat(64), document, assets: [], importedAt: "2026-08-31T00:00:00.000Z"
    });
    expect(result).toMatchObject({ importId, documentId: document.id, assetCount: 1, replayed: true, document });
    expect(database.calls.some((call) => call.query.includes("INSERT INTO cloud_documents"))).toBe(false);
  });
});
