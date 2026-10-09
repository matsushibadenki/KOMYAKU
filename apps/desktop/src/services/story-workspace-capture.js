import { invoke } from '@tauri-apps/api/core';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUuid=value=>typeof value==='string' && uuid.test(value);
const fields=['workspaceId','operationId','expectedRevision','versionId','branchId','branchName','expectedBranchId','expectedHeadId','kind','label'];
function exact(value,keys) {
  return value && typeof value==='object' && !Array.isArray(value)
    && Object.keys(value).length===keys.length && keys.every(key=>Object.hasOwn(value,key));
}
export function prepareStoryCapture(input) {
  if (!exact(input,fields)
    || ['workspaceId','operationId','versionId','branchId','expectedBranchId','expectedHeadId'].some(key=>!isUuid(input[key]))
    || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<1 || input.expectedRevision>Number.MAX_SAFE_INTEGER-1
    || !['named','alternative'].includes(input.kind)
    || (input.kind==='alternative') !== (input.branchId!==input.expectedBranchId)
    || input.versionId===input.expectedHeadId
    || typeof input.branchName!=='string' || !input.branchName.trim() || input.branchName.length>200
    || !(input.label===null || typeof input.label==='string' && input.label.length<=1000)) {
    throw new Error('invalid_story_capture_request');
  }
  return Object.freeze({...input});
}
export async function captureStoryWorkspaceVersion(input, {
  invokeImpl=invoke,native=typeof window!=='undefined' && Boolean(window.__TAURI_INTERNALS__)
}={}) {
  const request=prepareStoryCapture(input);
  if (!native) throw new Error('story_workspace_native_required');
  const result=await invokeImpl('capture_story_workspace_version',{input:request});
  if (!exact(result,['workspaceId','versionId','branchId','revision','replayed'])
    || result.workspaceId!==request.workspaceId || result.versionId!==request.versionId || result.branchId!==request.branchId
    || result.revision!==request.expectedRevision+1 || typeof result.replayed!=='boolean') {
    throw new Error('invalid_story_capture_result');
  }
  return Object.freeze({...result});
}
