import { test, expect } from 'bun:test';
import { applyStoryWorkspaceCommand } from '@komyaku/story-graph';
import { openStoryAgentSession, storySnapshotHash } from '../src/services/story-agent-session.js';
import { preparePackagedStoryAgentQa, storyAgentQaFixture, STORY_AGENT_QA_IDENTIFIER } from '../src/services/packaged-story-agent-qa.js';
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
async function harness({ lose = false } = {}) {
  const { workspace, operations } = storyAgentQaFixture();
  const snapshotJson = JSON.stringify(workspace), snapshotHash = await storySnapshotHash(snapshotJson);
  const calls = [], adopted = [];
  let counter = 500;
  const invokeImpl = async (name, { input }) => {
    calls.push({ name, input: structuredClone(input) });
    if (name === 'read_story_workspace') return { workspaceId: id(3), revision: 1, snapshotJson,
      currentBranchId: id(400), currentVersionId: id(200) };
    if (name === 'query_story_workspace_version') return { ...input, snapshotHash, evaluatorVersion: 'story-query/1', graphSchemaVersion: 1,
      result: { consistent: false, issues: [{ code: 'story_precondition_failed', severity: 'conflict', pathId: id(41), pathIndex: 2,
        nodeId: id(23), conditionIndex: 0, entityId: id(10), key: 'knowledge', operator: 'contains', expected: id(11), actual: [] }] } };
    if (name === 'preview_story_workspace_proposal') {
      const candidate = applyStoryWorkspaceCommand({ workspace, revision: 1 }, JSON.parse(input.commandJson));
      return { workspaceId: id(3), revision: 1, baseVersionId: id(200), branchId: id(400), baseSnapshotHash: snapshotHash,
        candidateHash: await storySnapshotHash(candidate.json), snapshotJson: candidate.json };
    }
    if (name === 'adopt_story_workspace_proposal') {
      adopted.push(structuredClone(input));
      if (lose && adopted.length === 1) throw new Error('lost-response');
      return { workspaceId: id(3), versionId: input.versionId, branchId: id(400), revision: 2, replayed: adopted.length > 1 };
    }
    throw new Error(`unexpected ${name}`);
  };
  const options = { native: true, invokeImpl, idFactory: () => id(counter++) };
  return { host: await openStoryAgentSession(id(3), options), options, operations, calls, adopted };
}

test('Agent capability can query/propose but only host review can adopt', async () => {
  const h = await harness();
  expect(Object.keys(h.host.agent).sort()).toEqual(['propose', 'query', 'scope']);
  const answer = await h.host.agent.query({ type: 'consistency', pathIds: [id(41)] });
  expect(answer.result.consistent).toBe(false);
  const proposal = await h.host.agent.propose(h.operations);
  expect(h.adopted).toHaveLength(0);
  h.operations[0].value.title = 'Caller modified after proposal';
  const review = h.host.review(proposal.proposalId);
  expect(review.snapshotJson).not.toContain('Caller modified');
  await expect(h.host.adopt({ ...review })).rejects.toThrow('story_proposal_review_required');
  const result = await h.host.adopt(review);
  expect(result.revision).toBe(2);
  expect(h.adopted).toHaveLength(1);
  expect(await h.host.adopt(review)).toEqual(result);
  expect(h.adopted).toHaveLength(1);
  await expect(h.host.agent.propose(h.operations)).rejects.toThrow('story_agent_session_requires_refresh');
});

test('uncertain adoption retries the exact request and cannot change label or switch proposals', async () => {
  const h = await harness({ lose: true });
  const a = await h.host.agent.propose(h.operations), b = await h.host.agent.propose(h.operations);
  const review = h.host.review(a.proposalId);
  await expect(h.host.adopt(review, { label: '確認 / Review / 确认' })).rejects.toThrow('lost-response');
  expect(() => h.host.reject(a.proposalId)).toThrow('story_proposal_outcome_unresolved');
  await expect(h.host.adopt(h.host.review(b.proposalId))).rejects.toThrow('story_agent_session_requires_refresh');
  await expect(h.host.adopt(review, { label: 'changed' })).rejects.toThrow('story_proposal_retry_changed');
  expect((await h.host.adopt(review, { label: '確認 / Review / 确认' })).replayed).toBe(true);
  expect(h.adopted[1]).toEqual(h.adopted[0]);
});

test('reject/close revoke review and late proposals; scopes cannot follow another Version', async () => {
  const h = await harness();
  const p = await h.host.agent.propose(h.operations), token = h.host.review(p.proposalId);
  h.host.reject(p.proposalId);
  await expect(h.host.adopt(token)).rejects.toThrow('story_proposal_review_required');
  h.host.close();
  await expect(h.host.agent.query({ type: 'consistency', pathIds: [id(41)] })).rejects.toThrow('story_agent_session_closed');
  const foreign = await openStoryAgentSession(id(3), { ...h.options, invokeImpl: async (name, args) => {
    const result = await h.options.invokeImpl(name, args);
    return name === 'query_story_workspace_version' ? { ...result, snapshotHash: '0'.repeat(64) } : result;
  } });
  await expect(foreign.agent.query({ type: 'consistency', pathIds: [id(41)] })).rejects.toThrow('story_agent_checkpoint_required');
});

test('preview integrity and bounded pending proposals are enforced before approval', async () => {
  const h = await harness();
  for (let n = 0; n < 8; n++) await h.host.agent.propose(h.operations);
  await expect(h.host.agent.propose(h.operations)).rejects.toThrow('story_agent_proposal_limit');
  expect(h.adopted).toHaveLength(0);
  const invalid = await openStoryAgentSession(id(3), { ...h.options, invokeImpl: async (name, args) => {
    const result = await h.options.invokeImpl(name, args);
    return name === 'preview_story_workspace_proposal' ? { ...result, candidateHash: '0'.repeat(64) } : result;
  } });
  await expect(invalid.agent.propose(h.operations)).rejects.toThrow('invalid_story_proposal_preview');
});

test('QA query parameter cannot write an ordinary profile', async () => {
  let calls = 0;
  await expect(preparePackagedStoryAgentQa({ identifier: async () => 'app.komyaku.desktop', invokeImpl: async () => { calls++; } }))
    .rejects.toThrow('story_qa_profile_required');
  expect(calls).toBe(0);
});

test('QA refuses a partial existing profile without resetting or adopting it', async () => {
  const h = await harness();
  await expect(preparePackagedStoryAgentQa({ identifier: async () => STORY_AGENT_QA_IDENTIFIER,
    invokeImpl: async (name, args) => name === 'list_story_workspaces'
      ? { items: [{ workspaceId: id(3), documentId: id(1), revision: 1 }], nextCursor: null }
      : h.options.invokeImpl(name, args)
  })).rejects.toThrow('story_qa_partial_profile');
  expect(h.adopted).toHaveLength(0);
  expect(h.calls.every(c => c.name === 'read_story_workspace')).toBe(true);
});

test('closing during an in-flight preview cannot recreate a proposal', async () => {
  const h = await harness();
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const host = await openStoryAgentSession(id(3), { ...h.options, invokeImpl: async (name, args) => {
    const result = await h.options.invokeImpl(name, args);
    if (name !== 'preview_story_workspace_proposal') return result;
    started();
    return new Promise(resolve => { release = () => resolve(result); });
  } });
  const pending = host.agent.propose(h.operations);
  await began; host.close(); release();
  await expect(pending).rejects.toThrow('story_agent_session_closed');
  expect(h.adopted).toHaveLength(0);
});
