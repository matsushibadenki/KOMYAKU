import {messages} from './locales.js';
for(const [language,values] of Object.entries({ja:{zoomIn:'拡大',zoomOut:'縮小',fit:'全体表示',pan:'手のひら'},en:{zoomIn:'Zoom in',zoomOut:'Zoom out',fit:'Fit all',pan:'Pan'},'zh-CN':{zoomIn:'放大',zoomOut:'缩小',fit:'显示全部',pan:'平移'}}))Object.assign(messages[language],values);
// The WebView sends bounds and gestures; Rust retains all pixels and scene data.
export function installDockedGraph({invoke,native,revision,onError}){
 let last='',frame=0,queue=Promise.resolve(),gesture=null,move=null,moveFrame=0;
 const send=(command,args)=>{queue=queue.catch(()=>{}).then(()=>invoke(command,args)).catch(error=>{onError(String(error));});return queue;};
 const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{
  const root=document.querySelector('[data-docked-graph]');const blocked=document.querySelector('dialog[open],.app-menu[open],.outline-context-menu');
  const rect=root?.getBoundingClientRect();const bounds=rect&&!blocked&&rect.width>=1&&rect.height>=1?{x:Math.max(0,rect.x),y:Math.max(0,rect.y),width:rect.width,height:rect.height}:null;
  const key=JSON.stringify(bounds);if(key===last)return;last=key;send('docked_graph_bounds',{bounds});
 });};
 const pointer=event=>{const rect=document.querySelector('[data-docked-graph]')?.getBoundingClientRect();return rect?[event.clientX-rect.x,event.clientY-rect.y]:null;};
 const dispatch=(event,expectedRevision)=>send('docked_graph_pointer',{event,expectedRevision});
 const flushMove=()=>{cancelAnimationFrame(moveFrame);moveFrame=0;if(move&&gesture){dispatch(move,gesture.revision);move=null;}};
 if(native){
  document.addEventListener('click',event=>{const button=event.target.closest('[data-docked-action]');if(!button)return;const kind=button.dataset.dockedAction;send('graph_action',{action:kind==='zoom'?{kind,factor:Number(button.dataset.factor)}:{kind},expectedRevision:revision()});});
  document.addEventListener('wheel',event=>{if(!event.target.closest('[data-docked-graph]'))return;event.preventDefault();const multiplier=event.deltaMode===1?18:event.deltaMode===2?400:1;send('docked_graph_scroll',{delta:[event.deltaX*multiplier,event.deltaY*multiplier],position:pointer(event),zoom:event.ctrlKey||event.metaKey});},{passive:false});
  new ResizeObserver(resize).observe(document.documentElement);
  new MutationObserver(resize).observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['open','class','style','hidden']});
  document.addEventListener('pointerdown',event=>{const root=event.target.closest('[data-docked-graph]');if(!root||event.button>1)return;event.preventDefault();root.setPointerCapture(event.pointerId);gesture={pointer:event.pointerId,revision:revision()};dispatch({kind:'down',pointer:event.pointerId,position:pointer(event),button:event.button===1?'pan':'primary',additive:event.shiftKey},gesture.revision);});
  document.addEventListener('pointermove',event=>{if(!gesture||gesture.pointer!==event.pointerId)return;move={kind:'move',pointer:event.pointerId,position:pointer(event)};if(!moveFrame)moveFrame=requestAnimationFrame(flushMove);});
  const finish=event=>{if(!gesture||gesture.pointer!==event.pointerId)return;flushMove();dispatch(event.type==='pointercancel'?{kind:'cancel'}:{kind:'up',pointer:event.pointerId,position:pointer(event)},gesture.revision);gesture=null;};
  document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
 }
 return resize;
}
