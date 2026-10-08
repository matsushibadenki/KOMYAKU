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
