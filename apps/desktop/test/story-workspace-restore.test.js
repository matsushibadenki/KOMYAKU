import {test,expect} from 'bun:test';
import {prepareStoryRestore,restoreStoryWorkspaceVersion} from '../src/services/story-workspace-restore.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request=()=>({workspaceId:id(1),operationId:id(2),expectedRevision:3,versionId:id(4),branchId:id(5),branchName:'Main',expectedHeadId:id(6),restoredFromId:id(7),label:'復元 / Restore / 恢复'});
const result=r=>({workspaceId:r.workspaceId,versionId:r.versionId,branchId:r.branchId,revision:r.expectedRevision+1,replayed:false});
test('restore sends only stable identity guards and reuses the exact request',async()=>{
 const input=prepareStoryRestore(request());const calls=[];
 const invokeImpl=async(command,args)=>{calls.push({command,args});return {...result(input),replayed:calls.length>1};};
 await restoreStoryWorkspaceVersion(input,{native:true,invokeImpl});
 expect((await restoreStoryWorkspaceVersion(input,{native:true,invokeImpl})).replayed).toBe(true);
 expect(calls[0]).toEqual(calls[1]);expect(calls[0].command).toBe('restore_story_workspace_version');expect(Object.isFrozen(input)).toBe(true);
});
test('source bytes/author spoof and invalid target/revision never reach native restore',async()=>{
 let calls=0;const invokeImpl=async()=>{calls++;};
 for(const value of [{...request(),snapshotJson:'text'},{...request(),authorId:id(9)},{...request(),restoredFromId:'bad'},
 {...request(),expectedRevision:0},{...request(),versionId:id(7)},{...request(),label:'😀'.repeat(501)}]) {
  await expect(restoreStoryWorkspaceVersion(value,{native:true,invokeImpl})).rejects.toThrow('invalid_story_restore_request');
 }
 await expect(restoreStoryWorkspaceVersion(request(),{native:false,invokeImpl})).rejects.toThrow('story_workspace_native_required');expect(calls).toBe(0);
});
test('restore rejects wrong result identity and retains uncertainty on a lost response',async()=>{
 const input=request();
 for(const response of [{...result(input),versionId:id(99)},{...result(input),revision:3},{...result(input),snapshotJson:'unexpected'}]) {
  await expect(restoreStoryWorkspaceVersion(input,{native:true,invokeImpl:async()=>response})).rejects.toThrow('invalid_story_restore_result');
 }
 await expect(restoreStoryWorkspaceVersion(input,{native:true,invokeImpl:async()=>{throw new Error('lost-response');}})).rejects.toThrow('lost-response');
});
