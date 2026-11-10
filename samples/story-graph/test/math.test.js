import {test,expect} from 'bun:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import preview from '../src/preview.json';
import {canonicalToEditorDocument,editorToCanonicalDocument} from '../../../packages/editor-core/src/canonical-adapter.js';
import {richText,needsRichEditor} from '../src/rich-content.js';
test('copied Symbio keyboard files match their recorded source hashes',()=>{
 const records=JSON.parse(readFileSync(new URL('../src/vendor/symbio/ORIGIN.json',import.meta.url)));
 for(const record of records){
 const path=record.copy.includes('/')?new URL('../'+record.copy.replace('samples/story-graph/',''),import.meta.url):new URL('../src/vendor/symbio/'+record.copy,import.meta.url);
 expect(createHash('sha256').update(readFileSync(path)).digest('hex')).toBe(record.sha256);}

});
test('inline and display LaTeX survive canonical editor conversion',()=>{
 const doc=structuredClone(Object.values(preview.details).find(n=>n.type_id==='story.scene').properties.canonical);
 const common=()=>({id:crypto.randomUUID(),schemaVersion:1,metadata:{},extensions:{},renderArtifacts:[]});
 const inline={...common(),type:'math_inline',sourceType:'latex',source:'\\frac{1}{2}'};
 doc.content[0].content.push(inline);doc.content.push({...common(),type:'math_block',sourceType:'latex',source:'x^2',displayMode:'block'});
 const restored=editorToCanonicalDocument(canonicalToEditorDocument(doc));
 expect(restored.content[0].content.at(-1)).toEqual(inline);expect(restored.content.at(-1)).toEqual(doc.content.at(-1));
 expect(richText(inline)).toBe(inline.source);expect(needsRichEditor(doc)).toBe(true);
});
