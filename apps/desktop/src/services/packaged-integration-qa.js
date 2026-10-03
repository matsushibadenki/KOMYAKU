import { invoke } from "@tauri-apps/api/core";
import { getIdentifier } from "@tauri-apps/api/app";
import { createKomyakuHistoryArchive, verifyKomyakuHistoryArchive } from "@komyaku/archive-core";
import { createDocumentVersion, encodeVersionSnapshot } from "@komyaku/version-engine";
import { loadLocalDraft } from "./local-database.js";
import { createVerifiedLocalHistoryExport } from "./local-document-export.js";
import { materializeLocalHistoryImport } from "./local-komyaku-import.js";
import { createHistoryArchiveQaFixture } from "./packaged-history-archive-qa.js";
import { reviewLocalVersionIntegration, prepareLocalVersionIntegration, reviseLocalVersionIntegration,
  adoptLocalVersionIntegration, loadLocalHistoryArchiveSource } from "./local-version-history.js";

export const INTEGRATION_QA_IDENTIFIER = "app.komyaku.desktop.integration-qa";
export const INTEGRATION_RETRY_QA_IDENTIFIER = "app.komyaku.desktop.integration-retry-qa";
const mergeId = "00000000-0000-4000-8000-00000000b011";
const operationId = "00000000-0000-4000-8000-00000000b012";
const timestamp = "2026-10-03T00:00:00.000Z";
const text = "確認した統合本文 / Reviewed integration / 已确认合并正文";

async function expectedFixture() {
  const original = createHistoryArchiveQaFixture();
  const alternative = original.versions.find(({ id }) => id === original.branches[1].headVersionId);
  const document = JSON.parse(alternative.snapshotJson);
  document.content[0].content = [{ type: "text", text, marks: [], metadata: {}, extensions: {} }];
  const version = await createDocumentVersion({ id: mergeId, document,
    authorId: original.versions[0].authorId, createdAt: timestamp, reason: "merge",
    parentIds: [original.currentVersionId, alternative.id] });
  const merged = { ...original, currentVersionId: mergeId,
    versions: [...original.versions, { ...version, label: "Reviewed integration QA" }],
    branches: original.branches.map((branch) => branch.id === original.currentBranchId
      ? { ...branch, headVersionId: mergeId, updatedAt: timestamp } : branch) };
  return { original, merged, document: JSON.parse(version.snapshotJson) };
}

