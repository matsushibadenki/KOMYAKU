import { invoke } from '@tauri-apps/api/core';
import { parseStoryWorkspace } from '@komyaku/story-graph';
import { readStoryWorkspace, prepareStoryEdit } from './story-workspace-runtime.js';
import { queryStoryWorkspaceVersion } from './story-workspace-query.js';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const digest = /^[0-9a-f]{64}$/;
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v, k));
export async function storySnapshotHash(text) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Host keeps the session and gives only `agent` to its local Agent adapter.
 * An object capability is not an OS sandbox or remote authentication boundary.
 */
export async function openStoryAgentSession(workspaceId, {
  invokeImpl = invoke,
  native = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__),
  idFactory = () => crypto.randomUUID()
} = {}) {
  const options = { invokeImpl, native };
  const current = await readStoryWorkspace(workspaceId, options);
  if (!current.currentVersionId || !current.currentBranchId) throw new Error('story_agent_checkpoint_required');
  const baseHash = await storySnapshotHash(current.snapshotJson);
  const scope = Object.freeze({ workspaceId, versionId: current.currentVersionId,
    branchId: current.currentBranchId, revision: current.revision, snapshotHash: baseHash });
  const entries = new Map(), reviews = new WeakMap(), inFlight = new Set();
  let closed = false, adopted = false, pendingId = null;
  const ensureOpen = () => { if (closed) throw new Error('story_agent_session_closed'); };
  const nextId = () => {
    const id = idFactory();
    if (typeof id !== 'string' || !uuid.test(id)) throw new Error('invalid_story_agent_id');
    return id;
  };
  const agent = Object.freeze({ scope,
    async query(query) {
      ensureOpen();
      const answer = await queryStoryWorkspaceVersion({ workspaceId, versionId: scope.versionId, query }, options);
      ensureOpen();
      if (answer.snapshotHash !== baseHash) throw new Error('story_agent_checkpoint_required');
      return answer;
    },
    async propose(operations) {
      ensureOpen();
      if (adopted || pendingId) throw new Error('story_agent_session_requires_refresh');
      if (entries.size + inFlight.size >= 8) throw new Error('story_agent_proposal_limit');
      const id = nextId();
      if (entries.has(id) || inFlight.has(id)) throw new Error('story_agent_proposal_collision');
      const { commandJson } = prepareStoryEdit(id, { documentId: current.workspace.document.id,
        graphId: workspaceId, expectedRevision: current.revision, operations });
      const proposal = Object.freeze({ commandJson, baseVersionId: scope.versionId,
        branchId: scope.branchId, baseSnapshotHash: baseHash });
      inFlight.add(id);
      try {
        const preview = await invokeImpl('preview_story_workspace_proposal', { input: proposal });
        ensureOpen();
        if (adopted || pendingId) throw new Error('story_agent_session_requires_refresh');
        if (!exact(preview, ['workspaceId', 'revision', 'baseVersionId', 'branchId', 'baseSnapshotHash', 'candidateHash', 'snapshotJson'])
          || preview.workspaceId !== workspaceId || preview.revision !== scope.revision
          || preview.baseVersionId !== scope.versionId || preview.branchId !== scope.branchId
          || preview.baseSnapshotHash !== baseHash || typeof preview.candidateHash !== 'string' || !digest.test(preview.candidateHash)
          || typeof preview.snapshotJson !== 'string' || new TextEncoder().encode(preview.snapshotJson).length > 24 * 1024 * 1024
          || await storySnapshotHash(preview.snapshotJson) !== preview.candidateHash) throw new Error('invalid_story_proposal_preview');
        const candidate = parseStoryWorkspace(JSON.parse(preview.snapshotJson));
        if (candidate.graph.id !== workspaceId || candidate.document.id !== current.workspace.document.id) throw new Error('invalid_story_proposal_preview');
        ensureOpen();
        if (adopted || pendingId) throw new Error('story_agent_session_requires_refresh');
        // No caller-owned mutable operation/candidate object is retained.
        entries.set(id, { proposal, preview: Object.freeze({ ...preview }), attempted: false, result: null });
        return Object.freeze({ proposalId: id, candidateHash: preview.candidateHash, baseVersionId: scope.versionId });
      } finally { inFlight.delete(id); }
    }
  });
  return Object.freeze({ agent,
    review(proposalId) {
      ensureOpen();
      const entry = entries.get(proposalId);
      if (!entry) throw new Error('missing_story_proposal');
      const token = Object.freeze({ proposalId, beforeSnapshotJson: current.snapshotJson,
        snapshotJson: entry.preview.snapshotJson, candidateHash: entry.preview.candidateHash });
      reviews.set(token, entry);
      return token;
    },
    reject(proposalId) {
      ensureOpen();
      const entry = entries.get(proposalId);
      if (!entry) throw new Error('missing_story_proposal');
      if (entry.attempted) throw new Error('story_proposal_outcome_unresolved');
      entries.delete(proposalId);
    },
    async adopt(token, { label = null } = {}) {
      ensureOpen();
      const entry = reviews.get(token);
      if (!entry || entries.get(token.proposalId) !== entry) throw new Error('story_proposal_review_required');
      if (entry.result) return entry.result;
      if (adopted || pendingId && pendingId !== token.proposalId) throw new Error('story_agent_session_requires_refresh');
      if (!(label === null || typeof label === 'string' && label.length <= 1000)) throw new Error('invalid_story_proposal_label');
      if (!entry.request) entry.request = Object.freeze({ proposal: entry.proposal, operationId: nextId(),
        versionId: nextId(), candidateHash: entry.preview.candidateHash, label });
      else if (entry.request.label !== label) throw new Error('story_proposal_retry_changed');
      entry.attempted = true;
      pendingId = token.proposalId;
      const result = await invokeImpl('adopt_story_workspace_proposal', { input: entry.request });
      if (!exact(result, ['workspaceId', 'versionId', 'branchId', 'revision', 'replayed'])
        || result.workspaceId !== workspaceId || result.versionId !== entry.request.versionId
        || result.branchId !== scope.branchId || result.revision !== scope.revision + 1
        || typeof result.replayed !== 'boolean') throw new Error('invalid_story_proposal_result');
      adopted = true;
      pendingId = null;
      entry.result = Object.freeze({ ...result });
      return entry.result;
    },
    close() { closed = true; entries.clear(); }
  });
}
