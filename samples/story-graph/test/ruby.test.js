import {test,expect} from 'bun:test';
import preview from '../src/preview.json';
import {parseCanonicalDocument} from '../../../packages/document-schema/src/index.js';
import {canonicalToEditorDocument,editorToCanonicalDocument} from '../../../packages/editor-core/src/canonical-adapter.js';
import {rubySafeCut} from '../src/reading-viewport.js';
import {richInlineHtml,needsRichEditor} from '../src/rich-content.js';
test('ruby retains reading across editor conversion and escapes reading HTML',()=>{
 const scene=Object.values(preview.details).find(n=>n.type_id==='story.scene');const doc=structuredClone(scene.properties.canonical);
 doc.content[0].content=[{type:'text',text:'青空',marks:[{type:'ruby',reading:'あおぞら'}],metadata:{},extensions:{}}];
 const parsed=parseCanonicalDocument(doc),roundtrip=editorToCanonicalDocument(canonicalToEditorDocument(parsed));
 expect(roundtrip.content[0].content).toEqual(parsed.content[0].content);expect(needsRichEditor(parsed)).toBe(true);
 const escape=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 expect(richInlineHtml([{type:'text',text:'青空',marks:[{type:'ruby',reading:'<空>'}]}],escape)).toBe('<ruby>青空<rt>&lt;空&gt;</rt></ruby>');
 for(const reading of ['', 'a\nb', 'a\tb', '😀'.repeat(129)]){doc.content[0].content[0].marks[0].reading=reading;expect(()=>parseCanonicalDocument(doc)).toThrow();}
});

test('reader chunk boundary retains a whole ruby base',()=>{const content=[{type:'text',text:'前'},{type:'text',text:'青空',marks:[{type:'ruby',reading:'あおぞら'}]}];expect(rubySafeCut(content,2)).toBe(1);expect(rubySafeCut(content,3)).toBe(3);expect(rubySafeCut(content,2,1)).toBe(2);});
