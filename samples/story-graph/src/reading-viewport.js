import {canonicalPosition} from './text-performance.js';
import {estimatedExtent,estimatedDialogueExtent} from './manuscript-viewport.js';
// Group whole canonical paragraphs: virtualization never invents paragraph breaks.
export function readingChunks(blocks,limit=32768,maxBlocks=32) {
 const chunks=[];let current=[],size=0;
 for(const block of blocks){const length=block.text?.length??block.texts?.reduce((n,text)=>n+text.length,0)??0;
  if(current.length&&(current.length>=maxBlocks||size+length>limit)&&current.at(-1).kind!=='heading'){chunks.push(current);current=[];size=0;}
  current.push(block);size+=length;
 }if(current.length)chunks.push(current);return chunks;
}
export function readingSelectionText(blocks,anchor,focus) {
 const logical=[];
 for(const block of blocks){
  if(block.id&&logical.at(-1)?.id===block.id)continue;
  logical.push({id:block.id,text:block.sourceText??block.text??block.texts?.join('\t')??''});
 }
 let first=logical.findIndex(block=>block.id===anchor.id),last=logical.findIndex(block=>block.id===focus.id);
 if(first<0||last<0)return null;
 let start=anchor.offset,end=focus.offset;
 if(first>last||(first===last&&start>end)){[first,last]=[last,first];[start,end]=[end,start];}
 if(first===last)return logical[first].text.slice(start,end);
 return [logical[first].text.slice(start),...logical.slice(first+1,last).map(block=>block.text),logical[last].text.slice(0,end)].join('\n');
}
export class ReadingViewport {
 constructor({root,article,blocks,vertical,options,markup,measure,reflow}) {
  Object.assign(this,{root,article,vertical,options,markup,measure,reflow});this.span=options().span;this.entries=new Map();
  this.observer=new IntersectionObserver(records=>{for(const record of records){const entry=this.entries.get(record.target);if(!entry)continue;if(record.isIntersecting)this.mount(record.target,entry);else this.unmount(record.target,entry);}},{root,rootMargin:'800px'});
  for(const chunk of readingChunks(blocks)){const node=document.createElement('div');node.className='reading-chunk';const entry={blocks:chunk,extent:this.estimate(chunk)};this.entries.set(node,entry);this.placeholder(node,entry);article.append(node);this.observer.observe(node);}
  this.scrollHandler=()=>{if(this.anchorFrame!==undefined)return;this.anchorFrame=requestAnimationFrame(()=>{this.anchorFrame=undefined;if(Math.abs(this.options().span-this.span)<=1)this.lastAnchor=this.anchor();});};root.addEventListener('scroll',this.scrollHandler,{passive:true});
  this.copyHandler=event=>{
   const selection=window.getSelection();if(!selection?.rangeCount||selection.isCollapsed||!event.clipboardData)return;
   const paragraph=node=>(node.nodeType===1?node:node.parentElement)?.closest('[data-reading-block]');
   const first=paragraph(selection.anchorNode),last=paragraph(selection.focusNode);
   if(!first?.dataset.readingBlock||!last?.dataset.readingBlock)return;
   const source=blocks.find(block=>block.id===first.dataset.readingBlock);if(!source)return;
   const position=(element,node,offset)=>{const range=document.createRange();range.selectNodeContents(element);range.setEnd(node,offset);const start=Number(element.dataset.readingStart),part=blocks.find(block=>block.id===element.dataset.readingBlock&&(block.kind!=='paragraph'||(block.sourceStart??0)===start));const text=element.dataset.readingCell!==undefined?part.texts[Number(element.dataset.readingCell)]:part.text;return start+canonicalPosition(text,range.toString().length);};
   const anchor=position(first,selection.anchorNode,selection.anchorOffset),focus=position(last,selection.focusNode,selection.focusOffset);
   const text=readingSelectionText(blocks,{id:first.dataset.readingBlock,offset:anchor},{id:last.dataset.readingBlock,offset:focus});
   if(text===null)return;event.preventDefault();event.clipboardData.setData('text/plain',text);
  };article.addEventListener('copy',this.copyHandler);
  this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(root);
 }
 estimate(blocks){const options=this.options();return blocks.reduce((sum,block)=>sum+(block.kind==='dialogue'?estimatedDialogueExtent(block.texts,{...options,actorWidth:block.actorWidth}):estimatedExtent(block.text??'',{...options,fontSize:block.size??options.fontSize}))+ (block.kind==='heading'?24:0),0);}
 placeholder(node,entry){node.classList.add('reading-placeholder');node.style[this.vertical?'width':'height']=`${Math.max(1,entry.extent)}px`;}
 mount(node,entry){if(node.firstElementChild)return;node.innerHTML=entry.blocks.map(this.markup).join('');node.classList.remove('reading-placeholder');node.style[this.vertical?'width':'height']='';this.measure(node);entry.extent=Math.max(1,this.vertical?node.getBoundingClientRect().width:node.getBoundingClientRect().height);}
 unmount(node,entry){if(!node.firstElementChild)return;const selection=window.getSelection();if(selection&&!selection.isCollapsed&&(node.contains(selection.anchorNode)||node.contains(selection.focusNode)))return;node.replaceChildren();this.placeholder(node,entry);}
 resize(){const span=this.options().span;if(Math.abs(span-this.span)>1&&this.reflow){const anchor=this.lastAnchor??this.anchor();this.span=span;this.reflow(anchor);return;}for(const [node,entry]of this.entries){if(node.firstElementChild){this.measure(node);entry.extent=Math.max(1,this.vertical?node.getBoundingClientRect().width:node.getBoundingClientRect().height);}else{entry.extent=this.estimate(entry.blocks);this.placeholder(node,entry);}}}
 anchor(){
  const bounds=this.root.getBoundingClientRect();
  for(const [node,entry]of this.entries){
   const rect=node.getBoundingClientRect();if(!(this.vertical?rect.left<bounds.right&&rect.right>bounds.left:rect.top<bounds.bottom&&rect.bottom>bounds.top))continue;
   for(const element of node.querySelectorAll?.('[data-reading-block]')??[]){
    const visible=element.getBoundingClientRect();if(!(this.vertical?visible.left<bounds.right&&visible.right>bounds.left:visible.top<bounds.bottom&&visible.bottom>bounds.top))continue;
    const text=element.firstChild;if(text?.nodeType!==3||!text.length)continue;
    const range=document.createRange();let low=0,high=text.length-1;
    const coordinate=index=>{range.setStart(text,index);range.setEnd(text,index+1);return range.getBoundingClientRect();};
    while(low<high){const middle=(low+high)>>1,r=coordinate(middle);if(this.vertical?r.left>=bounds.right:r.bottom<=bounds.top)low=middle+1;else high=middle;}
    if(low>0&&/[\uDC00-\uDFFF]/.test(text.data[low]))low--;
    const r=coordinate(low),start=Number(element.dataset.readingStart),part=entry.blocks.find(block=>block.id===element.dataset.readingBlock&&(block.kind!=='paragraph'||(block.sourceStart??0)===start));
    range.detach();if(!part)continue;
    const original=element.dataset.readingCell!==undefined?part.texts[Number(element.dataset.readingCell)]:part.text;
    return {id:part.id,start:start+canonicalPosition(original,low),offset:this.vertical?r.right-bounds.right:r.top-bounds.top,character:true};
   }
   const first=entry.blocks[0];return {id:first.id,text:first.text,start:first.sourceStart??0,offset:this.vertical?rect.right-bounds.right:rect.top-bounds.top};
  }return null;
 }
 restore(anchor){
  if(!anchor)return;
  const contains=block=>anchor.id?block.id===anchor.id&&(block.sourceStart??0)<=anchor.start&&(((block.sourceStart??0)+(block.text?.length??block.texts?.join('\t').length??0))>anchor.start||((block.sourceStart??0)===anchor.start&&!block.text?.length)):block.text===anchor.text;
  const found=[...this.entries].find(([,entry])=>entry.blocks.some(contains));if(!found)return;
  const [node,entry]=found;this.mount(node,entry);const bounds=this.root.getBoundingClientRect();let rect=node.getBoundingClientRect();
  if(anchor.character){
   for(const element of node.querySelectorAll?.('[data-reading-block]')??[]){
    if(element.dataset.readingBlock!==anchor.id)continue;
    const start=Number(element.dataset.readingStart),part=entry.blocks.find(block=>block.id===anchor.id&&(block.kind!=='paragraph'||(block.sourceStart??0)===start));
    const original=element.dataset.readingCell!==undefined?part?.texts[Number(element.dataset.readingCell)]:part?.text;
    if(original===undefined||anchor.start<start||anchor.start>start+original.length||element.firstChild?.nodeType!==3)continue;
    const index=original.slice(0,anchor.start-start).replace(/\r\n?/g,'\n').length,range=document.createRange(),text=element.firstChild;
    range.setStart(text,Math.min(index,text.length));range.setEnd(text,Math.min(index+1,text.length));rect=range.getBoundingClientRect();range.detach();break;
   }
  }
  if(this.vertical)this.root.scrollLeft+=rect.right-bounds.right-anchor.offset;else this.root.scrollTop+=rect.top-bounds.top-anchor.offset;
 }
 disconnect(){this.root.removeEventListener('scroll',this.scrollHandler);if(this.anchorFrame!==undefined)cancelAnimationFrame(this.anchorFrame);this.article.removeEventListener('copy',this.copyHandler);this.observer.disconnect();this.resizeObserver.disconnect();this.entries.clear();}
}

