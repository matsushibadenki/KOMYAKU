import { describe, expect, test } from "bun:test";
import { createEmptyDocument } from "@komyaku/document-schema";
import { createKomyakuArchive, createKomyakuHistoryArchive } from "@komyaku/archive-core";
import {
  LocalArchiveImportConflictError,
  materializeLocalHistoryImport,
  materializeLocalKomyakuImport,
  verifyLocalKomyakuImport
} from "../src/services/local-komyaku-import.js";

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

  test("preserves a v1 native identity conflict after format detection", async () => {
    const document = createEmptyDocument();
    const archive = await createKomyakuArchive({ document, assets: [] });
    await expect(materializeLocalKomyakuImport(archive, {
      native: true,
      invokeImpl: async () => { throw "local_archive_document_identity_conflict"; }
    })).rejects.toBeInstanceOf(LocalArchiveImportConflictError);
  });

  test("passes every verified v2 Version, parent, Branch, and exact Asset byte to one native transaction", async () => {
    const document = createEmptyDocument();
    const authorId = crypto.randomUUID();
    const initialId = crypto.randomUUID();
    const currentId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const historical = structuredClone(document);
    historical.metadata.title = "Historical";
    historical.content.push({
      id: crypto.randomUUID(), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [],
      type: "file", assetId, mediaType: "text/markdown", fileName: "history.md",
      title: null, description: null
    });
    document.metadata.title = "Current";
    const exact = (value) => `${JSON.stringify(value, null, 2)}\n`;
    const history = await createKomyakuHistoryArchive({
      documentId: document.id,
      currentBranchId: branchId,
      currentVersionId: currentId,
      versions: [
        { id: currentId, schemaVersion: 1, snapshotEncoding: "canonical-json-v1",
          snapshotJson: exact(document), parentIds: [initialId], authorId, reason: "named",
          restoredFromVersionId: null, label: "Current", createdAt: "2026-09-15T00:01:00.000Z" },
        { id: initialId, schemaVersion: 1, snapshotEncoding: "canonical-json-v1",
          snapshotJson: exact(historical), parentIds: [], authorId, reason: "initial",
          restoredFromVersionId: null, label: "Initial", createdAt: "2026-09-15T00:00:00.000Z" }
      ],
      branches: [{ id: branchId, name: "Main", headVersionId: currentId,
        createdAt: "2026-09-15T00:00:00.000Z", updatedAt: "2026-09-15T00:01:00.000Z" }],
      assets: [{ id: assetId, mediaType: "text/markdown",
        bytes: new TextEncoder().encode("# Historical only\n") }],
      createdAt: "2026-09-15T00:02:00.000Z"
    });
    let command;
    const imported = await materializeLocalHistoryImport(history, {
      native: true, now: () => new Date("2026-09-15T00:03:00.000Z"),
      invokeImpl: async (name, payload) => {
        command = { name, payload };
        const input = payload.input;
        return { archiveDigest: input.archiveDigest, documentId: document.id,
          currentBranchId: branchId, currentVersionId: currentId,
          contentJson: input.document.contentJson, versionCount: 2, branchCount: 1,
          assetCount: 1, replayed: false };
      }
    });
    expect(command.name).toBe("import_local_history_archive_atomic");
    expect(command.payload.input.versions.map(({ id }) => id).sort()).toEqual([initialId, currentId].sort());
    expect(command.payload.input.versions.find(({ id }) => id === currentId).parentIds).toEqual([initialId]);
    expect(command.payload.input.assets[0].bytes).toEqual(
      Array.from(new TextEncoder().encode("# Historical only\n"))
    );
    expect(imported).toMatchObject({ document, formatVersion: 2,
      versionCount: 2, branchCount: 1, assetCount: 1, materialized: true });
  });
});
