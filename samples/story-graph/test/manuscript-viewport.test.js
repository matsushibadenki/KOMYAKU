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
test('unmount retains edited values and width without serializing manuscript HTML',async()=>{
 const {ManuscriptViewport}=await import('../src/manuscript-viewport.js');
 const input={value:'更新\n😀',dataset:{start:'8',length:'6'}};
 let mounted=true,htmlReads=0;
 const sheet={dataset:{width:'93'}};
 const block={dataset:{paragraph:'p',start:'0',length:'4'},style:{},classList:{add(){},remove(){}},get firstElementChild(){return mounted?{}:null;},get innerHTML(){htmlReads++;throw Error('must not serialize');},set innerHTML(value){mounted=true;input.value='stale';},querySelector:s=>s==='textarea'?input:s==='.dialogue-sheet'?sheet:null,querySelectorAll:s=>s==='textarea'?[input]:[],replaceChildren(){mounted=false;}};
 const entry={visible:false,extent:40};
 const viewport=Object.create(ManuscriptViewport.prototype);Object.assign(viewport,{entries:new Map([[block,entry]]),pinned:()=>false,source:()=>'<textarea>stale</textarea>',vertical:false});
 viewport.unmount(block);expect(htmlReads).toBe(0);expect(entry.values).toEqual(['更新\n😀']);expect(block.firstElementChild).toBeNull();
 viewport.mount(block);expect(input.value).toBe('更新\n😀');expect(input.dataset.start).toBe('8');expect(input.dataset.length).toBe('6');expect(sheet.dataset.width).toBe('93');
});

test('offscreen batches reduce attached placeholders and retain paragraph lookup and pinned edits',async()=>{
 const {ManuscriptViewport}=await import('../src/manuscript-viewport.js');
 const previousDocument=globalThis.document,previousObserver=globalThis.IntersectionObserver;
 const observers=[];
 class Node {
  constructor(fragment=false){this.fragment=fragment;this.children=[];this.dataset={};this.style={};this.classes=new Set();this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};}
  get parentElement(){return this.parent?.fragment?null:this.parent??null;}
  get firstChild(){return this.children[0]??null;}
  get firstElementChild(){return this.firstChild;}
  append(node){if(node.fragment){for(const child of [...node.children])this.append(child);return;}node.remove();this.children.push(node);node.parent=this;}
  remove(){if(this.parent){this.parent.children.splice(this.parent.children.indexOf(this),1);this.parent=null;}}
  before(node){const parent=this.parent,index=parent.children.indexOf(this);node.remove();parent.children.splice(index,0,node);node.parent=parent;}
  closest(){return this.parent?.closest()??null;}
  replaceChildren(){for(const child of [...this.children])child.remove();}
  querySelector(){return this.input??null;}
  querySelectorAll(){return this.input?[this.input]:[];}
  set innerHTML(value){this.append(new Node());this.input={value,dataset:{block:this.dataset.paragraph},closest:()=>scope};}
 }
 const scope=new Node(),parent=new Node();scope.closest=()=>scope;scope.append(parent);
 const blocks=Array.from({length:96},(_,index)=>{const block=new Node();block.dataset={paragraph:'p',manuscriptBlock:`scene:p-${index}`,start:String(index*4),length:'4'};parent.append(block);return block;});
 globalThis.document={createElement:()=>new Node(),createDocumentFragment:()=>new Node(true)};
 globalThis.IntersectionObserver=class{constructor(callback){this.callback=callback;this.observed=new Set();observers.push(this);}observe(node){this.observed.add(node);}unobserve(node){this.observed.delete(node);}disconnect(){this.observed.clear();}};
 let pinned=null;
 try {
  const viewport=new ManuscriptViewport({root:parent,blocks,vertical:false,estimate:()=>20,source:()=> '雨😀',measure:()=>{},pinned:block=>block===pinned});
  expect(parent.children.length).toBe(3);expect(parent.children.every(group=>group.children.length===0)).toBe(true);
  expect(viewport.container(blocks[80])).toBe(parent);expect(viewport.findBlock('scene:p-80')).toBe(blocks[80]);expect(viewport.findParagraphFragment('p',320,'scene')).toBe(blocks[80]);expect(viewport.findParagraphFragment('p',320,'other')).toBeNull();
  viewport.mount(blocks[80]);expect(parent.children[2].children.length).toBe(32);expect(blocks[80].input.value).toBe('雨😀');
  expect(viewport.paragraphBlocks(blocks[80].input).length).toBe(96);
  pinned=blocks[80];const group=viewport.blockGroups.get(pinned);viewport.collapseGroup(group);expect(group.collapsed).toBe(false);
  pinned=null;viewport.collapseGroup(group);expect(group.collapsed).toBe(true);expect(group.node.style.height).toBe('640px');
  viewport.mount(blocks[80]);expect(blocks[80].input.value).toBe('雨😀');
  viewport.remove(blocks[0]);blocks[0].remove();expect(viewport.paragraphBlocks(blocks[80].input).length).toBe(95);
  expect(viewport.groups.get(parent.children[0]).node.style.height).toBe('620px');
  viewport.disconnect();expect(observers.every(observer=>observer.observed.size===0)).toBe(true);
 }finally{globalThis.document=previousDocument;globalThis.IntersectionObserver=previousObserver;}
});
