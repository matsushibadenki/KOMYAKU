import { getIdentifier } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { encodeStoryWorkspaceSnapshot } from '@komyaku/story-graph';
import fixture from '../../../../packages/story-graph/test/fixtures/query-workspace.json';
import { listStoryWorkspaces } from './story-workspace-discovery.js';
import { initializeStoryWorkspace, prepareStoryInitialization, readStoryWorkspace } from './story-workspace-runtime.js';
import { openStoryAgentSession } from './story-agent-session.js';

export const STORY_AGENT_QA_IDENTIFIER = 'app.komyaku.desktop.story-agent-qa';
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const check = (ok, code) => { if (!ok) throw new Error(code); };
export function storyAgentQaFixture() {
  const workspace = structuredClone(fixture);
  const node = structuredClone(workspace.graph.nodes[2]);
  node.effects = [
    { entityId: id(10), key: 'knowledge', operation: 'add', value: id(11) },
    { entityId: id(10), key: 'location', operation: 'set', value: 'Kyoto' }
  ];
  return { workspace, node, operations: [{ type: 'put', collection: 'nodes', value: node }] };
}
async function verifyQueries(session, repaired) {
  const queries = [
    { type: 'state-at', pathId: id(41), nodeId: id(23), entityId: id(10), key: 'knowledge', phase: 'before' },
    { type: 'consistency', pathIds: [id(40), id(41)] },
    { type: 'compare-paths', oursPathId: id(40), theirsPathId: id(41) },
    { type: 'impact', nodeIds: [id(21)] }
  ];
  // Production limit is two concurrent native evaluations; run this diagnostic
  // sequentially so a QA harness cannot obscure its own semantic assertions.
  const answers = [];
  for (const query of queries) answers.push(await session.agent.query(query));
  check(JSON.stringify(answers[0].result.value) === JSON.stringify(repaired ? [id(11)] : []), 'story_qa_knowledge_mismatch');
  check(answers[1].result.consistent === repaired && answers[2].result.mergeable === repaired, 'story_qa_consistency_mismatch');
  check(answers[3].result.impacts.length === 3, 'story_qa_impact_mismatch');
  check(answers.every(a => a.snapshotHash === answers[0].snapshotHash), 'story_qa_provenance_mismatch');
  return answers;
}

