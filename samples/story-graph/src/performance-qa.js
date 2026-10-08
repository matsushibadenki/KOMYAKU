// Explicit local QA only. No manuscript, identity, or network telemetry.
export function frameSummary(values) {
 const times=values.filter(value=>Number.isFinite(value)&&value>=0).sort((a,b)=>a-b);
 if(!times.length)return null;
 const percentile=ratio=>times[Math.min(times.length-1,Math.ceil(times.length*ratio)-1)];
 return {samples:times.length,p50:percentile(.5),p95:percentile(.95),max:times.at(-1),over50:times.filter(value=>value>50).length};
}
export async function installPerformanceQA({native,invoke}) {
 if(!native||!await invoke('performance_qa_enabled'))return;
 let frame=null,previous=null,values=[],kind='idle';
 const finish=()=>{const summary=frameSummary(values);if(summary&&summary.samples>=8)invoke('performance_qa_sample',{sample:{...summary,kind,vertical:Boolean(document.querySelector('.vertical-writing')),blocks:document.querySelectorAll('.manuscript-block').length,batches:document.querySelectorAll('.manuscript-batch').length,inputs:document.querySelectorAll('textarea[data-block]').length}}).catch(()=>{});};
 const tick=time=>{if(previous!==null)values.push(time-previous);previous=time;if(values.length>=120){frame=null;finish();return;}frame=requestAnimationFrame(tick);};
 const start=event=>{if(frame!==null){cancelAnimationFrame(frame);finish();}kind=event?.type??'idle';values=[];previous=null;frame=requestAnimationFrame(tick);};
 window.addEventListener('wheel',start,{passive:true});window.addEventListener('resize',start,{passive:true});start();
}
