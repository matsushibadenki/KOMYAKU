import { expect, test } from "bun:test";
import { verifyKomyakuHistoryArchive } from "@komyaku/archive-core";
import {
  HISTORY_ARCHIVE_QA_IDENTIFIER, runPackagedHistoryArchiveQa
} from "../src/services/packaged-history-archive-qa.js";

function harness() {
  let draft = null;
  let imports = 0;
  let archive;
  const ports = {
    identifier: async () => HISTORY_ARCHIVE_QA_IDENTIFIER,
    loadDraft: async () => draft,
    makeArchive: async (source) => {
      const { createKomyakuHistoryArchive } = await import("@komyaku/archive-core");
      archive = await createKomyakuHistoryArchive(source);
      return archive;
    },
    importArchive: async (bytes) => {
      imports += 1;
      const verified = await verifyKomyakuHistoryArchive(bytes);
      const current = verified.versions.find(({ id }) => id === verified.currentVersionId);
      draft = { content: current.document, localRevision: 1 };
      return { materialized: true, replayed: false, formatVersion: 2,
        document: current.document };
    },
    collect: async () => {
      const verified = await verifyKomyakuHistoryArchive(archive);
      return {
        documentId: verified.documentId,
        currentBranchId: verified.currentBranchId,
        currentVersionId: verified.currentVersionId,
        versions: verified.versions.map(({ snapshotSha256, snapshotByteSize, path, assetIds, snapshotBytes,
          document, ...version }) => ({ ...version, snapshotHash: snapshotSha256 })),
        branches: verified.branches,
        assets: verified.assets.map(({ byteSize, sha256, path, ...asset }) => asset)
      };
    }
  };
  return { ports, imports: () => imports, setDraft: (value) => { draft = value; } };
}

test("packaged History Archive QA checks its isolated identity before any profile read", async () => {
  const { ports, imports } = harness();
  let reads = 0;
  await expect(runPackagedHistoryArchiveQa({ ...ports,
    identifier: async () => "app.komyaku.desktop",
    loadDraft: async () => { reads += 1; }
  })).rejects.toThrow("history_archive_qa_profile_required");
  expect(reads).toBe(0);
  expect(imports()).toBe(0);
});

test("packaged History Archive QA imports then rechecks all bytes without a second write", async () => {
  const { ports, imports } = harness();
  expect(await runPackagedHistoryArchiveQa(ports)).toBe("imported");
  expect(imports()).toBe(1);
  expect(await runPackagedHistoryArchiveQa(ports)).toBe("recovered");
  expect(imports()).toBe(1);
});

test("packaged History Archive QA fails on a partial existing profile", async () => {
  const { ports, imports, setDraft } = harness();
  setDraft({ content: {}, localRevision: 1 });
  await expect(runPackagedHistoryArchiveQa(ports)).rejects.toThrow("history_archive_qa_draft_mismatch");
  expect(imports()).toBe(0);
});
