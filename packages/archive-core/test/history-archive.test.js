import { describe, expect, test } from "bun:test";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import {
  createKomyakuHistoryArchive,
  HISTORY_ARCHIVE_COLLISION_POLICY,
  KOMYAKU_HISTORY_ARCHIVE_FORMAT_VERSION,
  verifyKomyakuArchive,
  verifyKomyakuHistoryArchive
} from "../src/index.js";

const ids = Object.freeze({
  author: "00000000-0000-4000-8000-000000000001",
  document: "00000000-0000-4000-8000-000000000002",
  base: "00000000-0000-4000-8000-000000000003",
  main: "00000000-0000-4000-8000-000000000004",
  alternative: "00000000-0000-4000-8000-000000000005",
  mainBranch: "00000000-0000-4000-8000-000000000006",
  alternativeBranch: "00000000-0000-4000-8000-000000000007",
  historicalAsset: "00000000-0000-4000-8000-000000000008",
  alternativeAsset: "00000000-0000-4000-8000-000000000009",
  historicalNode: "00000000-0000-4000-8000-000000000010",
  alternativeNode: "00000000-0000-4000-8000-000000000011"
});

function snapshot(document) {
  return `${JSON.stringify(document, null, 2)}\n`;
}

function fixture() {
  const empty = createEmptyDocument({ id: ids.document });
  const base = structuredClone(empty);
  base.content.push(createCanonicalNode("file", {
    assetId: ids.historicalAsset,
    mediaType: "text/markdown",
    fileName: "初稿.md",
    title: "初稿資料",
    description: null
  }, { id: ids.historicalNode }));
  const main = structuredClone(empty);
  main.metadata.title = "本文案";
  const alternative = structuredClone(base);
  alternative.metadata.title = "別案";
  alternative.content.push(createCanonicalNode("file", {
    assetId: ids.alternativeAsset,
    mediaType: "text/plain",
    fileName: "notes.txt",
    title: "Notes",
    description: null
  }, { id: ids.alternativeNode }));
  const version = (id, document, parentIds, createdAt, reason, label) => ({
    id,
    schemaVersion: document.schemaVersion,
    snapshotEncoding: "canonical-json-v1",
    snapshotJson: snapshot(document),
    parentIds,
    authorId: ids.author,
    reason,
    restoredFromVersionId: null,
    label,
    createdAt
  });
  return {
    documentId: ids.document,
    currentBranchId: ids.mainBranch,
    currentVersionId: ids.main,
    versions: [
      version(ids.main, main, [ids.base], "2026-09-12T00:01:00.000Z", "named", "本文案"),
      version(ids.base, base, [], "2026-09-12T00:00:00.000Z", "initial", "初稿"),
      version(ids.alternative, alternative, [ids.base], "2026-09-12T00:02:00.000Z", "named", "別案")
    ],
    branches: [
      { id: ids.alternativeBranch, name: "別案", headVersionId: ids.alternative,
        createdAt: "2026-09-12T00:02:00.000Z", updatedAt: "2026-09-12T00:02:00.000Z" },
      { id: ids.mainBranch, name: "本文", headVersionId: ids.main,
        createdAt: "2026-09-12T00:00:00.000Z", updatedAt: "2026-09-12T00:01:00.000Z" }
    ],
    assets: [
      { id: ids.alternativeAsset, mediaType: "text/plain", bytes: new TextEncoder().encode("alternative\n") },
      { id: ids.historicalAsset, mediaType: "text/markdown", bytes: new TextEncoder().encode("# 初稿だけの資料\n") }
    ],
    createdAt: "2026-09-12T01:00:00.000Z"
  };
}

