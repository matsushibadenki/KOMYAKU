import { describe, expect, test } from "bun:test";
import { DOCUMENT_SCHEMA_ID, parseCanonicalDocument } from "@komyaku/document-schema";
import * as Y from "yjs";
import {
  COLLABORATION_ORIGINS,
  CollaborativeStateError,
  applyCollaborativeUpdate,
  createCanonicalCheckpoint,
  createCollaborativeWorkingState,
  createEmptyCollaborativeWorkingState,
  createLocalUndoManager,
  connectCollaborativeWorkingStates,
  encodeCollaborativeStateVector,
  encodeCollaborativeUpdate,
  getCollaborativeFragment
} from "../src/index.js";

function id(number) {
  return `00000000-0000-4000-8000-${number.toString(16).padStart(12, "0")}`;
}

function common(number) {
  return { id: id(number), schemaVersion: 1, metadata: {}, extensions: {}, renderArtifacts: [] };
}

function fixture() {
  return parseCanonicalDocument({
    schemaId: DOCUMENT_SCHEMA_ID,
    schemaVersion: 1,
    id: id(1),
    type: "document",
    attrs: { language: "ja", direction: "auto", writingMode: "horizontal-tb" },
    metadata: { title: "共同研究 / Collaborative research / 协同研究" },
    extensions: { "org.komyaku.fixture": { retained: true } },
    content: [
      { ...common(2), type: "paragraph", attrs: { lang: "ja", dir: "auto" }, content: [
        { type: "text", text: "基礎", marks: [], metadata: {}, extensions: {} },
        { ...common(3), type: "math_inline", sourceType: "latex", source: "E=mc^2" }
      ] },
      { ...common(4), type: "diagram", sourceType: "mermaid", source: "graph TD; A-->B;", altText: "流れ", caption: [] },
      { ...common(5), type: "image", assetId: id(50), mediaType: "image/png", altText: "図", caption: [], width: 640, height: 480 }
    ]
  });
}

function cloneFrom(document) {
  const clone = new Y.Doc();
  applyCollaborativeUpdate(clone, encodeCollaborativeUpdate(document));
  return clone;
}

function firstText(document) {
  const paragraph = getCollaborativeFragment(document).get(0);
  return paragraph.get(0);
}

describe("Yjs collaborative working-state boundary", () => {
  test("preserves stable IDs, authored sources, metadata, and Asset references in a Canonical checkpoint", async () => {
    const canonical = fixture();
    const checkpoint = await createCanonicalCheckpoint(createCollaborativeWorkingState(canonical));

    expect(checkpoint.document).toEqual(canonical);
    expect(checkpoint.document.content[0].id).toBe(id(2));
    expect(checkpoint.document.content[0].content[1].source).toBe("E=mc^2");
    expect(checkpoint.document.content[1].source).toBe("graph TD; A-->B;");
    expect(checkpoint.document.content[2].assetId).toBe(id(50));
    expect(checkpoint.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test("converges after concurrent multilingual edits and produces the same deterministic checkpoint", async () => {
    const source = createCollaborativeWorkingState(fixture());
    const left = cloneFrom(source);
    const right = cloneFrom(source);

    left.transact(() => firstText(left).insert(0, "日本語 "), COLLABORATION_ORIGINS.localUser);
    right.transact(() => firstText(right).insert(2, " / English / 简体中文"), COLLABORATION_ORIGINS.localUser);

    const leftUpdate = encodeCollaborativeUpdate(left);
    const rightUpdate = encodeCollaborativeUpdate(right);
    applyCollaborativeUpdate(left, rightUpdate);
    applyCollaborativeUpdate(right, leftUpdate);

    const leftCheckpoint = await createCanonicalCheckpoint(left);
    const rightCheckpoint = await createCanonicalCheckpoint(right);
    expect(leftCheckpoint.hash).toBe(rightCheckpoint.hash);
    expect(leftCheckpoint.json).toBe(rightCheckpoint.json);
    expect(leftCheckpoint.json).toContain("日本語");
    expect(leftCheckpoint.json).toContain("English");
    expect(leftCheckpoint.json).toContain("简体中文");
  });

  test("uses a state vector to send only changes made while a client was offline", async () => {
    const online = createCollaborativeWorkingState(fixture());
    const offline = cloneFrom(online);
    const offlineVector = encodeCollaborativeStateVector(offline);

    online.transact(() => firstText(online).insert(2, "を更新"), COLLABORATION_ORIGINS.localUser);
    const missingUpdate = encodeCollaborativeUpdate(online, { stateVector: offlineVector });
    applyCollaborativeUpdate(offline, missingUpdate);

    expect((await createCanonicalCheckpoint(offline)).hash)
      .toBe((await createCanonicalCheckpoint(online)).hash);
  });

  test("reconnects independent editor replicas after offline changes", async () => {
    const left = createCollaborativeWorkingState(fixture());
    const right = createEmptyCollaborativeWorkingState();
    let disconnect = connectCollaborativeWorkingStates(left, right);
    expect((await createCanonicalCheckpoint(left)).hash)
      .toBe((await createCanonicalCheckpoint(right)).hash);

    disconnect();
    left.transact(() => firstText(left).insert(0, "offline "), COLLABORATION_ORIGINS.localUser);
    expect((await createCanonicalCheckpoint(left)).hash)
      .not.toBe((await createCanonicalCheckpoint(right)).hash);

    disconnect = connectCollaborativeWorkingStates(left, right);
    expect((await createCanonicalCheckpoint(left)).hash)
      .toBe((await createCanonicalCheckpoint(right)).hash);
    disconnect();
  });

  test("applies duplicate updates idempotently", async () => {
    const source = createCollaborativeWorkingState(fixture());
    const replica = new Y.Doc();
    const update = encodeCollaborativeUpdate(source);

    applyCollaborativeUpdate(replica, update);
    const once = await createCanonicalCheckpoint(replica);
    applyCollaborativeUpdate(replica, update);
    const twice = await createCanonicalCheckpoint(replica);

    expect(twice.hash).toBe(once.hash);
  });

  test("selective undo tracks local user changes without removing remote changes", () => {
    const document = createCollaborativeWorkingState(fixture());
    const undoManager = createLocalUndoManager(document, { captureTimeout: 0 });

    document.transact(() => firstText(document).insert(0, "LOCAL "), COLLABORATION_ORIGINS.localUser);
    document.transact(() => firstText(document).insert(firstText(document).length, " REMOTE"), COLLABORATION_ORIGINS.remote);
    undoManager.undo();

    expect(firstText(document).toString()).not.toContain("LOCAL");
    expect(firstText(document).toString()).toContain("REMOTE");
    undoManager.destroy();
  });

  test("rejects oversized updates before applying them", () => {
    const document = new Y.Doc();
    expect(() => applyCollaborativeUpdate(document, new Uint8Array(9), { maxBytes: 8 }))
      .toThrow(CollaborativeStateError);
    expect(getCollaborativeFragment(document).length).toBe(0);
  });

  test("wraps malformed binary input in a stable boundary error", () => {
    expect(() => applyCollaborativeUpdate(new Y.Doc(), new Uint8Array([255])))
      .toThrow(expect.objectContaining({ code: "malformed_collaborative_update" }));
  });

  test("rejects a checkpoint when a collaborative node loses its stable ID", async () => {
    const document = createCollaborativeWorkingState(fixture());
    getCollaborativeFragment(document).get(0).setAttribute("nodeId", null);

    await expect(createCanonicalCheckpoint(document)).rejects.toMatchObject({
      code: "missing_stable_node_id"
    });
  });
});
