import { describe, expect, test } from "bun:test";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import {
  createVerifiedLocalSnapshotExport,
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

  test("uses a filesystem-safe localized filename", () => {
    expect(localExportFileName("稿脈: Draft/01", "md")).toBe("稿脈- Draft-01.md");
  });
});
