import {invoke} from '@tauri-apps/api/core';
import {encodeStoryWorkspaceSnapshot,parseStoryWorkspace} from '@komyaku/story-graph';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const isUuid=v=>typeof v==='string' && uuid.test(v);
const exact=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
const nativeDefault=()=>typeof window!=='undefined' && Boolean(window.__TAURI_INTERNALS__);
function nativeOptions(options) {
 const {invokeImpl=invoke,native=nativeDefault()}=options;
 if(!native)throw new Error('story_workspace_native_required');return invokeImpl;
}
export function prepareStoryInitialization(input) {
 if(!exact(input,['operationId','versionId','branchId','branchName','label','document','graph'])
  || ['operationId','versionId','branchId'].some(k=>!isUuid(input[k]))
  || typeof input.branchName!=='string' || !input.branchName.trim() || input.branchName.length>200
  || !(input.label===null || typeof input.label==='string' && input.label.length<=1000))throw new Error('invalid_story_initialize_request');
 const {workspace}=encodeStoryWorkspaceSnapshot({schemaId:'https://komyaku.example/schemas/story-workspace/v1',schemaVersion:1,document:input.document,graph:input.graph});
 if(!isUuid(workspace.graph.id)||!isUuid(workspace.document.id))throw new Error('invalid_story_initialize_request');
 // JSON detaches caller data; serialization also fixes exact-request retries.
 return JSON.stringify({...input,document:workspace.document,graph:workspace.graph});
}
export async function initializeStoryWorkspace(preparedJson,options={}) {
 const raw=JSON.parse(preparedJson);const checked=prepareStoryInitialization(raw);
 const request=JSON.parse(checked);
 const result=await nativeOptions(options)('initialize_story_workspace',{input:request});
 if(!exact(result,['workspaceId','versionId','branchId','revision','replayed']) || result.workspaceId!==request.graph.id
  || result.versionId!==request.versionId || result.branchId!==request.branchId || result.revision!==1 || typeof result.replayed!=='boolean')throw new Error('invalid_story_initialize_result');
 return Object.freeze({...result});
}
export function prepareStoryEdit(operationId,command) {
 if(!isUuid(operationId)||!exact(command,['documentId','graphId','expectedRevision','operations'])
  || !isUuid(command.documentId)||!isUuid(command.graphId)||!Number.isSafeInteger(command.expectedRevision)
  || command.expectedRevision<1 || command.expectedRevision>Number.MAX_SAFE_INTEGER-1
  || !Array.isArray(command.operations)||!command.operations.length || command.operations.length>100)throw new Error('invalid_story_edit_request');
 for(const operation of command.operations) {
  const keys=operation?.type==='replace-document'?['type','document']:operation?.type==='put'?['type','collection','value']:operation?.type==='remove'?['type','collection','id']:[];
  if(!keys.length || !exact(operation,keys) || (operation.type!=='replace-document'
   && (!['nodes','edges','paths','entities'].includes(operation.collection)||!isUuid(operation.type==='put'?operation.value?.id:operation.id))))throw new Error('invalid_story_edit_request');
 }
 const commandJson=JSON.stringify(command);
 if(new TextEncoder().encode(commandJson).length>24*1024*1024)throw new Error('invalid_story_edit_request');
 return Object.freeze({operationId,commandJson});
}
export async function editStoryWorkspace(request,options={}) {
 if(!exact(request,['operationId','commandJson'])||typeof request.commandJson!=='string')throw new Error('invalid_story_edit_request');
 const command=JSON.parse(request.commandJson);const checked=prepareStoryEdit(request.operationId,command);
 const result=await nativeOptions(options)('edit_story_workspace',{input:checked});
 if(!exact(result,['workspaceId','revision','replayed'])||result.workspaceId!==command.graphId
  || result.revision!==command.expectedRevision+1 || typeof result.replayed!=='boolean')throw new Error('invalid_story_edit_result');
 return Object.freeze({...result});
}
export async function readStoryWorkspace(workspaceId,options={}) {
 if(!isUuid(workspaceId))throw new Error('invalid_story_workspace_id');
 const result=await nativeOptions(options)('read_story_workspace',{workspaceId});
 if(!exact(result,['workspaceId','revision','snapshotJson','currentBranchId','currentVersionId'])||result.workspaceId!==workspaceId
  || !Number.isSafeInteger(result.revision)||result.revision<1||typeof result.snapshotJson!=='string'
  || new TextEncoder().encode(result.snapshotJson).length>24*1024*1024
  || !((result.currentBranchId===null && result.currentVersionId===null)||(isUuid(result.currentBranchId)&&isUuid(result.currentVersionId))))throw new Error('invalid_story_workspace_state');
 const workspace=parseStoryWorkspace(JSON.parse(result.snapshotJson));
 if(workspace.graph.id!==workspaceId)throw new Error('invalid_story_workspace_state');
 return Object.freeze({...result,workspace});
}
