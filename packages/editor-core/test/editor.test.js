import { describe, expect, test } from "bun:test";
import { DOCUMENT_SCHEMA_ID, parseCanonicalDocument } from "@komyaku/document-schema";
import {
  EditorConversionError,
  canonicalToEditorDocument,
  createEditorState,
  createEmptyEditorDocument,
  editorToCanonicalDocument,
  komyakuSchema
} from "../src/index.js";

function id(number) {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

function common(number) {
  return { id: id(number), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [] };
}

describe("editor core foundation", () => {
  test("creates a language-independent structured document", () => {
    const document = createEmptyEditorDocument({ language: "ar", direction: "rtl" });
    expect(document.attrs.language).toBe("ar");
    expect(document.attrs.direction).toBe("rtl");
    expect(document.attrs.documentId).toBeTruthy();
    expect(document.firstChild.attrs.nodeId).toBeTruthy();
    expect(createEditorState({ document }).doc.eq(document)).toBe(true);
  });

  test("stores LaTeX and Mermaid authored source in canonical nodes", () => {
    const math = komyakuSchema.node("math_block", { source: "x^2 + y^2" });
    const mermaid = komyakuSchema.node("diagram", {
      source: "graph TD; A-->B;"
    });
    const document = komyakuSchema.node("doc", null, [math, mermaid]);

    expect(document.child(0).attrs.source).toBe("x^2 + y^2");
    expect(document.child(1).attrs.source).toBe("graph TD; A-->B;");
  });

  test("round-trips the canonical model through ProseMirror without changing stable IDs", () => {
    const canonical = parseCanonicalDocument({
      schemaId: DOCUMENT_SCHEMA_ID,
      schemaVersion: 1,
      id: id(1),
      type: "document",
      attrs: { language: "ja", direction: "auto", writingMode: "vertical-rl" },
      metadata: { title: "研究記録" },
      extensions: { "org.example.note": { retained: true } },
      content: [
        { ...common(2), type: "paragraph", attrs: { lang: "ja", dir: "auto" }, content: [
          { type: "text", text: "か\u3099 / が", marks: [{ type: "bold" }], metadata: {}, extensions: {} },
          { ...common(3), type: "math_inline", sourceType: "latex", source: "x^2" }
        ] },
        { ...common(4), type: "diagram", sourceType: "mermaid", source: "graph TD; A-->B;", altText: "流れ", caption: [] },
        { ...common(5), type: "table", content: [
          { ...common(6), type: "table_row", content: [
            { ...common(7), type: "table_cell", attrs: { header: true, colspan: 1, rowspan: 1 }, content: [
              { ...common(8), type: "paragraph", attrs: { lang: null, dir: "auto" }, content: [] }
            ] }
          ] }
        ] }
      ]
    });

    expect(editorToCanonicalDocument(canonicalToEditorDocument(canonical))).toEqual(canonical);
  });

  test("assigns stable IDs when converting pre-identity editor JSON", () => {
    const ids = [id(1), id(2)];
    const canonical = editorToCanonicalDocument({
      type: "doc",
      attrs: { language: "zh-Hans" },
      content: [{ type: "paragraph", content: [{ type: "text", text: "继续" }] }]
    }, { idFactory: () => ids.shift() });

    expect(canonical.id).toBe(id(1));
    expect(canonical.content[0].id).toBe(id(2));
    expect(canonical.content[0].content[0].text).toBe("继续");
  });

  test("fails explicitly when text metadata cannot be represented by ProseMirror", () => {
    const canonical = parseCanonicalDocument({
      schemaId: DOCUMENT_SCHEMA_ID,
      schemaVersion: 1,
      id: id(1),
      type: "document",
      attrs: { language: "en", direction: "ltr", writingMode: "horizontal-tb" },
      metadata: {}, extensions: {},
      content: [{ ...common(2), type: "paragraph", attrs: { lang: null, dir: "auto" }, content: [
        { type: "text", text: "annotated", marks: [], metadata: { source: "import" }, extensions: {} }
      ] }]
    });

    expect(() => canonicalToEditorDocument(canonical)).toThrow(EditorConversionError);
  });
});
