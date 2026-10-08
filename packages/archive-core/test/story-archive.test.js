import { expect, test } from 'bun:test';
import { createEmptyDocument } from '@komyaku/document-schema';
import { parseStoryWorkspace } from '@komyaku/story-graph';
import { createKomyakuStoryArchive, verifyKomyakuStoryArchive,
  verifyKomyakuArchive, verifyKomyakuHistoryArchive, storyArchiveManifestSchema } from '../src/index.js';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const timestamp = '2026-10-08T00:00:00.000Z';
  const base = createEmptyDocument({id:id(1),nodeIdFactory:()=>id(2)});
  const main = structuredClone(base); main.metadata.title = 'Main 日本語';
  const alternative = structuredClone(base); alternative.metadata.title = 'Alternative 简体中文';
  const documents = [base,main,alternative];
  const versions = documents.map((document,index) => ({id:id(10+index),schemaVersion:1,
    snapshotEncoding:'canonical-json-v1',snapshotJson:JSON.stringify(document),
    parentIds:index ? [id(10)] : [],authorId:id(3),reason:index ? 'named' : 'initial',
    restoredFromVersionId:null,label:null,createdAt:timestamp}));
  const workspaces = documents.map((document,index)=>({versionId:id(10+index),snapshotJson:JSON.stringify(parseStoryWorkspace({
    schemaId:'https://komyaku.example/schemas/story-workspace/v1',schemaVersion:1,document,
    graph:{schemaId:'https://komyaku.example/schemas/story-graph/v1',schemaVersion:1,id:id(4),documentId:id(1),
      nodes:[{id:id(5),kind:'content',subtype:'scene',title:'人物は事実を知る / Knowledge / 知识',documentRefs:[{nodeId:id(2)}]}],
      edges:[],entities:[],paths:[{id:id(6),name:['Base','Main','Alternative'][index],nodeIds:[id(5)]}]}
  }))}));
  return {workspaceId:id(4),workspaces,history:{documentId:id(1),currentBranchId:id(20),currentVersionId:id(11),
    versions,assets:[],createdAt:timestamp,branches:[
      {id:id(20),name:'Main',headVersionId:id(11),createdAt:timestamp,updatedAt:timestamp},
      {id:id(21),name:'Alternative',headVersionId:id(12),createdAt:timestamp,updatedAt:timestamp}]}};
}

test('v3 retains exact composite bytes, every Path, ordered parents and Branch heads', async () => {
  const input=fixture();
  const bytes=await createKomyakuStoryArchive(input);
  const archive=await verifyKomyakuStoryArchive(bytes);
  expect(archive.kind).toBe('story-history');
  expect(archive.history.versions.map(v=>v.parentIds)).toEqual([[],[id(10)],[id(10)]]);
  expect(archive.history.branches.map(b=>b.headVersionId)).toEqual([id(11),id(12)]);
  expect(archive.workspaces.map(w=>w.snapshotJson)).toEqual(input.workspaces.map(w=>w.snapshotJson));
  expect(archive.workspaces.map(w=>w.workspace.graph.paths[0].name)).toEqual(['Base','Main','Alternative']);
  expect(await createKomyakuStoryArchive(input)).toEqual(bytes);
  await expect(verifyKomyakuArchive(bytes)).rejects.toThrow();
  await expect(verifyKomyakuHistoryArchive(bytes)).rejects.toThrow();
});

test('v3 refuses omitted, repeated and foreign Version sidecars', async () => {
  for (const mutation of [input=>input.workspaces.pop(),input=>input.workspaces.push(input.workspaces[0]),
    input=>input.workspaces[0].versionId=id(99)]) {
    const input=fixture();mutation(input);
    await expect(createKomyakuStoryArchive(input)).rejects.toThrow('story_archive_version_set_mismatch');
  }
});

test('v3 compares Document values independently of object key order while retaining exact bytes', async () => {
  const input = fixture();
  const reverseKeys = value => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)]))
      : value;
  input.workspaces = input.workspaces.map(record => ({ ...record,
    snapshotJson: JSON.stringify(reverseKeys(JSON.parse(record.snapshotJson))) }));
  const archive = await verifyKomyakuStoryArchive(await createKomyakuStoryArchive(input));
  expect(archive.workspaces.map(record => record.snapshotJson)).toEqual(input.workspaces.map(record => record.snapshotJson));
});

