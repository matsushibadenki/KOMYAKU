import { describe, expect, test } from "bun:test";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import { createKomyakuArchive, KOMYAKU_ARCHIVE_MEDIA_TYPE, verifyKomyakuArchive } from "../src/index.js";

function fixture() {
  const document = createEmptyDocument();
  const assetId = crypto.randomUUID();
  document.content.push(createCanonicalNode("file", {
    assetId, mediaType: "text/markdown", fileName: "研究.md", title: "研究", description: null
  }));
  return { document, assets: [{ id: assetId, mediaType: "text/markdown", bytes: new TextEncoder().encode("# 稿脈\n") }] };
}

describe("open .komyaku Archive v1", () => {
  test("round-trips a Canonical document and immutable Asset through deterministic ZIP storage", async () => {
    const input = fixture();
    const archive = await createKomyakuArchive({ ...input, createdAt: "2026-08-31T00:00:00.000Z" });
    const verified = await verifyKomyakuArchive(archive);
    expect(verified.document).toEqual(input.document);
    expect(verified.manifest.formatVersion).toBe(1);
    expect(verified.manifest.assets[0]).toMatchObject({ id: input.assets[0].id, mediaType: "text/markdown" });
    expect(new TextDecoder().decode(archive.slice(30 + "mimetype".length, 30 + "mimetype".length + KOMYAKU_ARCHIVE_MEDIA_TYPE.length))).toBe(KOMYAKU_ARCHIVE_MEDIA_TYPE);
    expect(verified.archiveDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("rejects byte corruption, missing Assets, and unsafe archive limits", async () => {
    const input = fixture();
    await expect(createKomyakuArchive({ document: input.document, assets: [] })).rejects.toThrow("archive_asset_set_mismatch");
    const archive = await createKomyakuArchive(input);
    const corrupt = archive.slice();
    corrupt[45] ^= 1;
    await expect(verifyKomyakuArchive(corrupt)).rejects.toThrow();
    await expect(verifyKomyakuArchive(archive, { maxArchiveBytes: 10 })).rejects.toThrow("invalid_archive_size");
  });
});
