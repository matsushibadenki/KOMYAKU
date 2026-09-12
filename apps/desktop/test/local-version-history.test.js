import { describe, expect, test } from "bun:test";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import {
  appendLocalVersionHistoryPage,
  compareLocalDocumentVersions,
  createLocalDocumentVersion,
  getOrCreateLocalVersionAuthorId,
  loadLocalHistoryArchiveSource,
  listLocalVersionHistory,
  loadLocalVersionAssets,
  loadLocalVersionSnapshot,
  restoreLocalDocumentVersion,
  saveLocalVersion
} from "../src/services/local-version-history.js";

const input = {
  operationId: "00000000-0000-4000-8000-000000000010",
  branchId: "00000000-0000-4000-8000-000000000011",
  branchName: "本文",
  expectedHeadVersionId: null,
  version: {
    id: "00000000-0000-4000-8000-000000000012",
    documentId: "00000000-0000-4000-8000-000000000013",
    schemaVersion: 1,
    snapshotEncoding: "canonical-json-v1",
    snapshotJson: "{}",
    snapshotHash: "a".repeat(64),
    parentIds: [],
    authorId: "00000000-0000-4000-8000-000000000014",
    createdAt: "2026-09-08T00:00:00.000Z",
    reason: "initial",
    restoredFromVersionId: null
  }
};

