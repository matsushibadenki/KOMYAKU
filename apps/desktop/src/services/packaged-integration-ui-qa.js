import { getIdentifier } from "@tauri-apps/api/app";
import { invoke } from "@tauri-apps/api/core";
import { createKomyakuHistoryArchive } from "@komyaku/archive-core";
import { loadLocalDraft } from "./local-database.js";
import { materializeLocalHistoryImport } from "./local-komyaku-import.js";
import { createHistoryArchiveQaFixture } from "./packaged-history-archive-qa.js";

export const INTEGRATION_UI_QA_IDENTIFIER = "app.komyaku.desktop.integration-ui-qa";

// Only the dedicated profile can seed data or enable fault injection.
export async function prepareIntegrationUiQa({ identifier = getIdentifier,
  loadDraft = loadLocalDraft, importArchive = materializeLocalHistoryImport,
  makeArchive = createKomyakuHistoryArchive, invokeNative = invoke } = {}) {
  if (await identifier() !== INTEGRATION_UI_QA_IDENTIFIER) throw new Error("integration_ui_qa_profile_required");
  const fixture = createHistoryArchiveQaFixture();
  let draft = await loadDraft(fixture.documentId);
  if (!draft) {
    await importArchive(await makeArchive(fixture));
    draft = await loadDraft(fixture.documentId);
  }
  if (!draft?.content || draft.content.id !== fixture.documentId) throw new Error("integration_ui_qa_draft_required");
  let dropped = false;
  return { initialDocument: draft.content, integrationSaveOptions: { native: true,
    invokeImpl: async (command, args) => {
      const result = await invokeNative(command, args);
      if (command === "save_local_version_atomic" && !dropped) {
        dropped = true;
        throw new Error("integration_ui_qa_response_lost_after_commit");
      }
      return result;
    }
  } };
}
