import { getIdentifier } from "@tauri-apps/api/app";
import { createKomyakuHistoryArchive, verifyKomyakuHistoryArchive } from "@komyaku/archive-core";
import { createCanonicalNode, createEmptyDocument } from "@komyaku/document-schema";
import { loadLocalDraft } from "./local-database.js";
import { createVerifiedLocalHistoryExport } from "./local-document-export.js";
import { materializeLocalHistoryImport } from "./local-komyaku-import.js";
import { loadLocalHistoryArchiveSource } from "./local-version-history.js";

export const HISTORY_ARCHIVE_QA_IDENTIFIER = "app.komyaku.desktop.history-archive-qa";
const ids = Object.freeze({
  document: "00000000-0000-4000-8000-00000000b001",
  author: "00000000-0000-4000-8000-00000000b002",
  initial: "00000000-0000-4000-8000-00000000b003",
  current: "00000000-0000-4000-8000-00000000b004",
  alternative: "00000000-0000-4000-8000-00000000b005",
  mainBranch: "00000000-0000-4000-8000-00000000b006",
  alternativeBranch: "00000000-0000-4000-8000-00000000b007",
  asset: "00000000-0000-4000-8000-00000000b008",
  fileNode: "00000000-0000-4000-8000-00000000b009",
  paragraph: "00000000-0000-4000-8000-00000000b010"
});
const createdAt = "2026-09-22T00:04:00.000Z";

function fixture() {
  const initial = createEmptyDocument({ id: ids.document, language: "ja",
    nodeIdFactory: () => ids.paragraph });
  initial.metadata.title = "初稿 / Initial / 初稿";
  initial.content.push(createCanonicalNode("file", {
    assetId: ids.asset, mediaType: "text/markdown", fileName: "origin.md",
    title: "元資料 / Source / 原始资料", description: null
  }, { idFactory: () => ids.fileNode }));
  const current = structuredClone(initial);
  current.metadata.title = "本文 / Main / 正文";
  current.content.pop();
  const alternative = structuredClone(initial);
  alternative.metadata.title = "別案 / Alternative / 备选";
  const version = (id, document, parentIds, reason, timestamp) => ({
    id, schemaVersion: 1, snapshotEncoding: "canonical-json-v1",
    snapshotJson: `${JSON.stringify(document, null, 2)}\n`, parentIds,
    authorId: ids.author, reason, restoredFromVersionId: null,
    label: document.metadata.title, createdAt: timestamp
  });
  return {
    documentId: ids.document,
    currentBranchId: ids.mainBranch,
    currentVersionId: ids.current,
    versions: [
      version(ids.current, current, [ids.initial], "named", "2026-09-22T00:01:00.000Z"),
      version(ids.initial, initial, [], "initial", "2026-09-22T00:00:00.000Z"),
      version(ids.alternative, alternative, [ids.initial], "named", "2026-09-22T00:02:00.000Z")
    ],
    branches: [
      { id: ids.mainBranch, name: "本文 / Main / 正文", headVersionId: ids.current,
        createdAt: "2026-09-22T00:00:00.000Z", updatedAt: "2026-09-22T00:01:00.000Z" },
      { id: ids.alternativeBranch, name: "別案 / Alternative / 备选", headVersionId: ids.alternative,
        createdAt: "2026-09-22T00:02:00.000Z", updatedAt: "2026-09-22T00:02:00.000Z" }
    ],
    assets: [{ id: ids.asset, mediaType: "text/markdown",
      bytes: new TextEncoder().encode("# Historical-only asset / 履歴だけの資料 / 仅历史资料\n") }],
    createdAt
  };
}

export async function runPackagedHistoryArchiveQa({
  identifier = getIdentifier,
  loadDraft = loadLocalDraft,
  importArchive = materializeLocalHistoryImport,
  collect = loadLocalHistoryArchiveSource,
  makeArchive = createKomyakuHistoryArchive,
  exportArchive = createVerifiedLocalHistoryExport,
  report = () => {}
} = {}) {
  // The mode URL cannot authorize a write in any normal product profile.
  if (await identifier() !== HISTORY_ARCHIVE_QA_IDENTIFIER) {
    throw new Error("history_archive_qa_profile_required");
  }
  const expected = fixture();
  const originalBytes = await makeArchive(expected);
  const original = await verifyKomyakuHistoryArchive(originalBytes);
  const existing = await loadDraft(ids.document);
  let phase;
  if (existing) {
    phase = "recovered";
  } else {
    report("importing-v2");
    const imported = await importArchive(originalBytes);
    if (!imported.materialized || imported.replayed || imported.formatVersion !== 2
      || imported.document.id !== ids.document) {
      throw new Error("history_archive_qa_import_mismatch");
    }
    phase = "imported";
  }
  report("comparing-native-history");
  const draft = await loadDraft(ids.document);
  const current = original.versions.find(({ id }) => id === ids.current);
  if (!draft || draft.localRevision !== 1
    || JSON.stringify(draft.content) !== JSON.stringify(current.document)) {
    throw new Error("history_archive_qa_draft_mismatch");
  }
  const collected = await collect(ids.document);
  const exported = await exportArchive(collected, { createdAt });
  if (exported.bytes.byteLength !== originalBytes.byteLength
    || !exported.bytes.every((byte, index) => byte === originalBytes[index])) {
    throw new Error("history_archive_qa_byte_mismatch");
  }
  report(phase === "imported" ? "imported-all-bytes-verified" : "recovered-all-bytes-verified");
  return phase;
}

export async function mountPackagedHistoryArchiveQa(root) {
  const output = document.createElement("pre");
  output.style.cssText = "padding:24px;white-space:pre-wrap;overflow-wrap:anywhere";
  output.setAttribute("role", "status");
  root.replaceChildren(output);
  const report = (state) => {
    output.dataset.historyArchiveQa = state;
    output.textContent = `KOMYAKU History Archive QA\n全履歴の復元 / Full history recovery / 完整历史恢复\n${state}`;
  };
  report("starting");
  try { await runPackagedHistoryArchiveQa({ report }); }
  catch (error) { report(`failed: ${error?.code ?? error?.message ?? "unknown"}`); }
}
