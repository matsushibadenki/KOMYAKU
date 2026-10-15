import { invoke } from '@tauri-apps/api/core';
import { parseStoryWorkspace, encodeStoryWorkspaceSnapshot } from '@komyaku/story-graph';
import { listStoryWorkspaces } from './story-workspace-discovery.js';
import { initializeStoryWorkspace, prepareStoryInitialization, readStoryWorkspace, prepareStoryEdit } from './story-workspace-runtime.js';
import { storySnapshotHash } from './story-agent-session.js';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
const optionsOf = options => {
  const { native = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__), invokeImpl = invoke } = options;
  if (!native) throw new Error('story_workspace_native_required');
  return { native, invokeImpl };
};
export async function listStoryAgentReviews(documentId, options = {}) {
  if (!uuid.test(documentId)) throw new Error('invalid_story_review_document');
  const { invokeImpl } = optionsOf(options);
  const rows = await invokeImpl('list_story_agent_reviews', { documentId });
  if (!Array.isArray(rows) || rows.length > 32 || rows.some(r => !exact(r, ['reviewId', 'workspaceId', 'status'])
    || !uuid.test(r.reviewId) || !uuid.test(r.workspaceId) || !['review', 'attempting'].includes(r.status))
    || new Set(rows.map(r => r.reviewId)).size !== rows.length) throw new Error('invalid_story_review_list');
  return rows;
}
export async function loadStoryAgentReview(reviewId, options = {}) {
  if (!uuid.test(reviewId)) throw new Error('invalid_story_review_id');
  const { invokeImpl } = optionsOf(options);
  return validateReview(await invokeImpl('load_story_agent_review', { reviewId }), reviewId);
}
async function validateReview(value, reviewId) {
  if (!exact(value, ['reviewId', 'workspaceId', 'status', 'proposal', 'candidateHash', 'snapshotJson', 'baseSnapshotJson'])
    || value.reviewId !== reviewId || !uuid.test(value.workspaceId)
    || !['review', 'attempting', 'adopted', 'rejected'].includes(value.status)
    || !exact(value.proposal, ['commandJson', 'baseVersionId', 'branchId', 'baseSnapshotHash'])
    || !uuid.test(value.proposal.baseVersionId) || !uuid.test(value.proposal.branchId)
    || [value.snapshotJson, value.baseSnapshotJson, value.proposal.commandJson].some(s => typeof s !== 'string' || new TextEncoder().encode(s).length > 24 * 1024 * 1024)
    || await storySnapshotHash(value.snapshotJson) !== value.candidateHash
    || await storySnapshotHash(value.baseSnapshotJson) !== value.proposal.baseSnapshotHash) throw new Error('invalid_story_review');
  const before = parseStoryWorkspace(JSON.parse(value.baseSnapshotJson));
  const after = parseStoryWorkspace(JSON.parse(value.snapshotJson));
  const command = JSON.parse(value.proposal.commandJson);
  prepareStoryEdit(reviewId, command);
  if (before.graph.id !== value.workspaceId || after.graph.id !== value.workspaceId
    || before.document.id !== after.document.id || command.graphId !== value.workspaceId
    || command.documentId !== before.document.id) throw new Error('invalid_story_review');
  return Object.freeze({ ...value, proposal: Object.freeze({ ...value.proposal }), before, after });
}
/** Checkpoint the ordinary editor into Rust's composite history before giving
 * an Agent an immutable scope. Caller must hold its document-mutation gate. */
export async function prepareEditorStoryScope(document, options = {}) {
  const nativeOptions = optionsOf(options);
  const id = () => crypto.randomUUID();
  let after = null, found = [];
  for (let n = 0; n < 100; n++) {
    const page = await listStoryWorkspaces(after, nativeOptions);
    found.push(...page.items.filter(w => w.documentId === document.id));
    after = page.nextCursor;
    if (!after) break;
  }
  if (after || found.length > 1) throw new Error('story_editor_workspace_ambiguous');
  let workspaceId = found[0]?.workspaceId;
  if (!workspaceId) {
    workspaceId = id();
    await initializeStoryWorkspace(prepareStoryInitialization({ operationId: id(), versionId: id(), branchId: id(),
      branchName: 'Main', label: null, document, graph: { schemaId: 'https://komyaku.example/schemas/story-graph/v1',
        schemaVersion: 1, id: workspaceId, documentId: document.id, nodes: [], edges: [], paths: [], entities: [] } }), nativeOptions);
  }
  let current = await readStoryWorkspace(workspaceId, nativeOptions);
  const wanted = encodeStoryWorkspaceSnapshot({ ...current.workspace, document }).json;
  if (encodeStoryWorkspaceSnapshot(current.workspace).json !== wanted) {
    await nativeOptions.invokeImpl('checkpoint_story_agent_document', { input: {
      workspaceId, operationId: id(), versionId: id(), expectedRevision: current.revision,
      expectedHeadId: current.currentVersionId, branchId: current.currentBranchId
    } });
    current = await readStoryWorkspace(workspaceId, nativeOptions);
  }
  if (encodeStoryWorkspaceSnapshot(current.workspace).json !== wanted) throw new Error('story_review_editor_changed');
  return Object.freeze({ workspaceId, documentId: document.id, revision: current.revision,
    versionId: current.currentVersionId, branchId: current.currentBranchId, snapshotHash: await storySnapshotHash(current.snapshotJson) });
}
export async function stageStoryAgentReview(scope, operations, options = {}) {
  const { invokeImpl } = optionsOf(options);
  const reviewId = crypto.randomUUID();
  const { commandJson } = prepareStoryEdit(reviewId, { documentId: scope.documentId, graphId: scope.workspaceId,
    expectedRevision: scope.revision, operations });
  return validateReview(await invokeImpl('stage_story_agent_review', { input: { reviewId, proposal: {
    commandJson, baseVersionId: scope.versionId, branchId: scope.branchId, baseSnapshotHash: scope.snapshotHash
  } } }), reviewId);
}
export async function attemptStoryAgentReview(reviewId, options = {}) {
  if (!uuid.test(reviewId)) throw new Error('invalid_story_review_id');
  const { invokeImpl } = optionsOf(options);
  const result = await invokeImpl('attempt_story_agent_review', { reviewId });
  if (!exact(result, ['workspaceId', 'versionId', 'branchId', 'revision', 'replayed'])
    || [result.workspaceId, result.versionId, result.branchId].some(v => !uuid.test(v))
    || !Number.isSafeInteger(result.revision) || result.revision < 2 || typeof result.replayed !== 'boolean') throw new Error('invalid_story_review_result');
  return result;
}
export async function rejectStoryAgentReview(reviewId, options = {}) {
  if (!uuid.test(reviewId)) throw new Error('invalid_story_review_id');
  const { invokeImpl } = optionsOf(options);
  await invokeImpl('reject_story_agent_review', { reviewId });
}
