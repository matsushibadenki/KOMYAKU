import { getIdentifier } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { createEmptyDocument } from '@komyaku/document-schema';
import { loadLocalDraft, saveLocalDraft } from './local-database.js';
export const AGENT_EDITOR_QA_IDENTIFIER = 'app.komyaku.desktop.agent-editor-qa';
export function agentEditorQaFixture() {
  const document = createEmptyDocument({ id: '00000000-0000-4000-8000-00000000d001', language: 'ja',
    nodeIdFactory: () => '00000000-0000-4000-8000-00000000d002' });
  document.metadata.title = 'Agent review recovery';
  document.content[0].content = [{ type: 'text', text: '原文 / Original / 原文', marks: [], metadata: {}, extensions: {} }];
  const after = structuredClone(document);
  after.content[0].content[0].text = '確認済みのAgent提案 / Reviewed Agent proposal / 已审核的 Agent 建议';
  return { document, operations: [{ type: 'replace-document', document: after }] };
}
export async function prepareAgentEditorQa({ identifier = getIdentifier, load = loadLocalDraft, save = saveLocalDraft,
  invokeImpl = invoke } = {}) {
  if (await identifier() !== AGENT_EDITOR_QA_IDENTIFIER) throw new Error('agent_editor_qa_profile_required');
  const { document } = agentEditorQaFixture();
  const draft = await load(document.id);
  if (!draft) await save({ documentId: document.id, schemaVersion: 1, content: document, contentJson: JSON.stringify(document), localRevision: 1 });
  let dropped = false;
  return { initialDocument: document, agentOptions: { native: true, invokeImpl: async (name, args) => {
    const result = await invokeImpl(name, args);
    if (name === 'attempt_story_agent_review' && !dropped) { dropped = true; throw new Error('agent_editor_qa_lost_after_commit'); }
    return result;
  } } };
}
