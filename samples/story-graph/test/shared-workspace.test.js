import {test,expect} from 'bun:test';
import {parseStoryWorkspace,encodeStoryWorkspaceSnapshot} from '../../../packages/story-graph/src/index.js';
import fixture from './fixtures/shared-workspace-v1.json';
test('Rust adapter fixture obeys shared Canonical Story Workspace v1',()=>{
 const workspace=parseStoryWorkspace(fixture);
 expect(workspace.graph.documentId).toBe(workspace.document.id);
 expect(workspace.graph.paths.length).toBe(2);
 expect(encodeStoryWorkspaceSnapshot(workspace).bytes.length).toBeLessThan(24*1024*1024);
 const skeleton=workspace.graph.extensions['komyaku.storygraph.native-v1'];
 for(const node of Object.values(skeleton.graph.nodes))expect(node.properties.canonical).toBeUndefined();
 for(const node of workspace.graph.nodes.filter(node=>node.kind==='content'))expect(node.documentRefs.length).toBe(1);
});
