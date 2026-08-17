import { describe, expect, test } from "bun:test";
import {
  createEditorState,
  createEmptyEditorDocument,
  komyakuSchema
} from "../src/index.js";

describe("editor core foundation", () => {
  test("creates a language-independent structured document", () => {
    const document = createEmptyEditorDocument({ language: "ar", direction: "rtl" });
    expect(document.attrs.language).toBe("ar");
    expect(document.attrs.direction).toBe("rtl");
    expect(createEditorState({ document }).doc.eq(document)).toBe(true);
  });

  test("stores LaTeX and Mermaid authored source in canonical nodes", () => {
    const math = komyakuSchema.node("math_block", { source: "x^2 + y^2" });
    const mermaid = komyakuSchema.node("mermaid_block", {
      source: "graph TD; A-->B;"
    });
    const document = komyakuSchema.node("doc", null, [math, mermaid]);

    expect(document.child(0).attrs.source).toBe("x^2 + y^2");
    expect(document.child(1).attrs.source).toBe("graph TD; A-->B;");
  });
});
