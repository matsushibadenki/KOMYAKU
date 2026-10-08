import {messages} from './locales.js';
const labels={ja:{resizeNavigator:'構造パネルの幅',resizeInspector:'相関パネルの幅',resizeEditor:'本文パネルの幅',resizeHistory:'履歴パネルの幅',layout_failed:'パネル配置を保存できませんでした。',layout_invalid:'パネルの幅を確認してください。',movePanel:'パネルを移動（ドラッグ、クリックで次の領域）',dockleft:'左へ配置',dockright:'右へ配置',docktop:'上へ配置',dockbottom:'下へ配置',dockcenter:'中央へ配置',floatSidePanel:'パネルを分離',returnSidePanel:'パネルを戻す'},en:{resizeNavigator:'Navigator panel width',resizeInspector:'Relationship panel width',resizeEditor:'Editor panel width',resizeHistory:'History panel width',layout_failed:'Could not save panel layout.',layout_invalid:'Check panel width.',movePanel:'Move panel (drag, or click for next area)',dockleft:'Dock left',dockright:'Dock right',docktop:'Dock top',dockbottom:'Dock bottom',dockcenter:'Dock center',floatSidePanel:'Float panel',returnSidePanel:'Dock panel'},'zh-CN':{resizeNavigator:'导航面板宽度',resizeInspector:'关系面板宽度',resizeEditor:'正文面板宽度',resizeHistory:'历史面板宽度',layout_failed:'无法保存面板布局。',layout_invalid:'请检查面板宽度。',movePanel:'移动面板（拖动或点击切换区域）',dockleft:'停靠左侧',dockright:'停靠右侧',docktop:'停靠顶部',dockbottom:'停靠底部',dockcenter:'停靠中央',floatSidePanel:'分离面板',returnSidePanel:'还原面板'}};
for(const [language,values]of Object.entries(labels))Object.assign(messages[language],values);
const panels={navigator:{selector:'.navigator',label:'resizeNavigator',limits:[180,480]},inspector:{selector:'.relations',label:'resizeInspector',limits:[200,480]},editor:{selector:'.writing',label:'resizeEditor',limits:[320,1200]},history:{selector:'.history-docked',label:'resizeHistory',limits:[240,800]}};
const positions=['left','top','right','bottom','center'];
const sideWindow=new URLSearchParams(globalThis.location?.search??'').get('panel');
let state={navigatorWidth:210,inspectorWidth:235,editorWidth:480,historyWidth:320,historyVisible:false,docks:{navigator:'left',inspector:'right',editor:'center',history:'bottom'}},floatingPanels=[],drag=null,changed=()=>{};
export function historyDocked(){return state.historyVisible&&!floatingPanels.includes('history')&&!sideWindow;}
export function dockGrid(docks,visible={navigator:true,inspector:true,editor:true,history:false}){
 const slots={};for(const panel of Object.keys(panels))if(visible[panel])slots[docks?.[panel]??state.docks[panel]]=panel==='editor'?'writing':panel;
 if(!slots.center&&visible.editor){for(const position of positions)if(slots[position]==='writing')delete slots[position];slots.center='writing';}
 const width=panel=>`var(--${panel==='writing'?'editor':panel}-width)`;
 return {areas:`"${slots.top??'.'} ${slots.top??'.'} ${slots.top??'.'}" "${slots.left??'.'} ${slots.center??'.'} ${slots.right??'.'}" "${slots.bottom??'.'} ${slots.bottom??'.'} ${slots.bottom??'.'}"`,columns:[slots.left?width(slots.left):'0px','minmax(0,1fr)',slots.right?width(slots.right):'0px'].join(' '),rows:[slots.top?'minmax(120px,25%)':'0px','minmax(0,1fr)',slots.bottom?'minmax(120px,25%)':'0px'].join(' ')};
}
export function panelWidth(panel,width){const bounds=panels[panel]?.limits;if(!bounds||!Number.isFinite(width))throw new Error('layout_invalid');return Math.max(bounds[0],Math.min(bounds[1],width));}
export function applyLayout(value){
 const wasHistory=historyDocked();state=value;
 const shell=document.querySelector('.shell'),main=shell?.querySelector('main');
 if(main&&!shell.classList.contains('detached')&&!sideWindow){
  const visible={navigator:!floatingPanels.includes('navigator')&&!shell.classList.contains('left-panel-closed'),inspector:!floatingPanels.includes('inspector')&&!shell.classList.contains('right-panel-closed'),editor:true,history:historyDocked()};
  const grid=dockGrid(state.docks,visible);Object.assign(main.style,{gridTemplateAreas:grid.areas,gridTemplateColumns:grid.columns,gridTemplateRows:grid.rows});
  for(const [panel,{selector}]of Object.entries(panels)){const element=main.querySelector(selector);if(!element)continue;element.hidden=!visible[panel];element.style.gridArea=panel==='editor'?'writing':panel;element.dataset.dock=state.docks[panel];}
 }
 for(const panel of Object.keys(panels)){document.documentElement.style.setProperty(`--${panel}-width`,`${state[`${panel}Width`]}px`);document.querySelector(`[data-panel-divider=${panel}]`)?.setAttribute('aria-valuenow',String(Math.round(state[`${panel}Width`])));}
 if(wasHistory!==historyDocked())changed();
}
function applyFloating(value){const before=historyDocked();floatingPanels=value;applyLayout(state);if(before!==historyDocked())changed();}
export function renderPanelHandles(t,native){
 if(!native)return;applyLayout(state);
 for(const [panel,{selector,label,limits}]of Object.entries(panels)){
  const root=document.querySelector(selector);if(!root||root.querySelector('[data-dock-panel]')||sideWindow&&sideWindow!==panel)continue;
  const node=document.createElement('div');node.className=`panel-divider ${panel}-divider`;node.dataset.panelDivider=panel;node.tabIndex=0;node.setAttribute('role','separator');node.setAttribute('aria-orientation','vertical');node.setAttribute('aria-label',t(label));node.setAttribute('aria-valuemin',String(limits[0]));node.setAttribute('aria-valuemax',String(limits[1]));node.setAttribute('aria-valuenow',String(Math.round(state[`${panel}Width`])));root.append(node);
  const grip=document.createElement('button');grip.className='panel-dock-grip';grip.dataset.dockPanel=panel;grip.draggable=true;grip.textContent='⠿';grip.setAttribute('aria-label',t('movePanel'));grip.title=t('movePanel');root.prepend(grip);
  if(panel==='editor')continue;
  const float=document.createElement('button');float.className='panel-float-grip';float.dataset.floatPanel=panel;float.textContent=sideWindow===panel?'↙':'↗';float.setAttribute('aria-label',t(sideWindow===panel?'returnSidePanel':'floatSidePanel'));float.title=t(sideWindow===panel?'returnSidePanel':'floatSidePanel');root.prepend(float);
 }
}
export function installPanelLayout({invoke,native,t,onChange=()=>{},commit=async()=>true}){
 changed=onChange;
 const showError=error=>{const notice=document.createElement('p');notice.className='layout-notice error';notice.setAttribute('role','alert');notice.textContent=t(String(error));document.body.append(notice);setTimeout(()=>notice.remove(),6000);};
 const dock=async(panel,position)=>{try{if(await commit())applyLayout(await invoke('dock_panel',{panel,position}));}catch(error){showError(error);}};
 const clearDock=()=>document.querySelector('.panel-dock-targets')?.remove();
 document.addEventListener('dragstart',event=>{const grip=event.target.closest('[data-dock-panel]');if(!native||!grip)return;event.dataTransfer.setData('application/komyaku-panel',grip.dataset.dockPanel);event.dataTransfer.effectAllowed='move';const overlay=document.createElement('div');overlay.className='panel-dock-targets';overlay.innerHTML=positions.map(position=>`<div data-dock-position="${position}">${t('dock'+position)}</div>`).join('');document.querySelector('main')?.append(overlay);});
 document.addEventListener('dragover',event=>{const target=event.target.closest('[data-dock-position]');if(!target||!event.dataTransfer.types.includes('application/komyaku-panel'))return;event.preventDefault();event.dataTransfer.dropEffect='move';});
 document.addEventListener('drop',event=>{const target=event.target.closest('[data-dock-position]');if(!target)return;const panel=event.dataTransfer.getData('application/komyaku-panel');if(!panel)return;event.preventDefault();event.stopPropagation();const position=target.dataset.dockPosition;clearDock();dock(panel,position);});document.addEventListener('dragend',clearDock);
 document.addEventListener('click',async event=>{const float=event.target.closest('[data-float-panel]');if(native&&float){try{if(await commit())await invoke('float_side_panel',{panel:float.dataset.floatPanel,floating:sideWindow!==float.dataset.floatPanel});}catch(error){showError(error);}return;}const grip=event.target.closest('[data-dock-panel]');if(!native||!grip)return;const panel=grip.dataset.dockPanel;dock(panel,positions[(positions.indexOf(state.docks[panel])+1)%positions.length]);});
 const persist=async(panel,width)=>{try{applyLayout(await invoke('resize_panel',{panel,width}));}catch(error){showError(error);}};
 document.addEventListener('pointerdown',event=>{const handle=event.target.closest('[data-panel-divider]');if(!native||!handle||event.button!==0)return;event.preventDefault();event.stopPropagation();handle.focus({preventScroll:true});const panel=handle.dataset.panelDivider;drag={panel,start:event.clientX,width:state[`${panel}Width`],pointer:event.pointerId};handle.setPointerCapture(event.pointerId);document.body.classList.add('panel-resizing');});
 document.addEventListener('pointermove',event=>{if(!drag||drag.pointer!==event.pointerId)return;applyLayout({...state,[`${drag.panel}Width`]:panelWidth(drag.panel,drag.width+(event.clientX-drag.start)*(state.docks[drag.panel]==='right'?-1:1))});});
 const finish=event=>{if(!drag||drag.pointer!==event.pointerId)return;const current=drag;drag=null;document.body.classList.remove('panel-resizing');if(event.type==='pointercancel')applyLayout({...state,[`${current.panel}Width`]:current.width});else persist(current.panel,state[`${current.panel}Width`]);};document.addEventListener('pointerup',finish);document.addEventListener('pointercancel',finish);
 document.addEventListener('keydown',event=>{const handle=event.target.closest('[data-panel-divider]');if(!native||!handle||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const panel=handle.dataset.panelDivider,limits=panels[panel].limits;const width=event.key==='Home'?limits[0]:event.key==='End'?limits[1]:panelWidth(panel,state[`${panel}Width`]+(event.key==='ArrowRight'?1:-1)*(state.docks[panel]==='right'?-1:1)*(event.shiftKey?32:8));applyLayout({...state,[`${panel}Width`]:width});persist(panel,width);});
 return async()=>{if(native){floatingPanels=await invoke('floating_panels');await window.__TAURI__.event.listen('story://floating-panels',event=>applyFloating(event.payload));applyLayout(await invoke('get_layout'));}};
}
export async function toggleHistoryPanel(invoke){if(floatingPanels.includes('history')){await invoke('float_side_panel',{panel:'history',floating:true});return;}applyLayout(await invoke('set_history_visibility',{visible:!state.historyVisible}));}
