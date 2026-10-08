import {test,expect} from 'bun:test';
import {verifyKomyakuArchive} from '../../../packages/archive-core/src/index.js';
import {parseStoryWorkspace} from '../../../packages/story-graph/src/index.js';
test('Rust shared Archive obeys core ZIP manifest and single Canonical document contract',async()=>{
 const bytes=new Uint8Array(await Bun.file(new URL('./fixtures/shared-archive-v1.fixture',import.meta.url)).arrayBuffer());
 const archive=await verifyKomyakuArchive(bytes);expect(archive.manifest.formatVersion).toBe(1);expect(archive.assets).toEqual([]);
 const document=structuredClone(archive.document),graph=document.extensions['komyaku.storygraph.workspace-v1'];delete document.extensions['komyaku.storygraph.workspace-v1'];
 const workspace=parseStoryWorkspace({schemaId:'https://komyaku.example/schemas/story-workspace/v1',schemaVersion:1,document,graph});expect(workspace.graph.nodes.filter(n=>n.kind==='content').length).toBeGreaterThan(0);expect(workspace.document.id).toBe(archive.manifest.document.id);
 const corrupt=bytes.slice();corrupt[40]^=1;await expect(verifyKomyakuArchive(corrupt)).rejects.toThrow();
});
