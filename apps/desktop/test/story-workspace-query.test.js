import { test, expect } from 'bun:test';
import { queryStoryWorkspaceVersion } from '../src/services/story-workspace-query.js';
import cases from '../../../packages/story-graph/test/fixtures/query-conformance.json';
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const input = () => ({ workspaceId: id(3), versionId: id(200), query: structuredClone(cases[0].query) });
const response = request => ({ ...request, snapshotHash: 'a'.repeat(64), evaluatorVersion: 'story-query/1', graphSchemaVersion: 1, result: cases[0].expected });

test('native query sends only a detached immutable selector and validates its response', async () => {
  const original = input();
  let sent;
  const result = await queryStoryWorkspaceVersion(original, { native: true, invokeImpl: async (command, args) => {
    expect(command).toBe('query_story_workspace_version');
    sent = args.input;
    original.query.pathId = id(999);
    return response(args.input);
  } });
  expect(sent.query.pathId).toBe(id(40));
  expect(result.result.value).toEqual([id(11)]);
  expect(Object.keys(sent).sort()).toEqual(['query', 'versionId', 'workspaceId']);
});

test('query refuses browser fallback and write payloads before invoking native code', async () => {
  let calls = 0;
  const invokeImpl = async () => { calls++; throw new Error('unexpected'); };
  await expect(queryStoryWorkspaceVersion(input(), { native: false, invokeImpl })).rejects.toThrow('story_workspace_native_required');
  await expect(queryStoryWorkspaceVersion({ ...input(), operations: [] }, { native: true, invokeImpl })).rejects.toThrow('invalid_story_query');
  expect(calls).toBe(0);
});

test('query propagates native limits and refuses a result for a different route', async () => {
  await expect(queryStoryWorkspaceVersion(input(), { native: true, invokeImpl: async () => {
    throw new Error('story_query_budget_exceeded');
  } })).rejects.toThrow('story_query_budget_exceeded');
  await expect(queryStoryWorkspaceVersion(input(), { native: true, invokeImpl: async () => {
    const other = input(); other.query.pathId = id(41); return response(other);
  } })).rejects.toThrow('invalid_story_query_result');
});
