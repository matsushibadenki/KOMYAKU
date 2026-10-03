import { parseCanonicalDocument } from '../../../packages/document-schema/src/index.js';
export const paragraphText = node => node.content.map(n=>n.text).join('');
export function setParagraphText(node,text) { node.content=text?[{type:'text',text,marks:[],metadata:{},extensions:{}}]:[]; }
const common=()=>({id:crypto.randomUUID(),schemaVersion:1,metadata:{},extensions:{},renderArtifacts:[]});
function paragraph(text='') { const node={...common(),type:'paragraph',attrs:{lang:null,dir:'auto'},content:[]};setParagraphText(node,text);return node; }
export function insertDialogue(input,caret) {
  const doc=structuredClone(input);
  const sheet={...common(),type:'table',content:[{...common(),type:'table_row',content:[0,1].map(()=>({...common(),type:'table_cell',attrs:{header:false,colspan:1,rowspan:1},content:[paragraph()]}))}]};
  const index=caret?doc.content.findIndex(node=>node.id===caret.id&&node.type==='paragraph'):-1;
  if(index>=0) {
    const node=doc.content[index],text=paragraphText(node),start=Math.max(0,Math.min(text.length,caret.start)),end=Math.max(start,Math.min(text.length,caret.end));
    setParagraphText(node,text.slice(0,start));doc.content.splice(index+1,0,sheet,paragraph(text.slice(end)));
  } else doc.content.push(sheet,paragraph());
  return {document:parseCanonicalDocument(doc),focus:sheet.content[0].content[0].content[0].id};
}
const paragraphIndexes=new WeakMap(),characterCounts=new WeakMap();
const characters=text=>{let count=0;for(const _ of text)count++;return count;};
function paragraphIndex(doc) {
  let index=paragraphIndexes.get(doc);if(index)return index;
  index=new Map();doc.content.forEach((block,i)=>{
    if(block.type==='paragraph')index.set(block.id,[i]);
    else block.content[0].content.forEach((cell,j)=>index.set(cell.content[0].id,[i,j]));
  });paragraphIndexes.set(doc,index);return index;
}
export function documentCharacters(doc) {
  if(characterCounts.has(doc))return characterCounts.get(doc);
  let count=Math.max(0,doc.content.length-1);
  for(const block of doc.content) {
    if(block.type==='paragraph')count+=characters(paragraphText(block));
    else {count++;for(const cell of block.content[0].content)count+=characters(paragraphText(cell.content[0]));}
  }
  characterCounts.set(doc,count);return count;
}
export function updateParagraph(input,id,text,delta=null) {
  const index=paragraphIndex(input),position=index.get(id);if(!position)throw new Error('missing_node');
  const [i,j]=position,block=input.content[i],old=j===undefined?block:block.content[0].content[j].content[0];
  const updated={...old};setParagraphText(updated,text);
  const doc={...input,content:input.content.slice()};
  if(j===undefined)doc.content[i]=updated;
  else {
    const cells=block.content[0].content.slice();cells[j]={...cells[j],content:[updated]};
    doc.content[i]={...block,content:[{...block.content[0],content:cells}]};
  }
  paragraphIndexes.set(doc,index);
  characterCounts.set(doc,documentCharacters(input)+(delta??(characters(text)-characters(paragraphText(old)))));
  return doc;
}
export function paragraphById(doc,id) {
  const position=paragraphIndex(doc).get(id);if(!position)throw new Error('missing_node');
  const [i,j]=position;return j===undefined?doc.content[i]:doc.content[i].content[0].content[j].content[0];
}
export function setDialogueWidth(input,id,width) {
  const doc=structuredClone(input),table=doc.content.find(node=>node.id===id&&node.type==='table');
  if(!table)throw new Error('missing_node');
  table.extensions??={};
  if(width===null)delete table.extensions['komyaku.dialogue'];
  else {
    if(!Number.isFinite(width)||width<16||width>4096)throw new Error('invalid_properties');
    table.extensions['komyaku.dialogue']={actorWidth:Math.round(width)};
  }
  return doc;
}