test('v3 refuses mismatched documents, workspace identity and broken Graph references', async () => {
  for (const mutation of [workspace=>workspace.document.metadata.title='different',
    workspace=>workspace.graph.id=id(99),workspace=>workspace.graph.nodes[0].documentRefs[0].nodeId=id(99),
    workspace=>workspace.graph.paths[0].nodeIds=[id(99)]]) {
    const input=fixture();const workspace=JSON.parse(input.workspaces[0].snapshotJson);mutation(workspace);
    input.workspaces[0].snapshotJson=JSON.stringify(workspace);
    await expect(createKomyakuStoryArchive(input)).rejects.toThrow();
  }
});

test('restoration must retain the exact composite snapshot, including Graph/Paths', async () => {
  const input=fixture(); const original=input.history.versions[0];
  input.history.versions.push({...original,id:id(13),parentIds:[id(11)],reason:'restore',restoredFromVersionId:id(10)});
  input.history.currentVersionId=id(13);input.history.branches[0].headVersionId=id(13);
  input.workspaces.push({versionId:id(13),snapshotJson:input.workspaces[0].snapshotJson});
  const archive=await verifyKomyakuStoryArchive(await createKomyakuStoryArchive(input));
  expect(archive.workspaces[3].snapshotJson).toBe(input.workspaces[0].snapshotJson);
  const workspace=JSON.parse(input.workspaces[3].snapshotJson);workspace.graph.paths[0].name='silently changed route';
  input.workspaces[3].snapshotJson=JSON.stringify(workspace);
  await expect(createKomyakuStoryArchive(input)).rejects.toThrow('story_archive_restore_mismatch');
});

test('v3 rejects corruption and caller budget expansion cannot bypass contract limits', async () => {
  const bytes=await createKomyakuStoryArchive(fixture());
  const corrupt=bytes.slice();corrupt[Math.floor(corrupt.length/2)]^=1;
  await expect(verifyKomyakuStoryArchive(corrupt)).rejects.toThrow();
  await expect(verifyKomyakuStoryArchive(bytes,{maxArchiveBytes:bytes.length-1})).rejects.toThrow();
  await expect(verifyKomyakuStoryArchive(bytes,{maxArchiveBytes:NaN})).rejects.toThrow('invalid_story_archive_limit');
  await expect(verifyKomyakuStoryArchive(bytes,{maxEntries:3})).rejects.toThrow();
  expect((await verifyKomyakuStoryArchive(bytes,{maxArchiveBytes:Number.MAX_SAFE_INTEGER})).workspaceId).toBe(id(4));
  const archive=await verifyKomyakuStoryArchive(bytes);
  expect(storyArchiveManifestSchema.safeParse({...archive.manifest,formatVersion:2}).success).toBe(false);
});

test('v3 retains a historical-only Asset with exact bytes and no extra closure', async () => {
  const input=fixture();const document=JSON.parse(input.history.versions[0].snapshotJson);
  document.content[0].renderArtifacts=[{assetId:id(30),role:'render-cache',mediaType:'text/plain'}];
  input.history.versions[0].snapshotJson=JSON.stringify(document);
  const workspace=JSON.parse(input.workspaces[0].snapshotJson);workspace.document=document;
  input.workspaces[0].snapshotJson=JSON.stringify(workspace);
  const bytes=new TextEncoder().encode('Historical-only source 日本語 简体中文');
  input.history.assets=[{id:id(30),mediaType:'text/plain',bytes}];
  const archive=await verifyKomyakuStoryArchive(await createKomyakuStoryArchive(input));
  expect(archive.history.assets[0].bytes).toEqual(bytes);
  expect(archive.history.versions[0].assetIds).toEqual([id(30)]);
  expect(archive.history.versions[1].assetIds).toEqual([]);
  input.history.assets=[];
  await expect(createKomyakuStoryArchive(input)).rejects.toThrow();
});
