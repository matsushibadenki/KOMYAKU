import { invoke } from '@tauri-apps/api/core';
import { parseStoryQueryRequest, parseStoryQueryResult } from '@komyaku/story-graph';

/** A local read capability. This is not an HTTP/Agent authentication endpoint. */
export async function queryStoryWorkspaceVersion(input, {
  invokeImpl = invoke,
  native = typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__)
} = {}) {
  if (!native) throw new Error('story_workspace_native_required');
  const request = parseStoryQueryRequest(input);
  const result = await invokeImpl('query_story_workspace_version', { input: request });
  return parseStoryQueryResult(result, request);
}
