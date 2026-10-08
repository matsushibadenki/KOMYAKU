// Keep lightweight positions in the flow; native text controls exist near the
// viewport only. Canonical text and editing history belong to the Rust document.
// Scan Unicode code points without split/spread arrays proportional to manuscript
// length. CRLF is one explicit line break, including an empty trailing line.
export function lineMetrics(text,capacity=Infinity) {
  let lines=0,length=0,longest=0,cr=false;
  const finish=()=>{lines+=Math.max(1,Math.ceil(length/capacity));longest=Math.max(longest,length);length=0;};
  for(const character of text){
    if(character==='\n'&&cr){cr=false;continue;}
    if(character==='\r'||character==='\n'){finish();cr=character==='\r';}
    else {length++;cr=false;}
  }
  finish();return {lines,longest};
}
export function estimatedExtent(text,{vertical,span,fontSize,lineHeight}) {
  const capacity=Math.max(1,Math.floor(span/fontSize));
  const {lines}=lineMetrics(text,capacity);
  return Math.max(fontSize*lineHeight,lines*fontSize*lineHeight+(vertical?0:2));
}
export function estimatedDialogueExtent([actor='',dialogue=''],options) {
  const {span,fontSize}=options;
  const natural=Math.max(1,lineMetrics(actor).longest)*fontSize+16;
  const actorSpan=Math.max(16,Math.min(options.actorWidth||natural,Math.max(16,span-32)));
  return Math.max(estimatedExtent(actor,{...options,span:actorSpan}),estimatedExtent(dialogue,{...options,span:Math.max(1,span-actorSpan-16)}));
}

