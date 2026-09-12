import { describe, expect, test } from "bun:test";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import {
  createVerifiedLocalHistoryExport,
  createVerifiedLocalSnapshotExport,
  downloadLocalExport,
  localExportFileName,
  renderLocalDocumentExport
} from "../src/services/local-document-export.js";

function fixture() {
  const document = createEmptyDocument();
  document.metadata.title = "稿脈: Draft";
  document.content = [
    createCanonicalNode("heading", { attrs: { level: 1, lang: "ja", dir: "auto" },
      content: [{ type: "text", text: "見出し", marks: [], metadata: {}, extensions: {} }] }),
    createCanonicalNode("paragraph", { attrs: { lang: "ja", dir: "auto" },
      content: [{ type: "text", text: "本文", marks: [{ type: "bold" }], metadata: {}, extensions: {} }] }),
    createCanonicalNode("math_block", { sourceType: "latex", source: "x^2", displayMode: "block" })
  ];
  return document;
}

describe("account-free local Document export", () => {
  test("download request failures release the blob URL and propagate to the caller", () => {
    const events = [];
    const failure = new Error("download_request_failed");
    expect(() => downloadLocalExport({ bytes: new Uint8Array([1]), mediaType: "text/plain", fileName: "qa.txt" }, {
      documentRef: { createElement: () => ({ click: () => { events.push("click"); throw failure; } }) },
      urlApi: { createObjectURL: () => "blob:qa", revokeObjectURL: (url) => events.push(url) }
    })).toThrow("download_request_failed");
    expect(events).toEqual(["click", "blob:qa"]);
  });

  test("exports authored text with explicit fidelity warnings", () => {
    const markdown = renderLocalDocumentExport(fixture(), "md");
    expect(markdown.text).toContain("# 見出し");
    expect(markdown.text).toContain("**本文**");
    expect(markdown.warnings).toEqual(["math_source_only"]);
    const plain = renderLocalDocumentExport(fixture(), "txt");
    expect(plain.text).toContain("本文");
    expect(plain.warnings).toEqual(["math_source_only", "text_formatting_omitted"]);
  });

  test("creates and rereads an asset-free v1 snapshot", async () => {
    const document = fixture();
    const exported = await createVerifiedLocalSnapshotExport(document, {
      createdAt: "2026-09-08T00:00:00.000Z"
    });
    expect(exported.extension).toBe("komyaku");
    expect(exported.formatVersion).toBe(1);
    expect(exported.archiveDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("creates and rereads a complete v2 history", async () => {
    const document = fixture();
    const versionId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const source = {
      documentId: document.id,
      currentBranchId: branchId,
      currentVersionId: versionId,
      versions: [{
        id: versionId, schemaVersion: document.schemaVersion, snapshotEncoding: "canonical-json-v1",
        snapshotJson: JSON.stringify(document), parentIds: [], authorId: crypto.randomUUID(),
        reason: "initial", restoredFromVersionId: null, label: "Initial",
        createdAt: "2026-09-12T00:00:00.000Z"
      }],
      branches: [{ id: branchId, name: "Main", headVersionId: versionId,
        createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:00:00.000Z" }],
      assets: []
    };
    const exported = await createVerifiedLocalHistoryExport(source, {
      createdAt: "2026-09-12T01:00:00.000Z"
    });
    expect(exported.extension).toBe("komyaku");
    expect(exported.formatVersion).toBe(2);
    expect(exported.archiveDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("uses a filesystem-safe localized filename", () => {
    expect(localExportFileName("稿脈: Draft/01", "md")).toBe("稿脈- Draft-01.md");
  });
});