describe("local Version persistence adapter", () => {
  test("sends one exact native command and validates its receipt", async () => {
    let request;
    const result = await saveLocalVersion(input, { native: true, invokeImpl: async (name, payload) => {
      request = { name, payload };
      return {
        operationId: input.operationId,
        documentId: input.version.documentId,
        versionId: input.version.id,
        branchId: input.branchId,
        snapshotHash: input.version.snapshotHash,
        replayed: false
      };
    }});
    expect(request).toEqual({ name: "save_local_version_atomic", payload: { input } });
    expect(result.replayed).toBe(false);
  });

  test("rejects a mismatched native receipt", async () => {
    await expect(saveLocalVersion(input, { native: true, invokeImpl: async () => ({
      operationId: input.operationId,
      documentId: input.version.documentId,
      versionId: input.version.id,
      branchId: input.branchId,
      snapshotHash: "b".repeat(64),
      replayed: false
    }) })).rejects.toThrow(/invalid_local_version_result/);
  });

  test("lists bounded metadata and verifies an immutable snapshot on read", async () => {
    const document = createEmptyDocument();
    const versionId = crypto.randomUUID();
    const parentVersionId = crypto.randomUUID();
    const authorId = crypto.randomUUID();
    const snapshotJson = JSON.stringify(document);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshotJson)));
    const snapshotHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    let historyRequest;
    const history = await listLocalVersionHistory(document.id, { native: true, invokeImpl: async (name, payload) => {
      historyRequest = { name, payload };
      return {
        documentId: document.id, currentBranchId: null, currentVersionId: null, branches: [],
        versions: [{ id: versionId, snapshotHash, authorId, reason: "initial",
          restoredFromVersionId: null, label: null, parentIds: [parentVersionId],
          createdAt: "2026-09-08T00:00:00.000Z" }],
        nextCursor: null
      };
    } });
    expect(historyRequest).toEqual({ name: "list_local_version_history", payload: {
      documentId: document.id, cursorCreatedAt: null, cursorVersionId: null
    }});
    expect(history.versions[0].id).toBe(versionId);
    expect(history.versions[0].parentIds).toEqual([parentVersionId]);
    expect(Object.isFrozen(history.versions[0].parentIds)).toBe(true);
    const loaded = await loadLocalVersionSnapshot({ documentId: document.id, versionId }, {
      native: true, invokeImpl: async () => ({ documentId: document.id, versionId,
        schemaVersion: document.schemaVersion, snapshotEncoding: "canonical-json-v1",
        snapshotJson, snapshotHash })
    });
    expect(loaded.document).toEqual(document);
  });

  test("requests and appends an older page without duplicate Versions", async () => {
    const documentId = crypto.randomUUID();
    const currentVersionId = "00000000-0000-4000-8000-000000000030";
    const olderVersionId = "00000000-0000-4000-8000-000000000020";
    const oldestVersionId = "00000000-0000-4000-8000-000000000010";
    const authorId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const version = (id, createdAt) => ({ id, createdAt, authorId, snapshotHash: "a".repeat(64),
      reason: "named", restoredFromVersionId: null, label: null });
    const branch = { id: branchId, name: "Main", headVersionId: currentVersionId,
      createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:02:00.000Z" };
    const first = await listLocalVersionHistory(documentId, { native: true, invokeImpl: async () => ({
      documentId, currentBranchId: branchId, currentVersionId, branches: [branch],
      versions: [version(currentVersionId, "2026-09-12T00:02:00.000Z"),
        version(olderVersionId, "2026-09-12T00:01:00.000Z")],
      nextCursor: { createdAt: "2026-09-12T00:01:00.000Z", versionId: olderVersionId }
    }) });
    let request;
    const page = await listLocalVersionHistory(documentId, { native: true, cursor: first.nextCursor,
      invokeImpl: async (name, payload) => {
        request = { name, payload };
        return { documentId, currentBranchId: branchId, currentVersionId, branches: [branch],
          versions: [version(oldestVersionId, "2026-09-12T00:00:00.000Z")], nextCursor: null };
      } });
    expect(request.payload).toEqual({ documentId,
      cursorCreatedAt: "2026-09-12T00:01:00.000Z", cursorVersionId: olderVersionId });
    const combined = appendLocalVersionHistoryPage(first, page);
    expect(combined.versions.map(({ id }) => id)).toEqual([
      currentVersionId, olderVersionId, oldestVersionId
    ]);
    expect(combined.nextCursor).toBeNull();
    expect(() => appendLocalVersionHistoryPage(first, first)).toThrow(/invalid_local_version_history_page/);
  });

  test("creates initial, named, and alternative Version requests from the current head", async () => {
    const document = createEmptyDocument();
    const authorId = crypto.randomUUID();
    const ids = Array.from({ length: 9 }, () => crypto.randomUUID());
    const requests = [];
    const options = { native: true, invokeImpl: async (_name, payload) => {
      requests.push(payload.input);
      return { operationId: payload.input.operationId, documentId: document.id,
        versionId: payload.input.version.id, branchId: payload.input.branchId,
        snapshotHash: payload.input.version.snapshotHash, replayed: false };
    }};
    const initial = await createLocalDocumentVersion({
      document, history: { documentId: document.id, currentBranchId: null,
        currentVersionId: null, branches: [], versions: [] }, authorId, kind: "initial",
      branchName: "本文", now: () => new Date("2026-09-08T00:00:00.000Z"), idFactory: () => ids.shift()
    }, options);
    const history = { documentId: document.id, currentBranchId: initial.branchId,
      currentVersionId: initial.version.id, branches: [{ id: initial.branchId, name: "本文" }],
      versions: [initial.version] };
    await createLocalDocumentVersion({ document, history, authorId, kind: "named", label: "第一稿",
      now: () => new Date("2026-09-08T00:01:00.000Z"), idFactory: () => ids.shift() }, options);
    await createLocalDocumentVersion({ document, history, authorId, kind: "alternative",
      branchName: "短い導入", now: () => new Date("2026-09-08T00:02:00.000Z"),
      idFactory: () => ids.shift() }, options);
    expect(requests.map(({ version }) => version.reason)).toEqual(["initial", "named", "named"]);
    expect(requests[1]).toMatchObject({ branchId: initial.branchId,
      expectedHeadVersionId: initial.version.id, version: { label: "第一稿" } });
    expect(requests[2].branchId).not.toBe(initial.branchId);
    expect(requests[2].branchName).toBe("短い導入");
  });

  test("keeps one local author identity", () => {
    const values = new Map();
    const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const authorId = crypto.randomUUID();
    expect(getOrCreateLocalVersionAuthorId({ storage, idFactory: () => authorId })).toBe(authorId);
    expect(getOrCreateLocalVersionAuthorId({ storage, idFactory: () => { throw new Error("unused"); } })).toBe(authorId);
  });

  test("restores a verified snapshot as a new child and advances the draft revision", async () => {
    const document = createEmptyDocument();
    const targetVersionId = crypto.randomUUID();
    const currentVersionId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const authorId = crypto.randomUUID();
    const snapshotJson = JSON.stringify(document);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshotJson)));
    const snapshotHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const history = { documentId: document.id, currentBranchId: branchId,
      currentVersionId, branches: [{ id: branchId, name: "本文" }],
      versions: [{ id: currentVersionId }] };
    let saved;
    const invokeImpl = async (command, payload) => {
      if (command === "load_local_version_snapshot") return { documentId: document.id, versionId: targetVersionId,
        schemaVersion: document.schemaVersion, snapshotEncoding: "canonical-json-v1", snapshotJson, snapshotHash };
      saved = payload.input;
      return { operationId: saved.operationId, documentId: document.id, versionId: saved.version.id,
        branchId, snapshotHash: saved.version.snapshotHash, replayed: false };
    };
    const restored = await restoreLocalDocumentVersion({ documentId: document.id, targetVersionId,
      history, authorId, localRevision: 7, now: () => new Date("2026-09-08T00:03:00.000Z") },
    { native: true, invokeImpl });
    expect(saved).toMatchObject({ branchId, expectedHeadVersionId: currentVersionId,
      restoreDraftRevision: 8, version: { parentIds: [currentVersionId], reason: "restore",
        restoredFromVersionId: targetVersionId } });
    expect(restored.localRevision).toBe(8);
    expect(restored.document).toEqual(document);
  });

  test("loads only hash-verified Asset bytes for one Version", async () => {
    const documentId = crypto.randomUUID();
    const versionId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    const bytes = new TextEncoder().encode("historical source");
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    const contentHash = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const assets = await loadLocalVersionAssets({ documentId, versionId }, {
      native: true, invokeImpl: async () => [{ id: assetId, mediaType: "text/plain",
        contentHash, bytes: [...bytes] }]
    });
    expect(assets).toHaveLength(1);
    expect(assets[0]).toMatchObject({ id: assetId, mediaType: "text/plain" });
    expect(new TextDecoder().decode(assets[0].bytes)).toBe("historical source");
  });

  test("loads every history page, exact Snapshot, and historical-only Asset for a v2 export", async () => {
    const base = createEmptyDocument();
    const current = structuredClone(base);
    const baseVersionId = crypto.randomUUID();
    const currentVersionId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const authorId = crypto.randomUUID();
    const assetId = crypto.randomUUID();
    base.content.push(createCanonicalNode("file", {
      assetId, mediaType: "text/plain", fileName: "old.txt", title: "Old", description: null
    }));
    const snapshots = new Map();
    for (const [versionId, document] of [[baseVersionId, base], [currentVersionId, current]]) {
      const snapshotJson = JSON.stringify(document);
      const bytes = new TextEncoder().encode(snapshotJson);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
      snapshots.set(versionId, { snapshotJson,
        snapshotHash: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") });
    }
    const branch = { id: branchId, name: "本文", headVersionId: currentVersionId,
      createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:01:00.000Z" };
    const metadata = (id, parentIds, createdAt, reason) => ({ id, parentIds, createdAt, reason,
      authorId, snapshotHash: snapshots.get(id).snapshotHash, restoredFromVersionId: null, label: null });
    const olderCursor = { createdAt: "2026-09-12T00:01:00.000Z", versionId: currentVersionId };
    const assetBytes = new TextEncoder().encode("historical only\n");
    const assetDigest = new Uint8Array(await crypto.subtle.digest("SHA-256", assetBytes));
    const contentHash = [...assetDigest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    const requests = [];
    const invokeImpl = async (command, payload) => {
      requests.push({ command, payload });
      if (command === "list_local_version_history") {
        return payload.cursorVersionId ? {
          documentId: base.id, currentBranchId: branchId, currentVersionId, branches: [branch],
          versions: [metadata(baseVersionId, [], "2026-09-12T00:00:00.000Z", "initial")], nextCursor: null
        } : {
          documentId: base.id, currentBranchId: branchId, currentVersionId, branches: [branch],
          versions: [metadata(currentVersionId, [baseVersionId], olderCursor.createdAt, "named")],
          nextCursor: olderCursor
        };
      }
      if (command === "load_local_version_snapshot") {
        const stored = snapshots.get(payload.versionId);
        return { documentId: base.id, versionId: payload.versionId, schemaVersion: 1,
          snapshotEncoding: "canonical-json-v1", ...stored };
      }
      if (command === "load_local_version_assets" && payload.versionId === baseVersionId) {
        return [{ id: assetId, mediaType: "text/plain", contentHash, bytes: [...assetBytes] }];
      }
      if (command === "load_local_version_assets") return [];
      throw new Error("unexpected command");
    };
    const source = await loadLocalHistoryArchiveSource(base.id, { native: true, invokeImpl, concurrency: 2 });
    expect(source.versions.map(({ id }) => id)).toEqual([currentVersionId, baseVersionId]);
    expect(source.versions[1].snapshotJson).toBe(snapshots.get(baseVersionId).snapshotJson);
    expect(source.assets).toHaveLength(1);
    expect(source.assets[0].id).toBe(assetId);
    expect(requests.filter(({ command }) => command === "list_local_version_history")).toHaveLength(3);
  });

  test("compares two independently verified Version snapshots", async () => {
    const before = createEmptyDocument();
    const after = structuredClone(before);
    after.content[0].content = [{ type: "text", text: "変更", marks: [], metadata: {}, extensions: {} }];
    const beforeVersionId = crypto.randomUUID();
    const afterVersionId = crypto.randomUUID();
    const snapshots = new Map([[beforeVersionId, before], [afterVersionId, after]]);
    const invokeImpl = async (_command, { versionId }) => {
      const document = snapshots.get(versionId);
      const snapshotJson = JSON.stringify(document);
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshotJson)));
      return { documentId: before.id, versionId, schemaVersion: document.schemaVersion,
        snapshotEncoding: "canonical-json-v1", snapshotJson,
        snapshotHash: [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
    };
    const result = await compareLocalDocumentVersions({ documentId: before.id,
      beforeVersionId, afterVersionId, locale: "ja" }, { native: true, invokeImpl });
    expect(result.summary).toEqual({ added: 0, removed: 0, moved: 0, changed: 1 });
    expect(result.changes[0].textDiff.added).toBe("変更");
  });
});
