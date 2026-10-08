import {test,expect} from 'bun:test';
import {canonicalToEditorDocument,editorToCanonicalDocument} from '../../../packages/editor-core/src/canonical-adapter.js';
import {createEditorState,komyakuSchema} from '../../../packages/editor-core/src/prosemirror-schema.js';
import {TextSelection} from '../../../packages/editor-core/node_modules/prosemirror-state/dist/index.js';
import {toggleMark} from '../../../packages/editor-core/node_modules/prosemirror-commands/dist/index.js';
import {needsRichEditor,richText,richInlineHtml,changeBlockType} from '../src/rich-content.js';
import {canonicalText} from '../src/adapter.js';
import preview from '../src/preview.json';
const original=()=>structuredClone(Object.values(preview.details).find(n=>n.type_id==='story.scene').properties.canonical);
test('formatting and headings retain canonical identities and source text',()=>{
 const doc=original();let state=createEditorState({document:canonicalToEditorDocument(doc)});
 state=state.apply(state.tr.setSelection(TextSelection.create(state.doc,1,3)));
 const dispatch=tr=>{state=state.applyTransaction(tr).state;};
 expect(toggleMark(komyakuSchema.marks.bold)(state,dispatch)).toBe(true);
 let result=editorToCanonicalDocument(state.doc);expect(needsRichEditor(result)).toBe(true);expect(canonicalText(result)).toBe(canonicalText(doc));expect(result.id).toBe(doc.id);expect(result.content[0].id).toBe(doc.content[0].id);
 changeBlockType(komyakuSchema.nodes.heading,{level:2})(state,dispatch);result=editorToCanonicalDocument(state.doc);expect(result.content[0].type).toBe('heading');expect(result.content[0].id).toBe(doc.content[0].id);expect(canonicalText(result)).toBe(canonicalText(doc));
});
test('styled reading fragments retain source offsets and escape authored content',()=>{
 const content=[{type:'text',text:'<前>😀',marks:[{type:'bold'}]},{type:'hard_break'},{type:'text',text:'後ろ',marks:[{type:'link',href:'javascript:alert(1)'}]}];
 const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 expect(richText({type:'paragraph',content})).toBe('<前>😀\n後ろ');expect(richInlineHtml(content,esc,3,8)).toBe('<strong>😀</strong>\n後ろ');expect(richInlineHtml(content,esc)).toBe('<strong>&lt;前&gt;😀</strong>\n後ろ');
});
