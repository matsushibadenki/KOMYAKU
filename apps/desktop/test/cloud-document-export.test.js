import { describe, expect, test } from "bun:test";
import { createEmptyDocument } from "@komyaku/document-schema";
import { createVerifiedCloudDocumentExport } from "../src/services/cloud-document-export.js";

describe("Cloud verified document export", () => {
  test("submits validated Canonical content and accepts only a verified v1 receipt", async () => {
    const document = createEmptyDocument();
    let request;
    const result = await createVerifiedCloudDocumentExport({
      token: "token", workspaceId: crypto.randomUUID(), document,
      apiClient: {
        async createVerifiedDocumentExport(input) {
          request = input;
          return {
            artifactId: crypto.randomUUID(), documentId: document.id,
            archiveDigest: "a".repeat(64), byteSize: 500, assetCount: 0, formatVersion: 1,
            verifiedAt: "2026-08-31T00:00:00.000Z"
          };
        }
      }
    });
    expect(request.documentId).toBe(document.id);
    expect(result.archiveDigest).toBe("a".repeat(64));
  });

  test("rejects an unverified response envelope", async () => {
    const document = createEmptyDocument();
    await expect(createVerifiedCloudDocumentExport({
      token: "token", workspaceId: crypto.randomUUID(), document,
      apiClient: { async createVerifiedDocumentExport() { return { artifactId: "bad" }; } }
    })).rejects.toThrow("invalid_cloud_export_response");
  });
});