// Measure bounded samples using WebKit's own line breaking. Keep the unfinished
// final line for the next sample, so display slices end at complete visual lines.
export function measuredReadingCut(length,coordinate,vertical) {
 if(length<2)return length;
 const last=coordinate(length-1);let low=0,high=length-1;
 while(low<high){const middle=(low+high)>>1,position=coordinate(middle);
  if(vertical?position>last+.5:position<last-.5)low=middle+1;else high=middle;
 }
 return low||length;
}
export async function boundedReadingBlocks(blocks,{article,vertical,span,signal}) {
 const result=[],probe=document.createElement('p');probe.className='reading-layout-probe';
 Object.assign(probe.style,{position:'fixed',visibility:'hidden',pointerEvents:'none',margin:'0',left:'0',top:'0',whiteSpace:'pre-wrap',writingMode:vertical?'vertical-rl':'horizontal-tb',textOrientation:'mixed',width:vertical?'max-content':`${span}px`,height:vertical?`${span}px`:'auto'});
 article.append(probe);
 try {
  for(const block of blocks){
   if(block.kind!=='paragraph'||block.text.length<=16384){result.push(block);continue;}
   for(let start=0;start<block.text.length;){
    if(signal.aborted||!article.isConnected)throw new DOMException('Aborted','AbortError');
    let end=Math.min(block.text.length,start+8192);
    if(end<block.text.length&&/[\uDC00-\uDFFF]/.test(block.text[end]))end--;
    const sample=block.text.slice(start,end);probe.textContent=sample;
    let count=sample.length;
    if(end<block.text.length){const text=probe.firstChild,range=document.createRange();count=measuredReadingCut(sample.length,index=>{range.setStart(text,index);range.setEnd(text,index+1);const bounds=range.getBoundingClientRect();return vertical?bounds.left:bounds.top;},vertical);range.detach();}
    result.push({...block,text:sample.slice(0,count),sourceText:block.text,sourceStart:start,continuation:start>0});start+=count;
    // Yield between bounded layouts, allowing typing, closing and mode changes.
    await new Promise(resolve=>requestAnimationFrame(resolve));
   }
  }
  return result;
 }finally{probe.remove();}
}
