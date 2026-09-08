import { describe, expect, test } from "bun:test";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import { compareCanonicalDocuments, diffGraphemeText } from "../src/index.js";

function paragraph(text) {
  return createCanonicalNode("paragraph", { attrs: { lang: "ja", dir: "auto" },
    content: [{ type: "text", text, marks: [], metadata: {}, extensions: {} }] });
}

describe("stable Node document diff", () => {
  test("keeps extended emoji intact in text replacements", () => {
    expect(diffGraphemeText("A👨‍👩‍👧B", "A👨‍👩‍👦B", "ja"))
      .toEqual({ prefix: "A", removed: "👨‍👩‍👧", added: "👨‍👩‍👦", suffix: "B" });
  });

  test("reports moves separately from authored text changes", () => {
    const before = createEmptyDocument();
    const first = paragraph("第一稿");
    const second = paragraph("第二段落");
    before.content = [first, second];
    const after = structuredClone(before);
    after.content = [after.content[1], after.content[0]];
    after.content[1].content[0].text = "第一稿を更新";
    const compared = compareCanonicalDocuments(before, after);
    expect(compared.summary).toEqual({ added: 0, removed: 0, moved: 2, changed: 1 });
    expect(compared.changes.find(({ nodeId }) => nodeId === first.id)).toMatchObject({
      change: "moved-and-changed", kinds: ["text"],
      textDiff: { prefix: "第一稿", removed: "", added: "を更新", suffix: "" }
    });
  });

  test("reports source, Asset identity, metadata, additions, and removals", () => {
    const before = createEmptyDocument();
    const diagram = createCanonicalNode("diagram", { sourceType: "mermaid", source: "A-->B",
      altText: "flow", caption: [] });
    const image = createCanonicalNode("image", { assetId: crypto.randomUUID(), mediaType: "image/png",
      altText: "draft", caption: [], width: 1, height: 1 });
    before.content = [diagram, image];
    const after = structuredClone(before);
    after.content[0].source = "A-->C";
    after.content[0].metadata.reviewed = true;
    after.content[1].assetId = crypto.randomUUID();
    after.content.push(paragraph("追加"));
    const compared = compareCanonicalDocuments(before, after);
    expect(compared.summary).toEqual({ added: 1, removed: 0, moved: 0, changed: 2 });
    expect(compared.changes.find(({ nodeId }) => nodeId === diagram.id).kinds)
      .toEqual(["metadata", "source"]);
    expect(compared.changes.find(({ nodeId }) => nodeId === image.id).kinds).toEqual(["asset"]);
  });
});
