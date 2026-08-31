import { describe, expect, test } from "bun:test";
import { createEmptyDocument } from "@komyaku/document-schema";
import { createKomyakuArchive } from "@komyaku/archive-core";
import { verifyLocalKomyakuImport } from "../src/services/local-komyaku-import.js";

describe("local .komyaku recovery boundary", () => {
  test("restores only after full public-reader verification", async () => {
    const document = createEmptyDocument();
    const bytes = await createKomyakuArchive({ document, assets: [], createdAt: "2026-08-31T00:00:00.000Z" });
    await expect(verifyLocalKomyakuImport(bytes)).resolves.toMatchObject({
      document, assetCount: 0, formatVersion: 1, byteSize: bytes.byteLength
    });
  });

  test("does not return a document for corrupt input", async () => {
    await expect(verifyLocalKomyakuImport(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });
});
