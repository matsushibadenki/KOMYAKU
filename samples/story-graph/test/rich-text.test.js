import {test,expect} from 'bun:test';
import {canonicalToEditorDocument,editorToCanonicalDocument} from '../../../packages/editor-core/src/canonical-adapter.js';
import {createEditorState,komyakuSchema} from '../../../packages/editor-core/src/prosemirror-schema.js';
import {TextSelection} from '../../../packages/editor-core/node_modules/prosemirror-state/dist/index.js';
import {toggleMark} from '../../../packages/editor-core/node_modules/prosemirror-commands/dist/index.js';
import {needsRichEditor,richText,richInlineHtml,changeBlockType,readingTextHtml,richParagraphRange,richParagraphSelection} from '../src/rich-content.js';
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

test('two-digit vertical groups preserve longer numbers and authored escaping',()=>{
 const escape=s=>s.replaceAll('<','&lt;');
 expect(readingTextHtml('12日 123年 <56>',escape)).toBe('<span class="tate-chu-yoko">12</span>日 123年 &lt;<span class="tate-chu-yoko">56</span>>');
});

test('rich search and assistant selections use canonical UTF-16 offsets across marks',()=>{
 const doc=original();doc.content[0].content=[{type:'text',text:'前😀',marks:[{type:'bold'}]},{type:'text',text:'後ろ',marks:[]}];
 const editor=canonicalToEditorDocument(doc),id=doc.content[0].id;
 const range=richParagraphRange(editor,id,1,5);expect(range).toEqual({from:2,to:6});
 expect(richParagraphSelection(TextSelection.create(editor,range.from,range.to))).toEqual({id,start:1,end:5});
 expect(richParagraphRange(editor,'missing',0,1)).toBeNull();
 doc.content[0].content.push({type:'hard_break'});const breaks=canonicalToEditorDocument(doc);
 expect(richParagraphSelection(TextSelection.create(breaks,1,3))).toBeNull();
});