export async function runPackagedIntegrationQa({
  lostResponse = false, invokeNative = invoke, identifier = getIdentifier, loadDraft = loadLocalDraft, makeArchive = createKomyakuHistoryArchive,
  importArchive = materializeLocalHistoryImport, review = reviewLocalVersionIntegration,
  prepare = prepareLocalVersionIntegration, revise = reviseLocalVersionIntegration,
  adopt = adoptLocalVersionIntegration, collect = loadLocalHistoryArchiveSource,
  exportArchive = createVerifiedLocalHistoryExport, report = () => {}
} = {}) {
  // A query parameter alone cannot write the normal app's profile.
  if (await identifier() !== (lostResponse ? INTEGRATION_RETRY_QA_IDENTIFIER : INTEGRATION_QA_IDENTIFIER)) throw new Error("integration_qa_profile_required");
  const expected = await expectedFixture();
  const documentId = expected.original.documentId;
  const existing = await loadDraft(documentId);
  const phase = existing ? "recovered" : "saved";
  if (!existing) {
    report("importing-isolated-fixture");
    const imported = await importArchive(await makeArchive(expected.original));
    if (!imported.materialized || imported.replayed || imported.document.id !== documentId) {
      throw new Error("integration_qa_import_mismatch");
    }
    const draft = await loadDraft(documentId);
    if (draft?.localRevision !== 1) throw new Error("integration_qa_initial_draft_mismatch");
    report("reviewing-and-editing");
    const reviewed = await review({ documentId, alternativeBranchId: expected.original.branches[1].id, locale: "ja" });
    const temporaryIds = ["00000000-0000-4000-8000-00000000b013", "00000000-0000-4000-8000-00000000b014"];
    const candidate = await prepare({ review: reviewed, choice: "theirs", document: draft.content,
      authorId: expected.original.versions[0].authorId, locale: "ja", now: () => new Date(timestamp),
      idFactory: () => temporaryIds.shift(), label: "Reviewed integration QA" });
    if (candidate.assetIds.length !== 1 || candidate.editableParagraphs.length !== 1) {
      throw new Error("integration_qa_candidate_mismatch");
    }
    const finalIds = [mergeId, operationId];
    const edited = await revise({ candidate, edits: [{ nodeId: candidate.editableParagraphs[0].nodeId, text }],
      now: () => new Date(timestamp), idFactory: () => finalIds.shift() });
    report("saving-two-parent-version");
    const request = { candidate: edited, document: draft.content, localRevision: draft.localRevision };
    let first;
    if (lostResponse) {
      let dropped = false;
      try {
        await adopt(request, { native: true, invokeImpl: async (command, args) => {
          const result = await invokeNative(command, args);
          if (command === "save_local_version_atomic" && !dropped) {
            dropped = true;
            throw new Error("integration_qa_response_lost_after_commit");
          }
          return result;
        } });
        throw new Error("integration_qa_response_not_lost");
      } catch (error) {
        if (!dropped || error.message !== "integration_qa_response_lost_after_commit") throw error;
      }
      const committed = await loadDraft(documentId);
      if (committed?.localRevision !== 2
        || encodeVersionSnapshot(committed.content).json !== encodeVersionSnapshot(expected.document).json) {
        throw new Error("integration_qa_missing_commit_before_retry");
      }
      report("response-lost-retrying-identical-save");
    } else first = await adopt(request);
    const replay = await adopt(request);
    if ((!lostResponse && (first.receipt.replayed || first.receipt.versionId !== mergeId || first.localRevision !== 2))
      || !replay.receipt.replayed || replay.localRevision !== 2) {
      throw new Error("integration_qa_replay_mismatch");
    }
    if (replay.receipt.versionId !== mergeId) throw new Error("integration_qa_replay_mismatch");

  }
  // Existing partial fixtures fail closed. Recovery performs no import/adoption.
  report("verifying-draft-history-and-archive");
  const draft = await loadDraft(documentId);
  if (draft?.localRevision !== 2
    || encodeVersionSnapshot(draft.content).json !== encodeVersionSnapshot(expected.document).json) {
    throw new Error("integration_qa_recovered_draft_mismatch");
  }
  const source = await collect(documentId);
  const actual = await exportArchive(source, { createdAt: expected.merged.createdAt });
  const expectedBytes = await makeArchive(expected.merged);
  await verifyKomyakuHistoryArchive(actual.bytes);
  if (actual.bytes.byteLength !== expectedBytes.byteLength
    || !actual.bytes.every((byte, index) => byte === expectedBytes[index])) {
    throw new Error("integration_qa_archive_mismatch");
  }
  report(`${phase}-all-bytes-verified`);
  return phase;
}

export async function mountPackagedIntegrationQa(root, { lostResponse = false } = {}) {
  const output = document.createElement("pre");
  output.style.cssText = "padding:24px;white-space:pre-wrap;overflow-wrap:anywhere";
  output.setAttribute("role", "status");
  root.replaceChildren(output);
  const report = (state) => {
    output.dataset.integrationQa = state;
    output.textContent = `KOMYAKU Integration QA\n統合保存と復旧 / Integration and recovery / 合并保存与恢复\n${state}`;
  };
  report("starting");
  try { await runPackagedIntegrationQa({ report, lostResponse }); }
  catch (error) { report(`failed: ${error?.code ?? error?.message ?? "unknown"}`); }
}