export class ManuscriptViewport {
  constructor({root,blocks,source,estimate,measure,pinned,vertical}) {
    Object.assign(this,{source,estimate,measure,pinned,vertical});
    this.entries=new Map();this.paragraphs=new WeakMap();this.frame=null;
    this.observer=new IntersectionObserver(entries=>{
      for(const {target,isIntersecting} of entries){
        const entry=this.entries.get(target);if(!entry)continue;
        entry.visible=isIntersecting;target.classList.toggle('block-visible',isIntersecting);
        if(isIntersecting){this.mount(target);this.measureBlock(target);}else this.unmount(target);
      }
    },{root,rootMargin:'800px'});
    blocks.forEach(block=>this.register(block));
  }
  register(block) {
    if(this.entries.has(block))return;
    const entry={visible:false,extent:this.estimate(block),html:null};
    this.entries.set(block,entry);
    if(block.dataset.paragraph){
      const scope=block.closest('.manuscript');let groups=this.paragraphs.get(scope);
      if(!groups){groups=new Map();this.paragraphs.set(scope,groups);}
      const peers=groups.get(block.dataset.paragraph)??[];peers.push(block);groups.set(block.dataset.paragraph,peers);
    }
    if(!block.firstElementChild)this.placeholder(block,entry);
    this.observer.observe(block);
  }
  placeholder(block,entry) {
    block.classList.add('virtual-placeholder');
    block.style[this.vertical?'width':'height']=`${entry.extent}px`;
  }
  mount(block) {
    const entry=this.entries.get(block);if(!entry||block.firstElementChild)return;
    block.innerHTML=entry.html??this.source(block);
    if(block.dataset.paragraph){const input=block.querySelector('textarea');input.dataset.start=block.dataset.start;input.dataset.length=block.dataset.length;}
    block.classList.remove('virtual-placeholder');
    block.style[this.vertical?'width':'height']='';
  }
  measureBlock(block) {
    const entry=this.entries.get(block);if(!entry||!block.firstElementChild)return;
    this.measure(block);
    entry.extent=Math.max(1,this.vertical?block.getBoundingClientRect().width:block.getBoundingClientRect().height);
    this.capture(block,entry);
  }
  capture(block,entry) {
    this.syncBlock(block);
    entry.values=[...block.querySelectorAll('textarea')].map(input=>input.value);
    entry.actorWidth=Number(block.querySelector('.dialogue-sheet')?.dataset.width)||undefined;
  }
  syncBlock(block) {
    if(!block.dataset.paragraph)return;
    const input=block.querySelector('textarea');if(input){block.dataset.start=input.dataset.start;block.dataset.length=input.dataset.length;}
  }
  paragraphBlocks(input) {return this.paragraphs.get(input.closest('.manuscript'))?.get(input.dataset.block)??[];}
  positionInput(input,position) {
    const peers=this.paragraphBlocks(input);
    const block=peers.find(block=>position>=Number(block.dataset.start)&&position<=Number(block.dataset.start)+Number(block.dataset.length))??peers.find(block=>Number(block.dataset.start)>position)??peers.at(-1);
    if(!block)return input;this.mount(block);this.pruneSoon();return block.querySelector('textarea');
  }
  shiftOffsets(input,delta) {
    if(input.closest('.dialogue-sheet'))return;
    this.syncBlock(input.closest('.manuscript-block'));
    const start=Number(input.dataset.start);
    for(const block of this.paragraphBlocks(input)){
      if(Number(block.dataset.start)<=start)continue;
      block.dataset.start=String(Number(block.dataset.start)+delta);
      const peer=block.querySelector('textarea');if(peer)peer.dataset.start=block.dataset.start;
    }
  }
  unmount(block) {
    const entry=this.entries.get(block);
    if(!entry||entry.visible||this.pinned(block)||!block.firstElementChild)return;
    // Textarea's value property is not reflected in innerHTML automatically.
    // Preserve normalized display text and updated canonical start/length attrs.
    block.querySelectorAll('textarea').forEach(input=>{input.textContent=input.value;input.classList.remove('paragraph-selected');});
    this.capture(block,entry);
    block.querySelectorAll('.paragraph-range-highlight,.empty-column-caret').forEach(el=>el.remove());
    entry.html=block.innerHTML;block.replaceChildren();this.placeholder(block,entry);
  }
  replacementParts(input,text) {
    if(input.closest('.dialogue-sheet'))return [{input,block:input.closest('.manuscript-block'),start:0,text}];
    return this.paragraphBlocks(input).map(block=>{
      const start=Number(block.dataset.start),length=Number(block.dataset.length);
      return {block,input:block.querySelector('textarea'),start,length,get text(){return text.slice(start,start+length);}};
    });
  }
  updateFragment(block,part) {
    block.dataset.start=String(part.start);
    if(part.unchanged)return;
    block.dataset.length=String(part.text.length);
    const entry=this.entries.get(block);if(!entry)return;
    entry.html=null;entry.values=[part.text.replace(/\r\n?/g,'\n')];
    if(!block.firstElementChild){entry.extent=this.estimate(block,entry.values);this.placeholder(block,entry);}
  }
  paragraphInputs(input) {
    if(input.closest('.dialogue-sheet'))return [input];
    const peers=this.paragraphBlocks(input);for(const block of peers)this.mount(block);
    this.pruneSoon();
    return peers.map(block=>block.querySelector('textarea'));
  }
  pruneSoon() {
    if(this.frame!==null)return;
    this.frame=requestAnimationFrame(()=>{this.frame=null;for(const block of this.entries.keys())this.unmount(block);});
  }
  resize() {
    for(const [block,entry] of this.entries){
      if(entry.visible||this.pinned(block))this.measureBlock(block);
      else {entry.extent=this.estimate(block,entry.values,entry.actorWidth);if(!block.firstElementChild)this.placeholder(block,entry);}
    }
  }
  remove(block) {
    this.observer.unobserve(block);this.entries.delete(block);
    const peers=this.paragraphs.get(block.closest('.manuscript'))?.get(block.dataset.paragraph);
    if(peers){const index=peers.indexOf(block);if(index>=0)peers.splice(index,1);}
  }
  disconnect() {this.observer.disconnect();if(this.frame!==null)cancelAnimationFrame(this.frame);this.entries.clear();this.paragraphs=new WeakMap();}
}
