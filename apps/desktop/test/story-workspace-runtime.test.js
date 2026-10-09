import {test,expect} from 'bun:test';
import {createEmptyDocument} from '@komyaku/document-schema';
import {prepareStoryInitialization,initializeStoryWorkspace,prepareStoryEdit,editStoryWorkspace,readStoryWorkspace} from '../src/services/story-workspace-runtime.js';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function input(){return {operationId:id(3),versionId:id(4),branchId:id(5),branchName:'本文 / Main / 正文',label:null,
 document:createEmptyDocument({id:id(1),nodeIdFactory:()=>id(9)}),graph:{schemaId:'https://komyaku.example/schemas/story-graph/v1',schemaVersion:1,id:id(2),documentId:id(1),nodes:[],edges:[],paths:[],entities:[]}};}
test('initialization detaches exact retry input and excludes caller attribution',async()=>{
 const value=input();const prepared=prepareStoryInitialization(value);value.branchName='changed';let calls=[];
 const invokeImpl=async(name,args)=>{calls.push({name,args});return {workspaceId:id(2),versionId:id(4),branchId:id(5),revision:1,replayed:calls.length>1};};
 await initializeStoryWorkspace(prepared,{native:true,invokeImpl});expect((await initializeStoryWorkspace(prepared,{native:true,invokeImpl})).replayed).toBe(true);
 expect(calls[0]).toEqual(calls[1]);expect(calls[0].args.input.branchName).toBe('本文 / Main / 正文');
 expect(()=>prepareStoryInitialization({...input(),authorId:id(8)})).toThrow();
});
test('edits send immutable command bytes and reject wrong receipts',async()=>{
 const request=prepareStoryEdit(id(3),{documentId:id(1),graphId:id(2),expectedRevision:1,operations:[{type:'put',collection:'entities',value:{id:id(6),type:'character',name:'人物'}}]});
 const result=await editStoryWorkspace(request,{native:true,invokeImpl:async(name,args)=>{expect(name).toBe('edit_story_workspace');expect(args.input).toEqual(request);return {workspaceId:id(2),revision:2,replayed:false};}});
 expect(result.revision).toBe(2);
 await expect(editStoryWorkspace(request,{native:true,invokeImpl:async()=>({workspaceId:id(99),revision:2,replayed:false})})).rejects.toThrow();
});
test('read validates composite identity and native-only access',async()=>{
 const value=input();const state={workspaceId:id(2),revision:1,snapshotJson:JSON.stringify({schemaId:'https://komyaku.example/schemas/story-workspace/v1',schemaVersion:1,document:value.document,graph:value.graph}),currentBranchId:id(5),currentVersionId:id(4)};
 expect((await readStoryWorkspace(id(2),{native:true,invokeImpl:async()=>state})).workspace.document.id).toBe(id(1));
 await expect(readStoryWorkspace(id(2),{native:false})).rejects.toThrow('story_workspace_native_required');
 await expect(readStoryWorkspace(id(2),{native:true,invokeImpl:async()=>({...state,currentBranchId:null})})).rejects.toThrow();
});
