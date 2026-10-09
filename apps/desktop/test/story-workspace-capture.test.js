import {test,expect} from 'bun:test';
import {captureStoryWorkspaceVersion,prepareStoryCapture} from '../src/services/story-workspace-capture.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request=()=>({workspaceId:id(1),operationId:id(2),expectedRevision:3,versionId:id(4),branchId:id(5),branchName:'本文 / Main / 正文',expectedBranchId:id(5),expectedHeadId:id(6),kind:'named',label:null});
const receipt=r=>({workspaceId:r.workspaceId,versionId:r.versionId,branchId:r.branchId,revision:r.expectedRevision+1,replayed:false});
test('owned capture sends stable guards only and accepts exact retry receipts',async()=>{
 const input=prepareStoryCapture(request());let calls=[];
 const invokeImpl=async(command,args)=>{calls.push({command,args});return {...receipt(input),replayed:calls.length>1};};
 await captureStoryWorkspaceVersion(input,{native:true,invokeImpl});
 expect((await captureStoryWorkspaceVersion(input,{native:true,invokeImpl})).replayed).toBe(true);
 expect(calls[0]).toEqual(calls[1]);expect(calls[0].command).toBe('capture_story_workspace_version');
 expect(Object.isFrozen(input)).toBe(true);
});
test('spoofed author/content, absent guards and unsupported kinds never reach IPC',async()=>{
 let calls=0;const invokeImpl=async()=>{calls++;};
 for(const input of [{...request(),authorId:id(9)},{...request(),snapshotJson:'text'},
 {...request(),expectedRevision:0},{...request(),kind:'merge'},{...request(),branchId:id(8)},
 {...request(),label:'😀'.repeat(501)},{...request(),expectedHeadId:null}]) {
  await expect(captureStoryWorkspaceVersion(input,{native:true,invokeImpl})).rejects.toThrow('invalid_story_capture_request');
 }
 await expect(captureStoryWorkspaceVersion(request(),{native:false,invokeImpl})).rejects.toThrow('story_workspace_native_required');
 expect(calls).toBe(0);
});
test('alternative is explicit and unexpected or uncertain native responses are rejected',async()=>{
 const input={...request(),kind:'alternative',branchId:id(8)};
 for(const result of [{...receipt(input),versionId:id(99)},{...receipt(input),revision:3},{...receipt(input),authorId:id(99)}]) {
  await expect(captureStoryWorkspaceVersion(input,{native:true,invokeImpl:async()=>result})).rejects.toThrow('invalid_story_capture_result');
 }
 await expect(captureStoryWorkspaceVersion(input,{native:true,invokeImpl:async()=>{throw new Error('lost-response');}})).rejects.toThrow('lost-response');
 expect(prepareStoryCapture(input).branchId).toBe(id(8));
});
