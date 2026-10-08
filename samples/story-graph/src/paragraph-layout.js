import {measuredReadingCut} from './reading-viewport.js';
import {graphemeCuts} from './text-performance.js';
// Match the browser's complete visual rows/columns while retaining canonical offsets.
export function displayPart(text,start,end){
 const raw=text.slice(start,end),separator=raw.endsWith('\r\n')?'\r\n':/[\r\n]$/.test(raw)?raw.slice(-1):'';
 return {start,text:separator?raw.slice(0,-separator.length):raw,separator};
}
export function createParagraphLayouts({blocked,current,apply}){
 const cache=new WeakMap(),jobs=new Map();
 const cancel=()=>{for(const job of jobs.values())job.abort.abort();jobs.clear();};
 const get=node=>cache.get(node)?.parts;
 const queue=(input,node,text)=>{
  if(!node||text.length<=8192||blocked()||!input.isConnected||input.closest('.dialogue-sheet'))return;
  const style=getComputedStyle(input),vertical=style.writingMode.startsWith('vertical');
  const span=vertical?input.clientHeight:input.clientWidth;
  if(span<32)return;
  const key=[vertical,span,...['fontFamily','fontSize','fontWeight','lineHeight','letterSpacing','wordBreak','overflowWrap','padding','boxSizing','tabSize','textOrientation'].map(k=>style[k])].join('|');
  if(cache.get(node)?.key===key||jobs.get(node)?.key===key)return;
  jobs.get(node)?.abort.abort();const job={key,abort:new AbortController()};jobs.set(node,job);
  const probe=document.createElement('div');
  for(const name of ['fontFamily','fontSize','fontWeight','fontStyle','lineHeight','letterSpacing','wordBreak','overflowWrap','padding','boxSizing','tabSize','textOrientation','textAlign'])probe.style[name]=style[name];
  Object.assign(probe.style,{position:'fixed',left:'0',top:'0',visibility:'hidden',pointerEvents:'none',whiteSpace:'pre-wrap',writingMode:style.writingMode,width:vertical?'max-content':`${span}px`,height:vertical?`${span}px`:'auto',margin:'0',border:'0'});
  document.body.append(probe);
  (async()=>{try{
   const parts=[],cut=graphemeCuts(text);
   for(let start=0;start<text.length;){
    if(job.abort.signal.aborted||blocked()||!input.isConnected||current(input)!==node)return;
    let end=Math.min(text.length,start+8192);if(end<text.length)end=cut(end,start);
    probe.textContent=text.slice(start,end);
    if(end<text.length){const range=document.createRange(),content=probe.firstChild;
     const length=measuredReadingCut(content.length,index=>{range.setStart(content,index);range.setEnd(content,index+1);const rect=range.getBoundingClientRect();return vertical?rect.left:rect.top;},vertical);
     end=cut(start+length,start);range.detach();
    }
    parts.push(displayPart(text,start,end));start=end;
    await new Promise(resolve=>requestAnimationFrame(resolve));
   }
   if(job.abort.signal.aborted||blocked()||!input.isConnected||current(input)!==node)return;
   cache.set(node,{key,parts});apply(input,node);
  }finally{probe.remove();if(jobs.get(node)===job)jobs.delete(node);}})();
 };
 return {get,queue,cancel};
}
