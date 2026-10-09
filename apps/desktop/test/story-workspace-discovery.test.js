import { test, expect } from 'bun:test';
import { listStoryWorkspaces, parseStoryWorkspacePage } from '../src/services/story-workspace-discovery.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const item = n => ({ workspaceId:id(n), documentId:id(200), revision:1 });
test('discovery uses only native bounded metadata IPC and validates ordered continuation', async () => {
  let request;
  const result = await listStoryWorkspaces(id(1), {native:true, invokeImpl:async (command,args) => {
    request={command,args}; return {items:[item(2)],nextCursor:null};
  }});
  expect(request).toEqual({command:'list_story_workspaces',args:{after:id(1)}});
  expect(result.items).toEqual([item(2)]);
  expect(Object.isFrozen(result.items[0])).toBe(true);
  const items=Array.from({length:100},(_,n)=>item(n+1));
  expect(parseStoryWorkspacePage({items,nextCursor:id(100)}).nextCursor).toBe(id(100));
});
test('discovery refuses malformed, duplicate, unordered, oversized and unsolicited content', () => {
  for (const page of [
    {items:[item(2),item(1)],nextCursor:null}, {items:[item(1),item(1)],nextCursor:null},
    {items:[{...item(1),snapshotJson:'private'}],nextCursor:null},
    {items:[{...item(1),revision:0}],nextCursor:null},
    {items:[item(1)],nextCursor:id(1)},
    {items:Array.from({length:101},(_,n)=>item(n+1)),nextCursor:null},
    {items:[],nextCursor:null,extra:true},
  ]) expect(()=>parseStoryWorkspacePage(page)).toThrow('invalid_story_workspace_page');
  expect(()=>parseStoryWorkspacePage({items:[item(1)],nextCursor:null},id(1))).toThrow();
});
test('invalid cursor and browser runtime never invoke native discovery', async () => {
  let calls=0;const invokeImpl=async()=>{calls++;};
  await expect(listStoryWorkspaces('bad',{native:true,invokeImpl})).rejects.toThrow('invalid_story_workspace_cursor');
  await expect(listStoryWorkspaces(null,{native:false,invokeImpl})).rejects.toThrow('story_workspace_native_required');
  expect(calls).toBe(0);
});
