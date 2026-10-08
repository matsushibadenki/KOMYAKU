import {paragraphText,setParagraphText,updateParagraph} from './dialogue.js';
import {graphemeStep} from './text-performance.js';

const indexes=new WeakMap();
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
function leaves(document) {
  let index=indexes.get(document);if(index)return index;
  const ordered=[];
  document.content.forEach((block,blockIndex)=>{
    if(block.type==='paragraph')ordered.push({node:block,block:blockIndex,cell:null});
    else block.content[0].content.forEach((cell,cellIndex)=>ordered.push({node:cell.content[0],block:blockIndex,cell:cellIndex}));
  });
  index={ordered,byId:new Map(ordered.map((leaf,i)=>[leaf.node.id,i])),points:new Map()};indexes.set(document,index);return index;
}
function endpoint(index,point) {
  if(typeof point.id!=='string'||!Number.isInteger(point.offset))throw new Error('invalid_selection');
  const key=`${point.id}:${point.offset}`,cached=index.points.get(key);if(cached)return cached;
  const order=index.byId.get(point.id);if(order===undefined)throw new Error('missing_node');
  const text=paragraphText(index.ordered[order].node),position=point.offset;
  if(!Number.isInteger(position)||position<0||position>text.length)throw new Error('invalid_selection');
  if(position>0&&position<text.length){
    const segments=graphemes.segment(text),segment=segments.containing(position);
    if(segment.index!==position){
      // Some JS engines disagree between containing() and the iterator at a
      // surrogate boundary. Confirm a rejected boundary with the iterator.
      let boundary=false;for(const item of segments){if(item.index>=position){boundary=item.index===position;break;}}
      if(!boundary)throw new Error('invalid_selection');
    }
  }
  const result={...point,order};if(index.points.size>=4)index.points.delete(index.points.keys().next().value);index.points.set(key,result);return result;
}
export function documentRange(document,selection) {
  const index=leaves(document),a=endpoint(index,selection.anchor),b=endpoint(index,selection.focus);
  const forward=a.order<b.order||a.order===b.order&&a.offset<=b.offset;
  return {index,start:forward?a:b,end:forward?b:a,forward};
}
export function documentSelectionText(document,selection) {
  const {index,start,end}=documentRange(document,selection),parts=[];
  for(let i=start.order;i<=end.order;i++){
    const leaf=index.ordered[i],text=paragraphText(leaf.node);
    if(i>start.order){const previous=index.ordered[i-1];parts.push(previous.block===leaf.block?'\t':'\n');}
    parts.push(text.slice(i===start.order?start.offset:0,i===end.order?end.offset:text.length));
  }
  return parts.join('');
}
export function documentLeafRange(document,selection,id) {
  const {index,start,end}=documentRange(document,selection),order=index.byId.get(id);
  if(order===undefined||order<start.order||order>end.order)return null;
  return {start:order===start.order?start.offset:0,end:order===end.order?end.offset:paragraphText(index.ordered[order].node).length};
}
export function moveDocumentPoint(document,point,direction) {
  const index=leaves(document),current=endpoint(index,point),text=paragraphText(index.ordered[current.order].node);
  if(direction>0&&point.offset===text.length&&current.order<index.ordered.length-1)return {id:index.ordered[current.order+1].node.id,offset:0};
  if(direction<0&&point.offset===0&&current.order>0){const previous=index.ordered[current.order-1].node;return {id:previous.id,offset:paragraphText(previous).length};}
  return {id:point.id,offset:graphemeStep(text,point.offset,direction)};
}
export function replaceDocumentSelection(document,selection,insert) {
  const {index,start,end}=documentRange(document,selection),first=index.ordered[start.order],last=index.ordered[end.order];
  const prefix=paragraphText(first.node).slice(0,start.offset),suffix=paragraphText(last.node).slice(end.offset);
  if(first.cell===null&&last.cell===null){
    const paragraph={...first.node};setParagraphText(paragraph,prefix+insert+suffix);
    const content=[...document.content.slice(0,first.block),paragraph,...document.content.slice(last.block+1)];
    return {document:{...document,content},caret:{id:first.node.id,offset:prefix.length+insert.length}};
  }
  // Partial table endpoints keep their rows/cells valid. Entire intermediate
  // blocks are removed; unselected cells and metadata remain untouched.
  let next=document;
  for(let i=start.order;i<=end.order;i++){
    const leaf=index.ordered[i];
    next=updateParagraph(next,leaf.node.id,(i===start.order?prefix+insert:'')+(i===end.order?suffix:''));
  }
  if(last.block-first.block>1)next={...next,content:next.content.filter((_,i)=>i<=first.block||i>=last.block)};
  return {document:next,caret:{id:first.node.id,offset:prefix.length+insert.length}};
}
