import {invoke} from '@tauri-apps/api/core';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUuid=v=>typeof v==='string' && uuid.test(v);
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
export function prepareStoryRestore(input) {
 const keys=['workspaceId','operationId','expectedRevision','versionId','branchId','branchName','expectedHeadId','restoredFromId','label'];
 if(!exact(input,keys)||['workspaceId','operationId','versionId','branchId','expectedHeadId','restoredFromId'].some(k=>!isUuid(input[k]))
  || !Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<1||input.expectedRevision>Number.MAX_SAFE_INTEGER-1
  || input.versionId===input.expectedHeadId || input.versionId===input.restoredFromId
  || typeof input.branchName!=='string'||!input.branchName.trim()||input.branchName.length>200
  || !(input.label===null || typeof input.label==='string'&&input.label.length<=1000))throw new Error('invalid_story_restore_request');
 return Object.freeze({...input});
}
export async function restoreStoryWorkspaceVersion(input,{
 invokeImpl=invoke,native=typeof window!=='undefined'&&Boolean(window.__TAURI_INTERNALS__)
}={}) {
 const request=prepareStoryRestore(input);
 if(!native)throw new Error('story_workspace_native_required');
 const result=await invokeImpl('restore_story_workspace_version',{input:request});
 if(!exact(result,['workspaceId','versionId','branchId','revision','replayed'])||result.workspaceId!==request.workspaceId
  || result.versionId!==request.versionId||result.branchId!==request.branchId||result.revision!==request.expectedRevision+1
  || typeof result.replayed!=='boolean')throw new Error('invalid_story_restore_result');
 return Object.freeze({...result});
}