export async function preparePackagedStoryAgentQa({ identifier = getIdentifier, invokeImpl = invoke } = {}) {
  // An URL parameter alone must never initialize the ordinary product profile.
  if (await identifier() !== STORY_AGENT_QA_IDENTIFIER) throw new Error('story_qa_profile_required');
  const options = { native: true, invokeImpl };
  const { workspace, node, operations } = storyAgentQaFixture();
  const page = await listStoryWorkspaces(null, options);
  check(page.nextCursor === null && page.items.length <= 1
    && page.items.every(w => w.workspaceId === workspace.graph.id), 'story_qa_unexpected_profile');
  const existed = page.items.length === 1;
  if (!existed) await initializeStoryWorkspace(prepareStoryInitialization({
    operationId: id(300), versionId: id(200), branchId: id(400), branchName: 'Main', label: null,
    document: workspace.document, graph: workspace.graph
  }), options);
  const current = await readStoryWorkspace(workspace.graph.id, options);
  const session = await openStoryAgentSession(workspace.graph.id, options);
  if (existed) {
    // No resetting or finishing a partial prior fixture to manufacture success.
    check(current.revision === 2 && current.currentVersionId === id(201), 'story_qa_partial_profile');
    const answers = await verifyQueries(session, true);
    const expected = { ...workspace, graph: { ...workspace.graph,
      nodes: workspace.graph.nodes.map(n => n.id === node.id ? node : n) } };
    check(encodeStoryWorkspaceSnapshot(current.workspace).json === encodeStoryWorkspaceSnapshot(expected).json,
      'story_qa_recovery_mismatch');
    const historical = await invokeImpl('query_story_workspace_version', { input: {
      workspaceId: workspace.graph.id, versionId: id(200), query: answers[0].query
    } });
    check(historical.result.value.length === 0 && historical.snapshotHash !== answers[0].snapshotHash, 'story_qa_history_mismatch');
    return { status: 'recovered-all-ipc-verified', hash: answers[0].snapshotHash };
  }
  const before = await verifyQueries(session, false);
  const staleSession = await openStoryAgentSession(workspace.graph.id, options);
  let loseResponse = true;
  const ownedIds = [id(500), id(301), id(201)];
  const host = await openStoryAgentSession(workspace.graph.id, { native: true, idFactory: () => ownedIds.shift(),
    invokeImpl: async (name, args) => {
      const result = await invokeImpl(name, args);
      if (name === 'adopt_story_workspace_proposal' && loseResponse) {
        loseResponse = false;
        // Discard only after the real native transaction has returned.
        throw new Error('story_qa_response_lost');
      }
      return result;
    }
  });
  const proposed = await host.agent.propose(operations);
  const review = host.review(proposed.proposalId);
  check((await readStoryWorkspace(workspace.graph.id, options)).revision === 1, 'story_qa_preview_wrote_state');
  return { status: 'ready-for-review', review, before,
    async adopt() {
      const result = await host.adopt(review, { label: 'Agent review / 提案確認 / 提案确认' });
      check(result.replayed, 'story_qa_expected_replay');
      const next = await openStoryAgentSession(workspace.graph.id, options);
      const answers = await verifyQueries(next, true);
      const old = await verifyQueries(session, false);
      check(old[0].snapshotHash === before[0].snapshotHash, 'story_qa_old_version_changed');
      let stale = false;
      try { await staleSession.agent.propose(operations); }
      catch (error) { stale = String(error?.message ?? error).includes('stale_story_workspace_revision'); }
      check(stale, 'story_qa_stale_proposal_accepted');
      return { status: 'saved-replay-all-ipc-verified', hash: answers[0].snapshotHash };
    }
  };
}

export async function mountPackagedStoryAgentQa(root) {
  const panel = document.createElement('main');
  panel.style.cssText = 'padding:20px;max-width:960px;margin:auto;overflow-wrap:anywhere';
  const title = document.createElement('h1'); title.textContent = 'KOMYAKU · Story Agent IPC';
  const status = document.createElement('pre'); status.setAttribute('role', 'status'); status.style.whiteSpace = 'pre-wrap';
  const report = value => { status.textContent = value; status.dataset.storyAgentQa = value; };
  panel.append(title, status); root.replaceChildren(panel); report('starting');
  try {
    const flow = await preparePackagedStoryAgentQa();
    report(flow.status);
    if (!flow.review) { status.textContent += `\nSHA-256 ${flow.hash}`; return; }
    const summary = document.createElement('p');
    summary.textContent = 'Bルートで鍵の所在を知り、京都へ移動 / Route B: learn the key location and move to Kyoto / B路线：获知钥匙位置并前往京都';
    const details = document.createElement('details');
    const caption = document.createElement('summary'); caption.textContent = '変更候補 / Candidate / 候选';
    const source = document.createElement('pre'); source.style.cssText = 'white-space:pre-wrap;font-size:12px';
    source.textContent = JSON.stringify(JSON.parse(flow.review.snapshotJson), null, 2);
    details.append(caption, source);
    const button = document.createElement('button'); button.textContent = '採用 / Adopt / 采纳';
    button.style.cssText = 'padding:10px 18px;cursor:pointer';
    button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await flow.adopt(); report(result.status);
        status.textContent += `\nSHA-256 ${result.hash}`;
      } catch (error) {
        if (error?.message === 'story_qa_response_lost') {
          report('saved-response-lost-retry-required'); button.textContent = '再試行 / Retry / 重试'; button.disabled = false;
        } else report(`failed: ${error?.message ?? error}`);
      }
    };
    panel.append(summary, details, button);
  } catch (error) { report(`failed: ${error?.message ?? error}`); }
}
