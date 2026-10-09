// Explicit local QA only. No manuscript, identity, or network telemetry.
export function frameSummary(values) {
 const times=values.filter(value=>Number.isFinite(value)&&value>=0).sort((a,b)=>a-b);
 if(!times.length)return null;
 const percentile=ratio=>times[Math.min(times.length-1,Math.ceil(times.length*ratio)-1)];
 return {samples:times.length,p50:percentile(.5),p95:percentile(.95),max:times.at(-1),over50:times.filter(value=>value>50).length};
}
// Separate from the frame window: a scroll event must not erase paste latency.
export function eventLatencyProbe({now=()=>performance.now(),schedule=requestAnimationFrame,report}) {
 const pending=new Map();
 return kind=>{
  if(!['wheel','resize','scroll','input','paste'].includes(kind)||pending.has(kind))return;
  const began=now();pending.set(kind,began);
  schedule(()=>{pending.delete(kind);const milliseconds=now()-began;if(Number.isFinite(milliseconds)&&milliseconds>=0&&milliseconds<=60000)report({kind,milliseconds});});
 };
}
export async function installPerformanceQA({native,invoke}) {
 if(!native||!await invoke('performance_qa_enabled'))return;
 const latency=eventLatencyProbe({report:sample=>invoke('performance_qa_latency',sample).catch(()=>{})});
 let frame=null,previous=null,values=[],kind='idle';
 const finish=()=>{const summary=frameSummary(values);if(summary&&summary.samples>=8)invoke('performance_qa_sample',{sample:{...summary,kind,vertical:Boolean(document.querySelector('.vertical-writing')),blocks:document.querySelectorAll('.manuscript-block,.rich-editor .ProseMirror p,.rich-editor .ProseMirror h1,.rich-editor .ProseMirror h2').length,batches:document.querySelectorAll('.manuscript-batch').length,inputs:document.querySelectorAll('textarea[data-block],.rich-editor .ProseMirror').length}}).catch(()=>{});};
 const tick=time=>{if(previous!==null)values.push(time-previous);previous=time;if(values.length>=120){frame=null;finish();return;}frame=requestAnimationFrame(tick);};
 const start=event=>{const next=event?.type??'idle';latency(next);if(frame!==null&&kind===next)return;if(frame!==null){cancelAnimationFrame(frame);finish();}kind=next;values=[];previous=null;frame=requestAnimationFrame(tick);};
 window.addEventListener('wheel',start,{passive:true});window.addEventListener('resize',start,{passive:true});window.addEventListener('scroll',start,{passive:true,capture:true});window.addEventListener('input',start,{passive:true,capture:true});window.addEventListener('paste',start,{passive:true,capture:true});start();
}
