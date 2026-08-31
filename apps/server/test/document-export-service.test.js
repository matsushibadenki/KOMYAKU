import { describe, expect, test } from "bun:test";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import { createDocumentExportService } from "../src/services/document-export-service.js";

describe("verified .komyaku export workflow", () => {
  test("writes, rereads, verifies, and records evidence for every exact Asset", async () => {
    const workspaceId = crypto.randomUUID();
    const actorId = crypto.randomUUID();
    const artifactId = crypto.randomUUID();
    const document = createEmptyDocument();
    const assetId = crypto.randomUUID();
    const assetBytes = new TextEncoder().encode("# Archive\n");
    const hashBytes = new Uint8Array(await crypto.subtle.digest("SHA-256", assetBytes));
    const contentHash = [...hashBytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    document.content.push(createCanonicalNode("file", {
      assetId, mediaType: "text/markdown", fileName: "archive.md", title: null, description: null
    }));
    let archiveBytes;
    let recorded;
    const service = createDocumentExportService({
      now: () => new Date("2026-08-31T00:00:00.000Z"), idFactory: () => artifactId,
      repository: {
        async findExportAssets() {
          return [{ id: assetId, mediaType: "text/markdown", byteSize: assetBytes.byteLength, contentHash, storageKey: "asset-key" }];
        },
        async recordVerifiedExport(input) { recorded = input; },
        async listVerifiedExports() { return []; }, async findAuthorizedExport() { return null; },
        async invalidateVerifiedExport() { return null; }
      },
      objectStore: {
        async get(key) { return { Body: key === "asset-key" ? assetBytes : archiveBytes }; },
        async putImmutable({ body }) { archiveBytes = body; }, async createReadUrl() { return "https://invalid"; }
      }
    });
    const result = await service.createVerifiedExport({ workspaceId, documentId: document.id, actorId, document });
    expect(result).toMatchObject({ artifactId, documentId: document.id, assetCount: 1, formatVersion: 1 });
    expect(recorded.manifest.assets[0]).toMatchObject({ id: assetId, sha256: contentHash });
    expect(recorded.archiveDigest).toBe(result.archiveDigest);
  });

  test("fails before storage when an Asset is unavailable", async () => {
    const document = createEmptyDocument();
    document.content.push(createCanonicalNode("file", {
      assetId: crypto.randomUUID(), mediaType: "text/plain", fileName: "missing.txt", title: null, description: null
    }));
    let writes = 0;
    const service = createDocumentExportService({
      repository: {
        async findExportAssets() { return []; }, async recordVerifiedExport() {},
        async listVerifiedExports() { return []; }, async findAuthorizedExport() { return null; },
        async invalidateVerifiedExport() { return null; }
      },
      objectStore: { async get() {}, async putImmutable() { writes += 1; }, async createReadUrl() {} }
    });
    await expect(service.createVerifiedExport({
      workspaceId: crypto.randomUUID(), documentId: document.id, actorId: crypto.randomUUID(), document
    })).rejects.toThrow("unavailable Asset");
    expect(writes).toBe(0);
  });

  test("lists, signs, and invalidates only repository-authorized artifacts", async () => {
    const artifactId = crypto.randomUUID();
    const common = {
      workspaceId: crypto.randomUUID(), documentId: crypto.randomUUID(), actorId: crypto.randomUUID()
    };
    let invalidated;
    const service = createDocumentExportService({
      repository: {
        async findExportAssets() { return []; }, async recordVerifiedExport() {},
        async listVerifiedExports() { return [{ artifactId }]; },
        async findAuthorizedExport() { return { artifactId, archiveDigest: "a".repeat(64), byteSize: 100, storageKey: "export-key" }; },
        async invalidateVerifiedExport(input) { invalidated = input; return { artifactId, invalidatedEvidenceCount: 2 }; }
      },
      objectStore: {
        async get() {}, async putImmutable() {},
        async createReadUrl(key, expiresIn, response) {
          expect({ key, expiresIn, response }).toMatchObject({ key: "export-key", expiresIn: 60, response: { contentType: "application/vnd.komyaku.archive+zip" } });
          return "https://download.invalid";
        }
      },
      now: () => new Date("2026-08-31T00:00:00.000Z")
    });
    expect(await service.listVerifiedExports(common)).toEqual([{ artifactId }]);
    expect(await service.createDownload({ ...common, artifactId })).toMatchObject({ artifactId, url: "https://download.invalid", expiresIn: 60 });
    expect(await service.invalidateVerifiedExport({ ...common, artifactId })).toMatchObject({ invalidatedEvidenceCount: 2 });
    expect(invalidated).toMatchObject({ ...common, artifactId, invalidatedAt: "2026-08-31T00:00:00.000Z" });
  });
});
