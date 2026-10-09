import { invoke } from '@tauri-apps/api/core';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUuid = value => typeof value === 'string' && uuid.test(value);
const keysAre = (value, names) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name));
export function parseStoryWorkspacePage(value, after = null) {
  if (after !== null && !isUuid(after)) throw new Error('invalid_story_workspace_cursor');
  if (!keysAre(value, ['items', 'nextCursor']) || !Array.isArray(value.items) || value.items.length > 100
    || !(value.nextCursor === null || isUuid(value.nextCursor))) throw new Error('invalid_story_workspace_page');
  let previous = after ?? '';
  const items = value.items.map(item => {
    if (!keysAre(item, ['workspaceId', 'documentId', 'revision']) || !isUuid(item.workspaceId)
      || !isUuid(item.documentId) || !Number.isSafeInteger(item.revision) || item.revision < 1
      || item.workspaceId <= previous) throw new Error('invalid_story_workspace_page');
    previous = item.workspaceId;
    return Object.freeze({ ...item });
  });
  if (value.nextCursor !== null && (items.length !== 100 || value.nextCursor !== previous)) {
    throw new Error('invalid_story_workspace_page');
  }
  return Object.freeze({ items: Object.freeze(items), nextCursor: value.nextCursor });
}
export async function listStoryWorkspaces(after = null, {
  invokeImpl = invoke, native = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
} = {}) {
  if (after !== null && !isUuid(after)) throw new Error('invalid_story_workspace_cursor');
  if (!native) throw new Error('story_workspace_native_required');
  return parseStoryWorkspacePage(await invokeImpl('list_story_workspaces', { after }), after);
}
