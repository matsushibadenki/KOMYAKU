import {test,expect} from 'bun:test';
import {estimatedExtent,estimatedDialogueExtent} from '../src/manuscript-viewport.js';

test('viewport estimates account for empty lines, CRLF and Unicode in both writing directions',()=>{
  const options={span:100,fontSize:20,lineHeight:1.5};
  expect(estimatedExtent('雨'.repeat(11),{...options,vertical:false})).toBe(92);
  expect(estimatedExtent('雨'.repeat(11),{...options,vertical:true})).toBe(90);
  expect(estimatedExtent('🌕🌕🌕🌕🌕\r\n\r\n雨',{...options,vertical:false})).toBe(92);
  expect(estimatedExtent('',{...options,vertical:true})).toBe(30);
  expect(estimatedExtent('雨雨',{...options,span:0,vertical:true})).toBe(60);
});
test('dialogue estimates include both cells, manual actor width and multiline names',()=>{
  const options={span:200,fontSize:20,lineHeight:1.5,actorWidth:80};
  expect(estimatedDialogueExtent(['役者','雨'.repeat(11)],{...options,vertical:false})).toBe(92);
  expect(estimatedDialogueExtent(['役者','雨'.repeat(11)],{...options,vertical:true})).toBe(90);
  expect(estimatedDialogueExtent(['役者\n\n役者',''],{...options,vertical:false})).toBe(92);
  expect(estimatedDialogueExtent(['',''],{...options,vertical:true})).toBe(30);
  expect(estimatedDialogueExtent(['役者','雨'.repeat(11)],{...options,vertical:true,actorWidth:120})).toBeGreaterThan(90);
});

test('selection preparation reads a million-character paragraph without mounting offscreen inputs',async()=>{
  const {ManuscriptViewport}=await import('../src/manuscript-viewport.js');
  const {fragments}=await import('../src/text-performance.js');
  const scope={},text=('雨'.repeat(8190)+'\r\n').repeat(122),parts=fragments(text);
  const input={dataset:{block:'p'},closest:selector=>selector==='.manuscript'?scope:null};
  let queries=0;
  const blocks=parts.map((part,index)=>({dataset:{start:String(part.start),length:String(part.text.length)},querySelector:()=>{queries++;return index===0?input:null;}}));
  const viewport=Object.create(ManuscriptViewport.prototype);
  viewport.paragraphs=new WeakMap([[scope,new Map([['p',blocks]])]]);
  viewport.mount=()=>{throw Error('offscreen input must not be mounted');};
  const captured=viewport.replacementParts(input,text);
  expect(captured.length).toBe(parts.length);
  expect(captured.filter(part=>part.input).length).toBe(1);
  expect(queries).toBe(parts.length);
  for(const part of captured)expect(part.text).toBe(text.slice(part.start,part.start+part.text.length));
});
test('composition updates an unmounted placeholder and invalidates its stale markup',async()=>{
  const {ManuscriptViewport}=await import('../src/manuscript-viewport.js');
  for(const vertical of [false,true]){
    const block={dataset:{start:'10',length:'20'},style:{},firstElementChild:null,classList:{add(){}}};
    const entry={html:'stale',extent:10};
    const viewport=Object.create(ManuscriptViewport.prototype);
    viewport.vertical=vertical;viewport.entries=new Map([[block,entry]]);
    viewport.estimate=(_,values)=>values[0].length*20;
    viewport.updateFragment(block,{start:2,text:'雨\r\n次'});
    expect(block.dataset.start).toBe('2');expect(block.dataset.length).toBe('4');
    expect(entry.html).toBeNull();expect(entry.values).toEqual(['雨\n次']);
    expect(block.style[vertical?'width':'height']).toBe('60px');
  }
});

test('extent scan preserves CRLF, lone CR, astral characters and empty trailing lines without text arrays',async()=>{
 const {lineMetrics}=await import('../src/manuscript-viewport.js');
 for(const text of ['', '\r\n', 'a\rb\n', '😀😀😀\r\nx', 'a\r\r\nb'])for(const capacity of [1,2,100]){const lines=text.split(/\r\n?|\n/).reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].length/capacity)),0);expect(lineMetrics(text,capacity).lines).toBe(lines);}
 expect(lineMetrics('😀'.repeat(500000),100).lines).toBe(5000);
});
