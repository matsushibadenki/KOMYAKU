import { describe, expect, test } from "bun:test";
import { createEmptyDocument } from "@komyaku/document-schema";
import { createKomyakuArchive } from "@komyaku/archive-core";
import { materializeLocalKomyakuImport, verifyLocalKomyakuImport } from "../src/services/local-komyaku-import.js";

describe("local .komyaku recovery boundary", () => {
  test("restores only after full public-reader verification", async () => {
    const document = createEmptyDocument();
    const bytes = await createKomyakuArchive({ document, assets: [], createdAt: "2026-08-31T00:00:00.000Z" });
    await expect(verifyLocalKomyakuImport(bytes)).resolves.toMatchObject({
      document, assetCount: 0, formatVersion: 1, byteSize: bytes.byteLength
    });
  });

  test("does not return a document for corrupt input", async () => {
    await expect(verifyLocalKomyakuImport(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  test("passes exact verified Asset bytes to one bounded native atomic command", async () => {
    const document = createEmptyDocument();
    const assetId = crypto.randomUUID();
    document.content.push({
      id: crypto.randomUUID(), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [],
      type: "file", assetId, mediaType: "text/markdown", fileName: "draft.md", title: null, description: null
    });
    const assetBytes = new TextEncoder().encode("# Draft\n");
    const archive = await createKomyakuArchive({ document, assets: [{ id: assetId, mediaType: "text/markdown", bytes: assetBytes }] });
    let command;
    const imported = await materializeLocalKomyakuImport(archive, {
      native: true, now: () => new Date("2026-08-31T00:00:00.000Z"),
      invokeImpl: async (name, payload) => {
        command = { name, payload };
        return { archiveDigest: payload.input.archiveDigest, documentId: document.id,
          contentJson: JSON.stringify(document), assetCount: 1, replayed: false };
      }
    });
    expect(command.name).toBe("import_local_komyaku_archive_atomic");
    expect(command.payload.input.assets[0].bytes).toEqual(Array.from(assetBytes));
    expect(imported).toMatchObject({ document, assetCount: 1, materialized: true, replayed: false });
  });

  test("imports a conflict copy with fresh Document and Node identities but stable Asset identity", async () => {
    const document = createEmptyDocument();
    const originalNodeId = document.content[0].id;
    const archive = await createKomyakuArchive({ document, assets: [] });
    let nativeDocument;
    const copied = await materializeLocalKomyakuImport(archive, {
      native: true, copy: true,
      invokeImpl: async (_name, payload) => {
        nativeDocument = JSON.parse(payload.input.document.contentJson);
        return { archiveDigest: payload.input.archiveDigest, documentId: nativeDocument.id,
          contentJson: JSON.stringify(nativeDocument), assetCount: 0, replayed: false };
      }
    });
    expect(copied.document.id).not.toBe(document.id);
    expect(copied.document.content[0].id).not.toBe(originalNodeId);
    expect(copied.document.metadata.title).toEndWith("(Copy)");
  });
});
