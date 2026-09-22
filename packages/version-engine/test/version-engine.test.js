import { describe, expect, test } from "bun:test";
import { DOCUMENT_SCHEMA_ID } from "@komyaku/document-schema";
import {
  advanceVersionBranch,
  createDocumentVersion,
  createVersionBranch,
  encodeVersionSnapshot,
  findUniqueMergeBase,
  validateVersionGraph
} from "../src/index.js";

const ids = {
  document: "00000000-0000-4000-8000-000000000001",
  node: "00000000-0000-4000-8000-000000000002",
  author: "00000000-0000-4000-8000-000000000003",
  a: "00000000-0000-4000-8000-000000000004",
  b: "00000000-0000-4000-8000-000000000005",
  c: "00000000-0000-4000-8000-000000000006",
  restored: "00000000-0000-4000-8000-000000000007",
  branch: "00000000-0000-4000-8000-000000000008",
  d: "00000000-0000-4000-8000-000000000009",
  e: "00000000-0000-4000-8000-00000000000a",
  x: "00000000-0000-4000-8000-00000000000b"
};

function document(text = "原稿 / Draft / 文稿") {
  return {
    schemaId: DOCUMENT_SCHEMA_ID,
    schemaVersion: 1,
    id: ids.document,
    type: "document",
    attrs: { language: "ja", direction: "auto", writingMode: "horizontal-tb" },
    metadata: { title: "Version fixture" },
    extensions: {},
    content: [{
      id: ids.node, schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [],
      type: "paragraph", attrs: { lang: "ja", dir: "auto" },
      content: [{ type: "text", text, marks: [], metadata: {}, extensions: {} }]
    }]
  };
}

async function version(id, text, parentIds, reason = "named", restoredFromVersionId = null) {
  return createDocumentVersion({
    id, document: document(text), parentIds, authorId: ids.author,
    createdAt: "2026-09-08T00:00:00.000Z", reason, restoredFromVersionId
  });
}

describe("immutable document Version DAG", () => {
  test("creates deterministic snapshots without normalizing authored Unicode", async () => {
    const composed = encodeVersionSnapshot(document("é"));
    const decomposed = encodeVersionSnapshot(document("e\u0301"));
    expect(composed.json).not.toBe(decomposed.json);
    const first = await version(ids.a, "本文", [], "initial");
    const second = await version(ids.a, "本文", [], "initial");
    expect(second.snapshotHash).toBe(first.snapshotHash);
    expect(second.snapshotJson).toBe(first.snapshotJson);
  });

  test("validates alternatives and restore-as-a-new-child", async () => {
    const a = await version(ids.a, "A", [], "initial");
    const b = await version(ids.b, "B", [ids.a]);
    const c = await version(ids.c, "C", [ids.a]);
    const restored = await version(ids.restored, "A", [ids.b], "restore", ids.a);
    const versions = [a, b, c, restored];
    const branch = createVersionBranch({
      id: ids.branch, documentId: ids.document, name: "別案 C", headVersionId: ids.c, versions
    });
    expect(validateVersionGraph({ documentId: ids.document, versions, branches: [branch] }))
      .toEqual({ versionCount: 4, branchCount: 1 });
    expect(restored.parentIds).toEqual([ids.b]);
    expect(restored.restoredFromVersionId).toBe(ids.a);
  });

  test("advances a branch only from the expected head to its child", async () => {
    const a = await version(ids.a, "A", [], "initial");
    const b = await version(ids.b, "B", [ids.a]);
    const versions = [a, b];
    const branch = createVersionBranch({
      id: ids.branch, documentId: ids.document, name: "本文", headVersionId: ids.a, versions
    });
    expect(advanceVersionBranch({
      branch, expectedHeadVersionId: ids.a, nextVersionId: ids.b, versions
    }).headVersionId).toBe(ids.b);
    expect(() => advanceVersionBranch({
      branch, expectedHeadVersionId: ids.c, nextVersionId: ids.b, versions
    })).toThrow(/stale_branch_head/);
  });

  test("rejects missing parents and cycles", async () => {
    const a = await version(ids.a, "A", [], "initial");
    const b = await version(ids.b, "B", [ids.a]);
    expect(() => validateVersionGraph({
      documentId: ids.document,
      versions: [{ ...a, reason: "named", parentIds: [ids.b] }, b]
    })).toThrow(/cyclic_version_graph/);
    expect(() => validateVersionGraph({
      documentId: ids.document,
      versions: [{ ...b, parentIds: [ids.c] }]
    })).toThrow(/missing_version_parent/);
  });

  test("selects the unique maximal shared ancestor without relying on timestamps", async () => {
    const a = await version(ids.a, "A", [], "initial");
    const b = await version(ids.b, "B", [ids.a]);
    const c = await version(ids.c, "C", [ids.a]);
    const d = await version(ids.d, "D", [ids.b]);
    expect(findUniqueMergeBase({ documentId: ids.document, versions: [d, c, b, a],
      oursVersionId: ids.d, theirsVersionId: ids.c })).toBe(ids.a);
    expect(findUniqueMergeBase({ documentId: ids.document, versions: [a, b, c, d],
      oursVersionId: ids.d, theirsVersionId: ids.b })).toBe(ids.b);
  });

  test("stops at criss-cross merge bases and disconnected histories", async () => {
    const a = await version(ids.a, "A", [], "initial");
    const b = await version(ids.b, "B", [ids.a]);
    const c = await version(ids.c, "C", [ids.a]);
    const d = await version(ids.d, "D", [ids.b, ids.c], "merge");
    const e = await version(ids.e, "E", [ids.c, ids.b], "merge");
    const versions = [a, b, c, d, e];
    expect(() => findUniqueMergeBase({ documentId: ids.document, versions,
      oursVersionId: ids.d, theirsVersionId: ids.e })).toThrow(/ambiguous_merge_base/);
    const x = await version(ids.x, "X", [], "initial");
    expect(() => findUniqueMergeBase({ documentId: ids.document, versions: [...versions, x],
      oursVersionId: ids.d, theirsVersionId: ids.x })).toThrow(/missing_merge_base/);
  });

  test("handles the full 5000-Version boundary without recursive traversal", () => {
    const id = (index) => `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
    const versions = Array.from({ length: 5000 }, (_, index) => ({
      id: id(index), documentId: ids.document,
      parentIds: index ? [id(index - 1)] : [], reason: index ? "named" : "initial",
      restoredFromVersionId: null
    }));
    expect(findUniqueMergeBase({ documentId: ids.document, versions,
      oursVersionId: id(4999), theirsVersionId: id(4998) })).toBe(id(4998));
  });
});
