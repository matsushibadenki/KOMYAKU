import { describe, expect, test } from "bun:test";
import { createKomyakuArchive } from "@komyaku/archive-core";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import { createArchiveImportService } from "../src/services/archive-import-service.js";

async function archiveFixture(mediaType = "text/markdown") {
  const document = createEmptyDocument();
  const assetId = crypto.randomUUID();
  const bytes = new TextEncoder().encode("# history\n");
  document.content.push(createCanonicalNode("file", { assetId, mediaType, fileName: "history.md" }));
  return { document, assetId, archive: await createKomyakuArchive({ document, assets: [{ id: assetId, mediaType, bytes }] }) };
}

describe("Archive import service", () => {
  test("inspects and stores every Asset before atomic materialization", async () => {
    const fixture = await archiveFixture();
    let materialized;
    const service = createArchiveImportService({
      inspector: { inspect: async () => ({ decision: "accepted", detectedMediaType: "text/markdown", policyVersion: "baseline-signature-v1" }) },
      objectStore: { putContentAddressed: async ({ body }) => ({ key: "cas/key", contentHash: new Bun.CryptoHasher("sha256").update(body).digest("hex"), byteSize: body.byteLength }) },
      repository: { materialize: async (value) => { materialized = value; return { importId: value.importId, documentId: value.document.id, assetCount: value.assets.length, replayed: false, document: value.document }; } },
      now: () => new Date("2026-08-31T00:00:00.000Z"), idFactory: () => crypto.randomUUID()
    });
    const result = await service.importArchive({ workspaceId: crypto.randomUUID(), actorId: crypto.randomUUID(), bytes: fixture.archive });
    expect(result.documentId).toBe(fixture.document.id);
    expect(materialized.assets[0]).toMatchObject({ id: fixture.assetId, mediaType: "text/markdown", storageKey: "cas/key" });
  });

  test("rejects media outside the current safe Cloud profile before Object Storage write", async () => {
    const fixture = await archiveFixture("application/pdf");
    let writes = 0;
    const service = createArchiveImportService({
      inspector: { inspect: async () => ({ decision: "accepted", detectedMediaType: "application/pdf" }) },
      objectStore: { putContentAddressed: async () => { writes += 1; } },
      repository: { materialize: async () => {} }
    });
    await expect(service.importArchive({ workspaceId: crypto.randomUUID(), actorId: crypto.randomUUID(), bytes: fixture.archive }))
      .rejects.toThrow("media type is not supported");
    expect(writes).toBe(0);
  });
});
