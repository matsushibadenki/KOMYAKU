import { getIdentifier } from "@tauri-apps/api/app";
import { DOCUMENT_SCHEMA_ID, parseCanonicalDocument } from "@komyaku/document-schema";
import { verifyKomyakuArchive } from "@komyaku/archive-core";
import { loadLocalDraft, saveLocalDraft } from "./local-database.js";
import { mutateLocalDocument } from "./local-document-library.js";
import { createVerifiedLocalSnapshotExport } from "./local-document-export.js";

export const HISTORY_QA_IDENTIFIER = "app.komyaku.desktop.history-qa";
const DOCUMENT_ID = "00000000-0000-4000-8000-00000000a001";
const TITLE = "改題 / Renamed / 新标题";
const TEXT = "保存後の追記 / Edited after rename / 改名后的编辑 / e\u0301 / 👩‍👩‍👧‍👦";

function fixture(title, text) {
  return parseCanonicalDocument({
    schemaId: DOCUMENT_SCHEMA_ID, schemaVersion: 1, id: DOCUMENT_ID, type: "document",
    attrs: { language: "ja", direction: "auto", writingMode: "horizontal-tb" },
    metadata: { title }, extensions: {}, content: [{
      id: "00000000-0000-4000-8000-00000000a002", schemaVersion: 1,
      type: "paragraph", attrs: { lang: "ja", dir: "auto" }, metadata: {}, extensions: {},
      renderArtifacts: [], content: [{ type: "text", text, marks: [], metadata: {}, extensions: {} }]
    }]
  });
}

function requireRecord(record, content, revision) {
  if (!record || record.localRevision !== revision
    || JSON.stringify(record.content) !== JSON.stringify(content)) {
    throw new Error("history_qa_snapshot_mismatch");
  }
}

export async function runPackagedHistoryQa({
  identifier = getIdentifier, load = loadLocalDraft, save = saveLocalDraft,
  mutate = mutateLocalDocument, exportSnapshot = createVerifiedLocalSnapshotExport,
  report = () => {}
} = {}) {
  // A query string alone never authorizes this fixture to modify a normal profile.
  if (await identifier() !== HISTORY_QA_IDENTIFIER) throw new Error("history_qa_profile_required");
  const final = fixture(TITLE, TEXT);
  const existing = await load(DOCUMENT_ID);
  if (existing) {
    requireRecord(existing, final, 3);
    report("recovered");
    return "recovered";
  }
  const persist = (content, localRevision) => save({
    documentId: DOCUMENT_ID, schemaVersion: 1, content, contentJson: JSON.stringify(content), localRevision
  });
  const original = fixture("Before rename", "Original / 元の本文 / 原文");
  report("saving-initial");
  await persist(original, 1);
  report("renaming");
  const renamed = await mutate({ documentId: DOCUMENT_ID, title: TITLE });
  if (renamed.localRevision !== 2) throw new Error("history_qa_revision_mismatch");
  requireRecord(await load(DOCUMENT_ID), fixture(TITLE, "Original / 元の本文 / 原文"), 2);
  report("rejecting-stale-save");
  let rejected = false;
  try { await persist(original, 2); }
  catch (error) {
    if (error?.code !== "stale_local_revision") throw error;
    rejected = true;
  }
  if (!rejected) throw new Error("history_qa_stale_save_accepted");
  requireRecord(await load(DOCUMENT_ID), fixture(TITLE, "Original / 元の本文 / 原文"), 2);
  report("saving-edited-document");
  await persist(final, 3);
  const saved = await load(DOCUMENT_ID);
  requireRecord(saved, final, 3);
  report("verifying-export");
  const archive = await exportSnapshot(saved.content);
  const verified = await verifyKomyakuArchive(archive.bytes);
  if (JSON.stringify(verified.document) !== JSON.stringify(final)) throw new Error("history_qa_export_mismatch");
  report("saved-export-verified");
  return "saved-export-verified";
}

export async function mountPackagedHistoryQa(root) {
  const output = document.createElement("pre");
  output.style.cssText = "padding:24px;white-space:pre-wrap;overflow-wrap:anywhere";
  output.setAttribute("role", "status");
  root.replaceChildren(output);
  const report = (state) => {
    output.dataset.historyQa = state;
    output.textContent = `KOMYAKU History QA\n保存検証 / Persistence check / 保存验证\n${state}`;
  };
  report("starting");
  try { await runPackagedHistoryQa({ report }); }
  catch (error) { report(`failed: ${error?.code ?? error?.message ?? "unknown"}`); }
}