describe("open .komyaku History Archive v2", () => {
  test("round-trips every exact Version byte, parent, Branch, and historical-only Asset deterministically", async () => {
    const input = fixture();
    const first = await createKomyakuHistoryArchive(input);
    const second = await createKomyakuHistoryArchive({
      ...input,
      versions: [...input.versions].reverse(),
      branches: [...input.branches].reverse(),
      assets: [...input.assets].reverse()
    });
    expect(second).toEqual(first);
    const verified = await verifyKomyakuHistoryArchive(first);
    expect(verified.manifest.formatVersion).toBe(KOMYAKU_HISTORY_ARCHIVE_FORMAT_VERSION);
    expect(verified.documentId).toBe(ids.document);
    expect(verified.currentBranchId).toBe(ids.mainBranch);
    expect(verified.currentVersionId).toBe(ids.main);
    expect(verified.versions).toHaveLength(3);
    expect(verified.branches.map(({ name }) => name).sort()).toEqual(["別案", "本文"]);
    const versions = new Map(verified.versions.map((version) => [version.id, version]));
    expect(versions.get(ids.main).parentIds).toEqual([ids.base]);
    expect(versions.get(ids.alternative).parentIds).toEqual([ids.base]);
    expect(versions.get(ids.base).snapshotJson).toBe(input.versions.find(({ id }) => id === ids.base).snapshotJson);
    expect(versions.get(ids.main).assetIds).toEqual([]);
    expect(verified.assets.map(({ id }) => id).sort()).toEqual([
      ids.historicalAsset,
      ids.alternativeAsset
    ]);
    expect(verified.archiveDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(HISTORY_ARCHIVE_COLLISION_POLICY.document).toBe("reject-unless-identical-archive-replay");
  });

  test("keeps the v1 reader available without treating v2 as a v1 Snapshot Archive", async () => {
    const archive = await createKomyakuHistoryArchive(fixture());
    await expect(verifyKomyakuArchive(archive)).rejects.toThrow();
    await expect(verifyKomyakuHistoryArchive(archive)).resolves.toMatchObject({ kind: "history" });
  });

  test("stores identical Asset content once while preserving both logical Asset identities", async () => {
    const input = fixture();
    input.assets[1].bytes = input.assets[0].bytes.slice();
    const archive = await createKomyakuHistoryArchive(input);
    const verified = await verifyKomyakuHistoryArchive(archive);
    expect(verified.assets).toHaveLength(2);
    expect(verified.manifest.assets[0].path).toBe(verified.manifest.assets[1].path);
    expect(verified.assets[0].bytes).toEqual(verified.assets[1].bytes);
  });

  test("rejects missing closure, invalid parent graphs, unreachable Versions, and corrupt bytes", async () => {
    const input = fixture();
    await expect(createKomyakuHistoryArchive({ ...input, assets: input.assets.slice(0, 1) }))
      .rejects.toThrow("history_archive_asset_set_mismatch");

    const missingParent = structuredClone(input);
    missingParent.assets = input.assets;
    missingParent.versions[0].parentIds = ["00000000-0000-4000-8000-000000000099"];
    await expect(createKomyakuHistoryArchive(missingParent)).rejects.toThrow("history_invalid_parent");

    const cyclic = structuredClone(input);
    cyclic.assets = input.assets;
    cyclic.versions.find(({ id }) => id === ids.base).reason = "import";
    cyclic.versions.find(({ id }) => id === ids.base).parentIds = [ids.main];
    await expect(createKomyakuHistoryArchive(cyclic)).rejects.toThrow("history_version_cycle");

    const unreachable = structuredClone(input);
    unreachable.assets = input.assets;
    unreachable.versions.push({
      ...unreachable.versions[0],
      id: "00000000-0000-4000-8000-000000000012",
      reason: "import",
      parentIds: [],
      label: "孤立"
    });
    await expect(createKomyakuHistoryArchive(unreachable)).rejects.toThrow("history_unreachable_version");

    const archive = await createKomyakuHistoryArchive(input);
    const corrupt = archive.slice();
    corrupt[45] ^= 1;
    await expect(verifyKomyakuHistoryArchive(corrupt)).rejects.toThrow();
    await expect(verifyKomyakuHistoryArchive(archive, { maxArchiveBytes: 10 }))
      .rejects.toThrow("invalid_archive_size");
  });
});
