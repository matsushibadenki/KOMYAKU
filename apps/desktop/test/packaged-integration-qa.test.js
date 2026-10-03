import { expect, test } from "bun:test";
import { createKomyakuHistoryArchive, verifyKomyakuHistoryArchive } from "@komyaku/archive-core";
import { createDocumentVersion } from "@komyaku/version-engine";
import { INTEGRATION_QA_IDENTIFIER, INTEGRATION_RETRY_QA_IDENTIFIER, runPackagedIntegrationQa } from "../src/services/packaged-integration-qa.js";
import { createHistoryArchiveQaFixture } from "../src/services/packaged-history-archive-qa.js";

function harness() {
  let draft = null;
  let source = createHistoryArchiveQaFixture();
  let writes = 0;
  let imports = 0;
  const ports = {
    identifier: async () => INTEGRATION_QA_IDENTIFIER,
    loadDraft: async () => draft,
    importArchive: async (bytes) => {
      const archive = await verifyKomyakuHistoryArchive(bytes);
      imports += 1;
      draft = { content: archive.versions.find(v => v.id === archive.currentVersionId).document, localRevision: 1 };
      return { materialized: true, replayed: false, document: draft.content };
    },
    review: async () => ({ documentId: source.documentId }),
    prepare: async () => ({ assetIds: [source.assets[0].id], editableParagraphs: [{ nodeId: 'paragraph' }] }),
    revise: async ({ edits, idFactory, now }) => {
      const document = JSON.parse(source.versions[2].snapshotJson);
      document.content[0].content = [{ type: 'text', text: edits[0].text, marks: [], metadata: {}, extensions: {} }];
      const version = await createDocumentVersion({ id: idFactory(), document,
        authorId: source.versions[0].authorId, createdAt: now().toISOString(), reason: 'merge',
        parentIds: [source.currentVersionId, source.branches[1].headVersionId] });
      return { version: { ...version, label: 'Reviewed integration QA' }, document, operationId: idFactory() };
    },
    adopt: async ({ candidate }) => {
      const replayed = writes > 0;
      if (!replayed) {
        writes += 1;
        draft = { content: candidate.document, localRevision: 2 };
        source = { ...source, versions: [...source.versions, candidate.version],
          currentVersionId: candidate.version.id,
          branches: source.branches.map(branch => branch.id === source.currentBranchId
            ? { ...branch, headVersionId: candidate.version.id, updatedAt: candidate.version.createdAt } : branch) };
      }
      return { receipt: { replayed, versionId: candidate.version.id }, localRevision: 2 };
    },
    collect: async () => source
  };
  return { ports, writes: () => writes, imports: () => imports,
    setDraft: value => { draft = value; } };
}

test('integration QA rejects a normal app identity before any reads or writes', async () => {
  const { ports } = harness();
  let reads = 0;
  await expect(runPackagedIntegrationQa({ ...ports, identifier: async () => 'app.komyaku.desktop',
    loadDraft: async () => { reads += 1; } })).rejects.toThrow('integration_qa_profile_required');
  expect(reads).toBe(0);
});

test('integration QA compares full archive bytes after save and verifies recovery without writes', async () => {
  const { ports, writes, imports } = harness();
  expect(await runPackagedIntegrationQa(ports)).toBe('saved');
  expect(writes()).toBe(1);
  expect(imports()).toBe(1);
  expect(await runPackagedIntegrationQa(ports)).toBe('recovered');
  expect(writes()).toBe(1);
  expect(imports()).toBe(1);
});

test('integration QA does not overwrite a partial profile', async () => {
  const { ports, setDraft, writes, imports } = harness();
  setDraft({ content: {}, localRevision: 1 });
  await expect(runPackagedIntegrationQa(ports)).rejects.toThrow('integration_qa_recovered_draft_mismatch');
  expect(writes()).toBe(0);
  expect(imports()).toBe(0);
});


test('retry QA loses the response only after commit and replays without another version', async () => {
  const { ports, writes, imports } = harness();
  let calls = 0;
  let firstRequest;
  const retryPorts = { ...ports, lostResponse: true,
    identifier: async () => INTEGRATION_RETRY_QA_IDENTIFIER,
    invokeNative: async () => ports.adopt(firstRequest),
    adopt: async (request, options) => {
      calls += 1;
      if (calls === 1) {
        firstRequest = request;
        return options.invokeImpl('save_local_version_atomic', { input: request });
      }
      expect(request).toBe(firstRequest);
      return ports.adopt(request);
    }
  };
  expect(await runPackagedIntegrationQa(retryPorts)).toBe('saved');
  expect(calls).toBe(2);
  expect(writes()).toBe(1);
  expect(await runPackagedIntegrationQa(retryPorts)).toBe('recovered');
  expect(calls).toBe(2);
  expect(imports()).toBe(1);
});

test('lost-response mode refuses the regular integration QA profile', async () => {
  const { ports } = harness();
  await expect(runPackagedIntegrationQa({ ...ports, lostResponse: true })).rejects.toThrow('integration_qa_profile_required');
});
