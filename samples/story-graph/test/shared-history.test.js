import {test,expect} from 'bun:test';
import {verifyKomyakuHistoryArchive} from '../../../packages/archive-core/src/index.js';
test('Rust history archive follows shared v2 checksums, branches and two-parent merge contract',async()=>{
 const bytes=new Uint8Array(await Bun.file(new URL('./fixtures/shared-history-v2.fixture',import.meta.url)).arrayBuffer());
 const archive=await verifyKomyakuHistoryArchive(bytes);
 expect(archive.manifest.formatVersion).toBe(2);
 expect(archive.manifest.versions).toHaveLength(5);
 expect(archive.manifest.branches).toHaveLength(2);
 expect(archive.manifest.versions.some(version=>version.parentIds.length===2)).toBe(true);
 const corrupt=bytes.slice();corrupt[200]^=1;
 await expect(verifyKomyakuHistoryArchive(corrupt)).rejects.toThrow();
});
