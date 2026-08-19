import { describe, expect, test } from "bun:test";
import {
  DOCUMENT_SCHEMA_ID,
  DocumentSchemaError,
  collectAssetIds,
  collectNodeIds,
  createCanonicalNode,
  createEmptyDocument,
  migrateCanonicalDocument,
  parseCanonicalDocument,
  safeParseCanonicalDocument,
  serializeCanonicalDocument
} from "../src/index.js";

function id(number) {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

function common(number) {
  return {
    id: id(number), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: []
  };
}

function paragraph(number, text) {
  return {
    ...common(number), type: "paragraph", attrs: { lang: null, dir: "auto" },
    content: [{ type: "text", text, marks: [], metadata: {}, extensions: {} }]
  };
}

describe("Canonical Document Schema v1", () => {
  test("creates a multilingual empty document with stable block identity", () => {
    const document = createEmptyDocument({
      id: id(1), language: "zh-Hans", direction: "ltr", nodeIdFactory: () => id(2)
    });
    expect(document).toMatchObject({
      schemaId: DOCUMENT_SCHEMA_ID,
      schemaVersion: 1,
      id: id(1),
      attrs: { language: "zh-Hans", direction: "ltr", writingMode: "horizontal-tb" }
    });
    expect(document.content[0]).toMatchObject({ id: id(2), type: "paragraph" });
    expect(collectNodeIds(document)).toEqual([id(1), id(2)]);
  });

  test("round-trips first-class text, table, image, math, code, diagram, and file nodes", () => {
    const imageAsset = id(80);
    const previewAsset = id(81);
    const fileAsset = id(82);
    const document = parseCanonicalDocument({
      schemaId: DOCUMENT_SCHEMA_ID,
      schemaVersion: 1,
      id: id(1),
      type: "document",
      attrs: { language: "ja", direction: "auto", writingMode: "vertical-rl" },
      metadata: { title: "研究ノート🧪", unknownCompatible: { retained: true } },
      extensions: { "org.example.research": { specimen: "標本A" } },
      content: [
        paragraph(2, "正規化しない：か\u3099 / が / 👨‍👩‍👧‍👦"),
        { ...common(3), type: "heading", attrs: { level: 2, lang: "en", dir: "ltr" },
          content: [{ type: "text", text: "Results", marks: [{ type: "bold" }], metadata: {}, extensions: {} }] },
        { ...common(4), type: "table", content: [
          { ...common(5), type: "table_row", content: [
            { ...common(6), type: "table_cell", attrs: { header: true, colspan: 1, rowspan: 1 },
              content: [paragraph(7, "項目")] }
          ] }
        ] },
        { ...common(8), type: "image", assetId: imageAsset, mediaType: "image/png",
          altText: "実験結果のグラフ", caption: [], width: 1200, height: 800,
          renderArtifacts: [{ assetId: previewAsset, role: "thumbnail", mediaType: "image/webp" }] },
        { ...common(9), type: "math_block", sourceType: "latex", source: "E = mc^2", displayMode: "block" },
        { ...common(10), type: "code_block", language: "rust", source: "fn main() {}" },
        { ...common(11), type: "diagram", sourceType: "mermaid", source: "graph TD; A-->B;",
          altText: "AからBへの流れ", caption: [] },
        { ...common(12), type: "file", assetId: fileAsset, mediaType: "application/pdf",
          fileName: "設計資料.pdf", title: "設計資料", description: null }
      ]
    });

    const restored = parseCanonicalDocument(JSON.parse(serializeCanonicalDocument(document)));
    expect(restored).toEqual(document);
    expect(restored.content[0].content[0].text).toBe("正規化しない：か\u3099 / が / 👨‍👩‍👧‍👦");
    expect(restored.metadata.unknownCompatible).toEqual({ retained: true });
    expect(restored.extensions["org.example.research"]).toEqual({ specimen: "標本A" });
    expect(new Set(collectAssetIds(restored))).toEqual(new Set([imageAsset, previewAsset, fileAsset]));
  });

  test("rejects duplicate IDs, invalid structural parents, and unsafe links", () => {
    const duplicate = createEmptyDocument({ id: id(1), nodeIdFactory: () => id(2) });
    duplicate.content.push({ ...paragraph(2, "duplicate") });
    expect(() => parseCanonicalDocument(duplicate)).toThrow(DocumentSchemaError);

    const invalidParent = createEmptyDocument({ id: id(1), nodeIdFactory: () => id(2) });
    invalidParent.content = [{ ...common(3), type: "table_row", content: [
      { ...common(4), type: "table_cell", attrs: { header: false, colspan: 1, rowspan: 1 },
        content: [paragraph(5, "cell")] }
    ] }];
    expect(() => parseCanonicalDocument(invalidParent)).toThrow("table_row cannot be a child of document");

    const unsafe = createEmptyDocument({ id: id(1), nodeIdFactory: () => id(2) });
    unsafe.content[0].content = [{
      type: "text", text: "bad", marks: [{ type: "link", href: "javascript:alert(1)" }],
      metadata: {}, extensions: {}
    }];
    expect(safeParseCanonicalDocument(unsafe).success).toBe(false);

    unsafe.content[0].content[0].marks[0].href = "//evil.example/path";
    expect(safeParseCanonicalDocument(unsafe).success).toBe(false);
  });

  test("enforces configurable complexity boundaries", () => {
    const document = createEmptyDocument({ id: id(1), nodeIdFactory: () => id(2) });
    document.content.push(paragraph(3, "two"));
    expect(() => parseCanonicalDocument(document, { limits: { maxNodes: 1 } }))
      .toThrow("document_has_too_many_nodes");
  });

  test("migrates the pre-v1 editor foundation without losing authored source", () => {
    const ids = [id(1), id(2), id(3), id(4)];
    const migrated = migrateCanonicalDocument({
      schemaVersion: 1,
      type: "doc",
      attrs: { language: "ja", direction: "auto", writingMode: "horizontal-tb" },
      metadata: { importedBy: "foundation" },
      content: [
        { type: "paragraph", attrs: { lang: "ja", dir: "auto" }, content: [
          { type: "text", text: "か\u3099を保持", marks: [{ type: "italic" }] }
        ] },
        { type: "math_block", attrs: { source: "x^2" } },
        { type: "mermaid_block", attrs: { source: "graph TD; A-->B;" } }
      ]
    }, { idFactory: () => ids.shift() });

    expect(migrated.id).toBe(id(1));
    expect(migrated.content.map((node) => node.type)).toEqual(["paragraph", "math_block", "diagram"]);
    expect(migrated.content[0].content[0].text).toBe("か\u3099を保持");
    expect(migrated.content[1].source).toBe("x^2");
    expect(migrated.content[2]).toMatchObject({ sourceType: "mermaid", source: "graph TD; A-->B;" });
    expect(migrated.metadata).toEqual({ importedBy: "foundation" });
  });

  test("does not silently reinterpret future schemas or unknown node types", () => {
    expect(() => migrateCanonicalDocument({
      schemaId: "https://example.com/future", schemaVersion: 2, type: "document", content: []
    })).toThrow("unsupported_document_schema_version");
    expect(() => createCanonicalNode("unknown_future_node", {})).toThrow();
  });
});
