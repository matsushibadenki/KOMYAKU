import { describe, expect, test } from "bun:test";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import {
  compareCanonicalDocuments, compareThreeWayCanonicalDocuments, diffGraphemeText
} from "../src/index.js";

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

describe("three-way comparison before reviewed integration", () => {
  test("reports divergent text and document metadata without choosing a winner", () => {
    const base = createEmptyDocument();
    base.content = [paragraph("原文")];
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.content[0].content[0].text = "本文";
    theirs.content[0].content[0].text = "正文";
    ours.metadata.title = "My title";
    theirs.metadata.title = "Their title";
    const compared = compareThreeWayCanonicalDocuments(base, ours, theirs);
    expect(compared.conflicts).toContainEqual({ nodeId: base.content[0].id, kind: "text" });
    expect(compared.conflicts).toContainEqual({ nodeId: base.id, kind: "metadata" });
    expect(compared).not.toHaveProperty("mergedDocument");
  });

  test("distinguishes delete/edit from convergent deletion", () => {
    const base = createEmptyDocument();
    base.content = [paragraph("Base"), paragraph("Remain")];
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.content = [ours.content[1]];
    theirs.content[0].content[0].text = "Edited";
    expect(compareThreeWayCanonicalDocuments(base, ours, theirs).conflicts)
      .toContainEqual({ nodeId: base.content[0].id, kind: "delete-edit" });
    theirs.content = [theirs.content[1]];
    expect(compareThreeWayCanonicalDocuments(base, ours, theirs).conflicts).toEqual([]);
  });

  test("detects an edit inside a deleted container", () => {
    const base = createEmptyDocument();
    base.content = [createCanonicalNode("blockquote", { content: [paragraph("Nested")] }),
      paragraph("Remain")];
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.content = [ours.content[1]];
    theirs.content[0].content[0].content[0].text = "Changed inside";
    expect(compareThreeWayCanonicalDocuments(base, ours, theirs).conflicts)
      .toContainEqual({ nodeId: base.content[0].id, kind: "delete-edit" });
  });

  test("reports incompatible moves and same-ID additions", () => {
    const base = createEmptyDocument();
    base.content = [paragraph("A"), paragraph("B"), paragraph("C")];
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.content = [ours.content[1], ours.content[2], ours.content[0]];
    theirs.content = [theirs.content[1], theirs.content[0], theirs.content[2]];
    expect(compareThreeWayCanonicalDocuments(base, ours, theirs).conflicts)
      .toContainEqual({ nodeId: base.content[0].id, kind: "move" });
    const empty = createEmptyDocument();
    const left = structuredClone(empty);
    const right = structuredClone(empty);
    left.content = [paragraph("Ours")];
    right.content = [structuredClone(left.content[0])];
    right.content[0].content[0].text = "Theirs";
    expect(compareThreeWayCanonicalDocuments(empty, left, right).conflicts)
      .toEqual([{ nodeId: left.content[0].id, kind: "add-add" }]);
  });

  test("keeps independent text and metadata changes available for review", () => {
    const base = createEmptyDocument();
    base.content = [paragraph("Base")];
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.content[0].content[0].text = "Edited";
    theirs.content[0].metadata.reviewed = true;
    const compared = compareThreeWayCanonicalDocuments(base, ours, theirs);
    expect(compared.conflicts).toEqual([]);
    expect(compared.ours.changes).toHaveLength(1);
    expect(compared.theirs.changes).toHaveLength(1);
  });

  test("includes image dimensions and code language in conflicts", () => {
    const base = createEmptyDocument();
    base.content = [createCanonicalNode("image", { assetId: crypto.randomUUID(),
      mediaType: "image/png", altText: "figure", caption: [], width: 100, height: 100 }),
    createCanonicalNode("code_block", { language: "js", source: "let x = 1" })];
    const ours = structuredClone(base);
    const theirs = structuredClone(base);
    ours.content[0].width = 120;
    theirs.content[0].width = 140;
    ours.content[1].language = "ts";
    theirs.content[1].language = "python";
    expect(compareThreeWayCanonicalDocuments(base, ours, theirs).conflicts).toEqual([
      { nodeId: base.content[0].id, kind: "asset" },
      { nodeId: base.content[1].id, kind: "source" }
    ].sort((left, right) => left.nodeId.localeCompare(right.nodeId)));
  });
});
