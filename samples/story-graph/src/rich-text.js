import {changeBlockType} from './rich-content.js';
import {canonicalToEditorDocument,editorToCanonicalDocument} from '../../../packages/editor-core/src/canonical-adapter.js';
import {komyakuSchema,createStableNodeIdentityPlugin} from '../../../packages/editor-core/src/prosemirror-schema.js';
import {EditorView} from '../../../packages/editor-core/node_modules/prosemirror-view/dist/index.js';
import {EditorState,TextSelection} from '../../../packages/editor-core/node_modules/prosemirror-state/dist/index.js';
import {keymap} from '../../../packages/editor-core/node_modules/prosemirror-keymap/dist/index.js';
import {baseKeymap,toggleMark,wrapIn} from '../../../packages/editor-core/node_modules/prosemirror-commands/dist/index.js';
import {wrapInList} from '../../../packages/editor-core/node_modules/prosemirror-schema-list/dist/index.js';

export function mountRichEditor(root,{document:canonical,t,onChange,onComposition,onUndo,onImage,selection}){
 const toolbar=document.createElement('div');toolbar.className='rich-toolbar';toolbar.setAttribute('role','toolbar');toolbar.setAttribute('aria-label',t('formatting'));
 const editor=document.createElement('div');editor.className='rich-editor';root.append(toolbar,editor);
 let disposed=false,view;
 const state=EditorState.create({doc:canonicalToEditorDocument(canonical),plugins:[createStableNodeIdentityPlugin(),keymap({'Mod-z':()=>{onUndo(false);return true;},'Mod-Shift-z':()=>{onUndo(true);return true;}}),keymap(baseKeymap)]});
 view=new EditorView(editor,{state,attributes:{'aria-label':t('body'),'data-rich-body':'true'},handleDOMEvents:{compositionstart:()=>{onComposition(true);return false;},compositionend:()=>{queueMicrotask(()=>{if(!disposed)onComposition(false);});return false;}},dispatchTransaction(transaction){
  const next=view.state.applyTransaction(transaction);view.updateState(next.state);if(next.transactions.some(tr=>tr.docChanged))onChange(editorToCanonicalDocument(next.state.doc));
 },nodeViews:{image(node){const figure=document.createElement('figure'),image=document.createElement('img');image.alt=node.attrs.altText;const data=(view?.state.doc.attrs.extensions??canonical.extensions)?.['komyaku.images']?.[node.attrs.assetId];if(typeof data==='string'&&data.startsWith('data:image/png;base64,'))image.src=data;else figure.append(document.createTextNode(node.attrs.altText||t('image')));figure.append(image);return {dom:figure};}}});
 const button=(key,command)=>{const el=document.createElement('button');el.type='button';el.textContent=t(key);el.onmousedown=event=>event.preventDefault();el.onclick=()=>{command(view.state,view.dispatch,view);view.focus();};toolbar.append(el);};
 for(const [key,mark] of [['bold','bold'],['italic','italic'],['underline','underline'],['strike','strike']])button(key,toggleMark(komyakuSchema.marks[mark]));
 button('paragraph',changeBlockType(komyakuSchema.nodes.paragraph));button('heading',changeBlockType(komyakuSchema.nodes.heading,{level:2}));button('quote',wrapIn(komyakuSchema.nodes.blockquote));button('bulletList',wrapInList(komyakuSchema.nodes.bullet_list));
 button('image',()=>{onImage(view);return true;});
 if(selection){const from=Math.min(view.state.doc.content.size,selection.from),to=Math.min(view.state.doc.content.size,selection.to);view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,from,to)));view.focus();}
 return {insertDialogue(){const p=()=>komyakuSchema.nodes.paragraph.create({nodeId:crypto.randomUUID()});const table=komyakuSchema.nodes.table.create({nodeId:crypto.randomUUID()},komyakuSchema.nodes.table_row.create({nodeId:crypto.randomUUID()},[0,1].map(()=>komyakuSchema.nodes.table_cell.create({nodeId:crypto.randomUUID()},p()))));const tr=view.state.tr.replaceSelectionWith(table);if(tr.doc.lastChild.type.name!=='paragraph')tr.insert(tr.doc.content.size,p());view.dispatch(tr);view.focus();},selection:()=>({from:view.state.selection.from,to:view.state.selection.to}),focus:()=>view.focus(),view,dispose(){disposed=true;view.destroy();}};
}
