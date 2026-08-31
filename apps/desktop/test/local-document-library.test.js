import { describe, expect, test } from "bun:test";
import { listLocalDocuments, mutateLocalDocument } from "../src/services/local-document-library.js";

const summary = {
  documentId: "00000000-0000-4000-8000-000000000001",
  title: "稿脈", defaultLanguage: "ja", localRevision: 3,
  updatedAt: "2026-09-01T00:00:00.000Z", archivedAt: null, archiveDigest: null
};

describe("Local Document library boundary", () => {
  test("lists only bounded metadata through one native command", async () => {
    let command;
    const result = await listLocalDocuments({ native: true, invokeImpl: async (name) => {
      command = name; return [summary];
    } });
    expect(command).toBe("list_local_documents");
    expect(result).toEqual([summary]);
  });

  test("renames or archives one exact Document through an atomic command", async () => {
    let request;
    const result = await mutateLocalDocument({ documentId: summary.documentId, title: "New" }, {
      native: true, now: () => new Date("2026-09-01T00:00:00.000Z"),
      invokeImpl: async (name, payload) => {
        request = { name, payload };
        return { ...summary, title: "New", localRevision: 4 };
      }
    });
    expect(request.name).toBe("mutate_local_document_atomic");
    expect(request.payload.input).toMatchObject({ documentId: summary.documentId, title: "New" });
    expect(result.title).toBe("New");
  });
});
