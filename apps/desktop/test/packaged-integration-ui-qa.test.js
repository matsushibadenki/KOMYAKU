import { test, expect } from "bun:test";
import { prepareIntegrationUiQa, INTEGRATION_UI_QA_IDENTIFIER } from "../src/services/packaged-integration-ui-qa.js";
import { createHistoryArchiveQaFixture } from "../src/services/packaged-history-archive-qa.js";

test('UI QA refuses normal profile before reads or fault injection', async () => {
  let reads = 0;
  await expect(prepareIntegrationUiQa({ identifier: async () => 'app.komyaku.desktop',
    loadDraft: async () => { reads += 1; } })).rejects.toThrow('integration_ui_qa_profile_required');
  expect(reads).toBe(0);
});

test('UI QA reuses existing draft and drops exactly one committed save response', async () => {
  const content = JSON.parse(createHistoryArchiveQaFixture().versions[0].snapshotJson);
  let commits = 0;
  const props = await prepareIntegrationUiQa({ identifier: async () => INTEGRATION_UI_QA_IDENTIFIER,
    loadDraft: async () => ({ content }), importArchive: async () => { throw new Error('unexpected import'); },
    invokeNative: async () => { commits += 1; return { replayed: commits > 1 }; } });
  expect(props.initialDocument).toBe(content);
  await expect(props.integrationSaveOptions.invokeImpl('save_local_version_atomic', {}))
    .rejects.toThrow('integration_ui_qa_response_lost_after_commit');
  expect(commits).toBe(1);
  expect(await props.integrationSaveOptions.invokeImpl('save_local_version_atomic', {})).toEqual({ replayed: true });
});
