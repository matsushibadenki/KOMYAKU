import {test,expect} from 'bun:test';
import {readingChunks,measuredReadingCut} from '../src/reading-viewport.js';
test('reading chunks preserve canonical boundaries, Unicode and heading attachment',()=>{
 const blocks=Array.from({length:1000},(_,i)=>({kind:'paragraph',id:i,text:'雨🙂\r\n'.repeat(200)}));blocks.splice(31,0,{kind:'heading',text:'場面'});
 const chunks=readingChunks(blocks);expect(chunks.length).toBeLessThan(50);expect(chunks.flat()).toEqual(blocks);expect(chunks.every(chunk=>chunk.at(-1).kind!=='heading')).toBe(true);expect(chunks.flat().map(block=>block.text).join('')).toBe(blocks.map(block=>block.text).join(''));
 const huge={kind:'paragraph',text:'雨🙂'.repeat(400000)};expect(readingChunks([huge])[0][0]).toBe(huge);
});
test('measured cuts retain the unfinished last visual line in either writing direction',()=>{
 for(const vertical of [false,true]){
  const coordinate=index=>vertical?100-Math.floor(index/7)*20:Math.floor(index/7)*20;
  expect(measuredReadingCut(24,coordinate,vertical)).toBe(21);
  expect(measuredReadingCut(5,coordinate,vertical)).toBe(5);
 }
});
test('resize captures the visible reading anchor and restores either scroll direction',async()=>{
 const {ReadingViewport}=await import('../src/reading-viewport.js');
 for(const vertical of [false,true]){
  const viewport=Object.create(ReadingViewport.prototype);
  const root={scrollTop:100,scrollLeft:-100,getBoundingClientRect:()=>({top:0,bottom:500,left:0,right:500})};
  let bounds={top:-20,bottom:600,left:-100,right:480};
  const node={getBoundingClientRect:()=>bounds};
  const entry={blocks:[{id:'p',text:'abcdef',sourceStart:12}]};
  Object.assign(viewport,{root,vertical,span:500,entries:new Map([[node,entry]]),options:()=>({span:400})});
  let anchor;viewport.reflow=value=>anchor=value;viewport.mount=()=>{};
  viewport.resize();expect(anchor.id).toBe('p');expect(anchor.start).toBe(12);expect(anchor.offset).toBe(-20);
  bounds={top:80,bottom:700,left:0,right:580};viewport.restore(anchor);
  expect(vertical?root.scrollLeft:root.scrollTop).toBe(vertical?0:200);
 }
});
test('copy across virtual paragraphs includes unmounted source once and preserves canonical CRLF',async()=>{
 const {readingSelectionText}=await import('../src/reading-viewport.js');
 const blocks=[{id:'a',text:'雨',sourceText:'雨\r\n駅',sourceStart:0},{id:'a',text:'駅',sourceText:'雨\r\n駅',sourceStart:3},{id:'heading',kind:'heading',text:'次の場面'},{kind:'dialogue',texts:['高橋','こんにちは']},{id:'b',text:'終わり'}];
 const a={id:'a',offset:1},b={id:'b',offset:2};
 expect(readingSelectionText(blocks,a,b)).toBe('\r\n駅\n次の場面\n高橋\tこんにちは\n終わ');
 expect(readingSelectionText(blocks,b,a)).toBe(readingSelectionText(blocks,a,b));
 expect(readingSelectionText(blocks,{id:'a',offset:0},{id:'a',offset:4})).toBe('雨\r\n駅');
 expect(readingSelectionText(blocks,{id:'missing',offset:0},b)).toBeNull();
});
test('reading copy accepts heading and dialogue endpoints in either direction',async()=>{
 const {readingSelectionText}=await import('../src/reading-viewport.js');
 const blocks=[{id:'h',kind:'heading',text:'第一場'},{id:'p',kind:'paragraph',text:'原文'},{id:'d',kind:'dialogue',texts:['高橋','雨\r\n駅😀']}];
 const heading={id:'h',offset:1},dialogue={id:'d',offset:7};
 expect(readingSelectionText(blocks,heading,dialogue)).toBe('一場\n原文\n高橋\t雨\r\n駅');
 expect(readingSelectionText(blocks,dialogue,heading)).toBe('一場\n原文\n高橋\t雨\r\n駅');
 expect(readingSelectionText(blocks,{id:'d',offset:3},{id:'d',offset:9})).toBe('雨\r\n駅😀');
});
test('reading resize retains a visible canonical character across changed chunk boundaries',async()=>{
 const {ReadingViewport}=await import('../src/reading-viewport.js');
 const previous=globalThis.document;let changed=false,rangeStart=0;
 globalThis.document={createRange:()=>({setStart:(_,index)=>rangeStart=index,setEnd(){},detach(){},getBoundingClientRect:()=>changed?{left:570,right:580,top:0,bottom:20}:rangeStart<3?{left:600,right:610,top:0,bottom:20}:{left:480,right:490,top:0,bottom:20}})};
 try {
  const root={scrollLeft:-100,getBoundingClientRect:()=>({left:0,right:500,top:0,bottom:500})};
  const element={dataset:{readingBlock:'p',readingStart:'0'},firstChild:{nodeType:3,length:7,data:'aa\nbbcc'},getBoundingClientRect:()=>({left:0,right:700,top:0,bottom:500})};
  const node={getBoundingClientRect:element.getBoundingClientRect,querySelectorAll:()=>[element]};
  const viewport=Object.create(ReadingViewport.prototype);Object.assign(viewport,{root,vertical:true,entries:new Map([[node,{blocks:[{id:'p',kind:'paragraph',text:'aa\r\nbbcc'}]}]])});
  const anchor=viewport.anchor();expect(anchor.start).toBe(4);expect(anchor.offset).toBe(-10);expect(anchor.character).toBe(true);
  changed=true;element.dataset.readingStart='4';element.firstChild={nodeType:3,length:4,data:'bbcc'};
  viewport.entries=new Map([[node,{blocks:[{id:'p',kind:'paragraph',sourceStart:4,text:'bbcc'}]}]]);viewport.mount=()=>{};
  viewport.restore(anchor);expect(root.scrollLeft).toBe(-10);
 }finally{globalThis.document=previous;}
});
