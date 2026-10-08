import {hitTextPosition} from './text-hit.js';
import {mountGraphTools} from './graph-tools.js';
import {createParagraphLayouts} from './paragraph-layout.js';
import {installDockedGraph} from './docked-graph.js';
import {installPerformanceQA} from './performance-qa.js';
import { applyRemoteParagraphs } from './remote-paragraphs.js';
import {installPanelLayout,applyLayout,renderPanelHandles,historyDocked,toggleHistoryPanel} from './panel-layout.js';
import {openNarrative} from './narrative.js';
import './style.css';
import {mountHistory} from './history.js';
let disposeHistory;
let embeddedGraph=false;
let dockedGraphTools=[];
let syncDockedGraph=()=>{};
let caretQA=false;
import { fragments, inputPatch, characters, graphemeStep, canonicalPosition } from './text-performance.js';
import {selectionRange,extendSelection,fragmentSelection,replaceSelectionFragments,pointSelection} from './paragraph-selection.js';
import {documentRange,documentSelectionText,documentLeafRange,replaceDocumentSelection,moveDocumentPoint} from './document-selection.js';
import {ReadingViewport,boundedReadingBlocks} from './reading-viewport.js';
let readingLayoutAbort=null;
import {ManuscriptViewport,estimatedExtent,estimatedDialogueExtent} from './manuscript-viewport.js';
import { paragraphText, insertDialogue, updateParagraph, setDialogueWidth, paragraphById } from './dialogue.js';
import { messages, languages } from './locales.js';
import { canonicalText, routeNodes, relatedPeople, outlineNodes, outlineDrop, containedScenes } from './adapter.js';
import preview from './preview.json';
import { defaultPreferences, applyPreferences } from './preferences.js';
import { installAssistant } from './assistant.js';
import './ai-locales.js';
import './character-locales.js';
import './export-locales.js';
import {pdfSettings} from './pdf-settings.js';
import {exportScope,openSearch} from './workflow-dialogs.js';
import {openPaths} from './path-dialog.js';
import {restructureScene} from './scene-operations.js';
import {cropPortrait} from './portrait-crop.js';
let preferences = {...defaultPreferences};
let chatgpt = {pending:false,accounts:[],error:null}, authBusy=false;
let preferenceTimer, pendingPreferences = null;
let preferencesTab = 'languageSettings', preferencesOpen = false, preferencesError = '', preferencesSaving = false;
const native = Boolean(window.__TAURI__);
let diskDirty=false;
const invoke = async(command,args={}) => {const result=await window.__TAURI__.core.invoke(command,args);if(command==='edit'||command==='save_now'){diskDirty=result.saved===false;if(diskDirty)error='save_failed';}return result;};
const openAssistant=installAssistant({invoke,native,t:key=>t(key),escape:value=>escape(value),getLanguage:()=>language,getScene:()=>detail?.type_id==='story.scene'?{id:detail.id,revision:model.revision,selection:bodyCaret?.scene===detail.id&&bodyCaret.end>bodyCaret.start?{paragraph:bodyCaret.id,start:bodyCaret.start,end:bodyCaret.end}:null}:null,refresh,commit:commitDraft,settings:()=>{preferencesTab='ai';showPreferences();}});
syncDockedGraph=installDockedGraph({invoke,native,revision:()=>model?.revision??0,onError:value=>{error=value;const notice=document.querySelector('.notice span');if(notice)notice.textContent=t(value);if(value==='gpu_unavailable'){embeddedGraph=false;render();invoke('canvas').catch(()=>{});}}});
const loadPanelLayout=installPanelLayout({invoke,native,t:key=>t(key),commit:commitDraft,onChange:()=>{if(model&&!composing)render();}});
const panelWindow = new URLSearchParams(location.search).get('panel');
const floatingWindow = panelWindow === 'editor';
if(['navigator','inspector','history'].includes(panelWindow))document.body.dataset.panelWindow=panelWindow;
let language = localStorage.getItem('story-language') || 'ja';
if (!messages[language]) language = 'ja';
let readingViewport=null;
let model = null, detail = null, tab = panelWindow==='history'?'history':'scenes', path = 'main', reading = false, floating = false;
let busy = false, draft = null, status = native ? 'saved' : '', error = '', backupPath = '';
let latestDetail=null, composing=false, compositionTarget=null, bodyCaret=null, widthDrag=null;
let pendingRemote = null, autosaveTimer, draftVersion=0, commitInFlight=null;
let displayedWindowTitle = null;
const collapsedOutline = new Set();
const expandedNotes = new Set();
let draggingOutlineId=null;
let renderedDetailId;
const pendingParagraphs=new Map();
let paragraphSelection=null,reflowing=false;
let documentSelection=null,documentReplacement=null;
let manuscriptSizeObserver=null,manuscriptSizeFrame=0;
const selectionReplacements=new WeakMap(),compositionReflow=new WeakSet();
let paintingSelection=false;
let pointerSelection=null;
let wholeCanonicalDraft=false;
let manuscriptViewport=null;
let lazyManuscript=false;
const virtualSources=new Map();
let groupDetails=[], groupFocus=null;
const groupEdits=new Map();
const titleEdits=new Map();
const isContainer=()=>['story.block','story.sequence'].includes(detail?.type_id);
const writingScene=()=>detail?.type_id==='story.scene'?detail:groupDetails.find(scene=>scene.id===groupFocus);
const inputScene=input=>input?.closest?.('[data-scene]')?.dataset.scene;
const t = key => messages[language][key] || messages[language].error;
const pathLabel = route => route.legacy&&route.name===route.legacy?t(route.name):route.name;
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${{leftPanel:'M3 4h18v16H3z M9 4v16',rightPanel:'M3 4h18v16H3z M15 4v16',block:'M3 6h7l2 3h9v12H3z M3 6V3h7l2 3',sequence:'M3 6h7l2 3h9v12H3z M3 6V3h7l2 3 M7 14h10 M7 17h10',scene:'M6 3h12v18H6z M9 8h6 M9 12h6',graph:'M5 6h4v4H5z M15 14h4v4h-4z M9 8h6v8 M5 17h4v4H5z M9 19h6',undo:'M9 5 4 10l5 5 M4 10h9a6 6 0 0 1 6 6',redo:'m15 5 5 5-5 5 M20 10h-9a6 6 0 0 0-6 6',add:'M12 5v14 M5 12h14',float:'M14 3h7v7 M21 3l-9 9 M10 3H3v18h18v-7',book:'M12 5v16 M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2',person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',backup:'M12 3v12 m-4-4 4 4 4-4 M4 16v5h16v-5',trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7'}[name] || ''}"/></svg>`;
function button(action,label,ico,disabled=false,kind='') { return `<button class="${kind}" data-action="${action}" ${disabled?'disabled':''}>${ico?icon(ico):''}<span>${escape(t(label))}</span></button>`; }
function menu(label,items) {return `<details class="app-menu"><summary>${escape(t(label))}</summary><div class="menu-popup">${items.join('')}</div></details>`;}
function exportMenu() {
  const option=(format,label)=>`<button data-action="export" data-format="${format}" ${!native||busy?'disabled':''}>${escape(t(label))}</button>`;
  return `<details class="export-submenu"><summary>${escape(t('export'))}<span aria-hidden="true">›</span></summary><div class="export-popup">${option('txt','exportText')}${option('md','exportMarkdown')}<button data-action="exportGraph" data-format="png" ${!native||busy?'disabled':''}>${escape(t('exportGraphPng'))}</button><button data-action="exportGraph" data-format="pdf" ${!native||busy?'disabled':''}>${escape(t('exportGraphPdf'))}</button><details class="export-submenu pdf-submenu"><summary>${escape(t('exportPdf'))}<span aria-hidden="true">›</span></summary><div class="export-popup">${option('pdf','exportPdfStandard')}${option('script','exportScript')}<small><span>${escape(t('exportPdfLayout'))}</span><span>${escape(t('exportScriptLayout'))}</span></small></div></details><small>${escape(t('exportScope'))}</small></div></details>`;
}
function closeMenus() { document.querySelectorAll('.app-menu[open],.export-submenu[open]').forEach(menu=>menu.open=false); }
function field(key,label,value,multiline=false) { return `<label class="field">${escape(t(label))}${multiline?`<textarea data-field="${key}" rows="${key==='text'?16:5}" ${native?'':'readonly'}>${escape(value)}</textarea>`:`<input data-field="${key}" value="${escape(value)}" maxlength="200" ${native?'':'readonly'}>`}</label>`; }
function draftBase(key) { return key==='canonical'?detail.properties.canonical:key==='projectTitle' ? model.projectTitle??'' : key==='text'?canonicalText(detail.properties.canonical):(detail?.properties[key]??''); }
function primaryDirty() { return draft && Object.entries(draft).some(([key,value])=>value!==draftBase(key)); }
function localDirty() { return primaryDirty() || groupEdits.size>0 || titleEdits.size>0; }
function dirty() { return localDirty() || diskDirty; }
async function loadDetail(id) {
  detail = id ? (native ? await invoke('selected',{id}) : preview.details[id]) : null;
  draft=null;pendingParagraphs.clear();wholeCanonicalDraft=false;groupEdits.clear();titleEdits.clear();
  groupDetails=isContainer()?await Promise.all(containedScenes(model.nodes,id).map(node=>native?invoke('selected',{id:node.id}):preview.details[node.id])):[];
  if(!groupDetails.some(scene=>scene.id===groupFocus))groupFocus=groupDetails[0]?.id??null;
}
async function refresh() { model = native ? await invoke('workspace') : preview; await loadDetail(model.selected); pendingRemote=null; render(); }
function render() {
  for(const tools of dockedGraphTools)tools.dispose();dockedGraphTools=[];
  paragraphLayouts.cancel();
  readingLayoutAbort?.abort();
  if(model?.paths?.length&&!model.paths.some(p=>p.key===path))path=model.paths[0].key;

  disposeHistory?.();disposeHistory=null;
  clearParagraphSelection();
  closeOutlineMenu();
  readingViewport?.disconnect();readingViewport=null;
  manuscriptViewport?.disconnect();manuscriptViewport=null;virtualSources.clear();
  manuscriptSizeObserver?.disconnect();manuscriptSizeObserver=null;cancelAnimationFrame(manuscriptSizeFrame);
  const reopenPreferences = preferencesOpen;
  applyPreferences(preferences);
  const preserveScroll=renderedDetailId===detail?.id;
  const editorScroll=preserveScroll?document.querySelector('.editor-content')?.scrollTop||0:0;
  const sceneScroll=preserveScroll?document.querySelector('.scene-writing .manuscript-pages')?.scrollLeft||0:0;
  const groupViewportBefore=preserveScroll?document.querySelector('.group-manuscript'):null;
  const groupScroll={left:groupViewportBefore?.scrollLeft||0,top:groupViewportBefore?.scrollTop||0};
  const listScroll=document.querySelector('.node-list')?.scrollTop||0;
  renderedDetailId=detail?.id;
  const active=document.activeElement;
  const cursor=active?.dataset?.block ? {scene:inputScene(active),block:active.dataset.block,fragment:active.dataset.fragment,start:active.selectionStart,end:active.selectionEnd} : active?.dataset?.outlineTitle ? {title:active.dataset.outlineTitle,start:active.selectionStart,end:active.selectionEnd,direction:active.selectionDirection} : active?.dataset?.field ? {key:active.dataset.field,start:active.selectionStart,end:active.selectionEnd} : null;
  document.documentElement.lang = language;
  const projectTitle=model?.projectTitle?.trim()||t(model?.untitled?'untitledProject':'project');
  const windowTitle = `${projectTitle} · KOMYAKU Story Graph${floatingWindow ? ` · ${t('editor')}` : panelWindow==='navigator'?` · ${t('scenes')}`:panelWindow==='inspector'?` · ${t('relationships')}`:panelWindow==='history'?` · ${t('history')}`:''}`;
  document.title = windowTitle;
  if (native && displayedWindowTitle !== windowTitle) {
    displayedWindowTitle = windowTitle;
    window.__TAURI__.window.getCurrentWindow().setTitle(windowTitle).catch(() => { displayedWindowTitle = null; });
  }
  const selected = detail?.id;
  const scenes = routeNodes(model?.nodes||[],path);
  const people = (model?.nodes||[]).filter(n=>n.type==='story.character');
  const relations = (model?.nodes||[]).filter(n=>n.type==='story.relationship');
  const list = tab==='scenes'?outlineNodes(model?.nodes||[],path,collapsedOutline):tab==='characters'?people:tab==='history'?[]:relations;
  const props = detail?.properties || {};
  const values = {...props,...draft};
  const documents=isContainer()?groupDetails.map(scene=>groupEdits.get(scene.id)?.canonical??scene.properties.canonical):detail?.type_id==='story.scene'?[values.canonical]:[];
  lazyManuscript=documents.reduce((count,doc)=>count+doc.content.reduce((sum,node)=>sum+(node.type==='paragraph'?Math.max(1,Math.ceil(paragraphText(node).length/4096)):1),0),0)>80;
  const shell = document.getElementById('app');
  const leftOpen=panelWindow==='navigator'||preferences.leftPanelOpen, rightOpen=panelWindow==='inspector'||preferences.rightPanelOpen;
  shell.innerHTML = `<div class="shell ${floatingWindow?'detached':''} ${!leftOpen?'left-panel-closed':''} ${!rightOpen?'right-panel-closed':''} ${!leftOpen&&!rightOpen?'focus-writing':''} ${native&&navigator.platform.includes('Mac')?'mac-native':''}">
    ${!floatingWindow?`<header class="window-titlebar" data-tauri-drag-region><span class="window-title" data-tauri-drag-region>${escape(projectTitle)}</span><div class="panel-toggles"><button data-action="toggleLeftPanel" title="${escape(t(leftOpen?'hideLeftPanel':'showLeftPanel'))}" aria-label="${escape(t(leftOpen?'hideLeftPanel':'showLeftPanel'))}" aria-pressed="${leftOpen}" aria-controls="left-icon-menu story-navigator">${icon('leftPanel')}</button><button data-action="toggleRightPanel" title="${escape(t(rightOpen?'hideRightPanel':'showRightPanel'))}" aria-label="${escape(t(rightOpen?'hideRightPanel':'showRightPanel'))}" aria-pressed="${rightOpen}" aria-controls="story-relations">${icon('rightPanel')}</button></div></header>`:''}
    <nav class="menubar" aria-label="${escape(t('appMenu'))}">
      <details class="app-menu logo-menu"><summary class="menu-logo" aria-label="KOMYAKU Story Graph">${icon('graph')}</summary><div class="menu-popup">${button('preferences','preferences',null)}</div></details>
      ${menu('file',[button('newWorkspace','newWorkspace',null,!native||busy),button('openWorkspace','openWorkspace',null,!native||busy),button('importWorkspace','importWorkspace',null,!native||busy),button('importArchive','importArchive',null,!native||busy),button('exportArchive','exportArchive',null,!native||busy),button('exportSharedWorkspace','exportSharedWorkspace',null,!native||busy),button('exportSharedArchive','exportSharedArchive',null,!native||busy),button('exportSharedHistory','exportSharedHistory',null,!native||busy),button('save','save',null,!native||busy),exportMenu(),button('backup','backup',null,!native||busy),button('restoreBackup','restoreBackup',null,!native||busy)])}
      ${menu('edit',[button('undo','undo','undo',!native||busy),button('redo','redo','redo',!native||busy),button('remove','remove',null,!native||busy||!detail),button('search','search',null,!native||busy),button('narrative','narrative',null,!native||busy)])}
      ${menu('insert',[button('newBlock','newBlock',null,!native||busy),button('newSequence','newSequence',null,!native||busy||!model.nodes.some(n=>n.type==='story.block')),button('newScene','newScene',null,!native||busy||!model.nodes.some(n=>n.type==='story.sequence')),button('newCharacter','newCharacter',null,!native||busy),button('newRelation','createRelation',null,!native||busy||people.length<2)])}
      ${menu('view',[button('write','editor',null),button('read','reading',null),button('graph','graph',null,!native)])}
      ${menu('window',[button(floatingWindow?'dock':'float',floatingWindow?'dock':'float',null,!native||busy),button('dock','dock',null,!native||busy)])}
      <select id="language" class="menu-language" aria-label="Language">${Object.entries(languages).map(([key,label])=>`<option value="${key}" ${language===key?'selected':''}>${label}</option>`).join('')}</select>
    </nav>
    ${!native?`<aside class="preview">${escape(t('preview'))}</aside>`:''}
    ${latestDetail?`<aside class="conflict-review"><strong>${escape(t('latest'))}</strong><pre>${escape(latestDetail.properties.title)}
${escape(latestDetail.type_id==='story.scene'?canonicalText(latestDetail.properties.canonical):latestDetail.properties.role||'')}
${escape(latestDetail.properties.notes||'')}</pre><div>${button('applyDraft','applyDraft',null,busy)}${button('discardDraft','discardDraft',null,busy)}</div></aside>`:''}
    <div class="workspace">
      <nav class="icon-rail" id="left-icon-menu" aria-label="${escape(t('view'))}">
        <div class="icon-menu-items">${[['scenes','book'],['characters','person'],['relationships','graph']].map(([key,ico])=>`<button data-tab="${key}" title="${escape(t(key))}" aria-label="${escape(t(key))}" aria-pressed="${tab===key}">${icon(ico)}</button>`).join('')}</div>
        <div class="icon-menu-extension"></div><button class="rail-graph" data-action="graph" title="${escape(t('graph'))}" aria-label="${escape(t('graph'))}" ${!native?'disabled':''}>${icon('graph')}</button>
        <button class="rail-history" data-tab="history" title="${escape(t('history'))}" aria-label="${escape(t('history'))}" aria-pressed="${native&&!panelWindow?historyDocked():tab==='history'}">${icon('history')}</button>
      </nav>
    <main>
      <nav class="navigator" id="story-navigator" aria-label="${escape(t('view'))}"><div class="navtabs">${['scenes','characters','relationships','history'].map(key=>`<button data-tab="${key}" aria-pressed="${key==='history'&&native&&!panelWindow?historyDocked():tab===key}">${escape(t(key))}</button>`).join('')}</div>
      ${tab==='scenes'?`<label class="route-label">${escape(t('route'))}<select id="path">${(model.paths??['main','alternative'].map(key=>({key,name:key,legacy:key}))).map(route=>`<option value="${escape(route.key)}" ${path===route.key?'selected':''}>${escape(pathLabel(route))}</option>`).join('')}</select>${button('paths','managePaths',null,!native||busy)}</label>`:`<h2>${escape(t(tab==='history'?'history':'people'))}</h2>`}
      <div class="node-list" ${tab==='scenes'?'role="tree"':''}>${tab==='scenes'?`<label class="project-title-field"><span>${escape(t('workTitle'))}</span><input data-field="projectTitle" aria-label="${escape(t('workTitle'))}" value="${escape(draft?.projectTitle??model.projectTitle??'')}" placeholder="${escape(projectTitle)}" maxlength="200" ${native?'':'readonly'}></label>`:''}${list.map((node,i)=>`<div class="outline-row" ${tab==='scenes'?`role="treeitem" aria-level="${(node.depth||0)+1}" ${node.container?`aria-expanded="${!collapsedOutline.has(node.id)}"`:''}`:''}>${node.container?`<button class="outline-toggle" data-collapse="${node.id}" aria-label="${escape(t(collapsedOutline.has(node.id)?'expand':'collapse'))}" aria-expanded="${!collapsedOutline.has(node.id)}">${collapsedOutline.has(node.id)?'▸':'▾'}</button>`:''}<button class="node-row ${tab==='characters'?'character-row ':''}${node.id===selected?'active':''}" data-select="${node.id}" ${tab==='scenes'&&native?'draggable="true"':''} ${busy?'disabled':''}><span class="ordinal">${tab==='scenes'?icon(node.type==='story.block'?'block':node.type==='story.sequence'?'sequence':'scene'):tab==='characters'?characterIcon(node):icon('person')}</span><span><strong>${escape(node.title)}</strong><small>${escape(tab==='scenes'?t(node.type==='story.block'?'block':node.type==='story.sequence'?'sequence':node.path==='both'?'scene':node.path):tab==='characters'?(node.role||t('role')):t(node.kind))}</small></span></button></div>`).join('')||(tab==='history'?`<p class="empty">${escape(t('versionHelp'))}</p>`:`<p class="empty">${escape(t(tab==='scenes'?'noScenes':'noRelations'))}</p>`)}</div>
      <div class="navbottom">${tab==='scenes'?`<div class="structure-actions">${[['newBlock','block'],['newSequence','sequence'],['newScene','scene']].map(([action,ico])=>`<button data-action="${action}" title="${escape(t(action))}" aria-label="${escape(t(action))}" ${!native||busy||(action==='newSequence'&&!model.nodes.some(n=>n.type==='story.block'))||(action==='newScene'&&!model.nodes.some(n=>n.type==='story.sequence'))?'disabled':''}>${icon(ico)}</button>`).join('')}</div>`:tab==='history'?'':button(tab==='characters'?'newCharacter':'newRelation',tab==='characters'?'newCharacter':'createRelation','add',!native||busy||(tab==='relationships'&&people.length<2),'primary')}</div></nav>
      <section class="writing"><div class="editor-toolbar"><div class="viewtabs"><button data-action="write" aria-pressed="${!reading&&!embeddedGraph}">${escape(t('editor'))}</button><button data-action="read" aria-pressed="${reading&&!embeddedGraph}">${escape(t('reading'))}</button></div><div class="editor-actions"><select data-writing-mode aria-label="${escape(t('writingMode'))}">${['horizontal','vertical'].map(key=>`<option value="${key}" ${preferences.writingMode===key?'selected':''}>${escape(t(key))}</option>`).join('')}</select>${button('dialogue','dialogue',null,!native||busy||reading||!writingScene()||(floating&&!floatingWindow))}${button(floatingWindow?'dock':'float',floatingWindow?'dock':'float','float',!native||busy)}</div></div>
      <div class="editor-content ${reading?'reading-content ':''}${!reading&&isContainer()&&(!floating||floatingWindow)?'group-writing ':''}${!reading&&detail?.type_id==='story.scene'&&(!floating||floatingWindow)?'scene-writing':''}">${reading?`<div class="reading-viewport"><article class="reading" id="reading"><h2>${escape(model.paths?.find(p=>p.key===path)?pathLabel(model.paths.find(p=>p.key===path)):t(path))}</h2></article></div>`:floating&&!floatingWindow?`<div class="empty floating-message">${icon('float')}<p>${escape(t('floating'))}</p>${button('dock','dock',null,!native)}</div>`:detail?`
      ${isContainer()?'':detail.type_id==='story.scene'?sceneBreadcrumb(values):`<div class="selection-label">${escape(t(detail.type_id==='story.character'?'characters':'relationships'))}</div>${field('title',detail.type_id==='story.character'?'name':'title',values.title)}`}
      ${isContainer()?groupBody():detail.type_id==='story.scene'?sceneBody(values.canonical??props.canonical):detail.type_id==='story.character'?characterBody(values):`<div class="relation-inspector">${relatedPeople(model,detail).map(n=>`<span>${escape(n?.title||'—')}</span>`).join(`<span class="connection">${props.mutual?'↔':'→'}</span>`)}<label class="field">${escape(t('kind'))}<select data-field="kind" ${native?'':'disabled'}>${['family','friend','rival','trust','love'].map(k=>`<option value="${k}" ${values.kind===k?'selected':''}>${escape(t(k))}</option>`).join('')}</select></label><label class="check"><input data-field="mutual" type="checkbox" ${values.mutual?'checked':''} ${native?'':'disabled'}>${escape(t('mutual'))}</label></div>`}
      ${['story.block','story.sequence'].includes(detail.type_id)?'':detail.type_id==='story.scene'?`<details class="scene-notes" data-notes-id="${detail.id}" ${expandedNotes.has(detail.id)?'open':''}><summary>${escape(t('notes'))}</summary><textarea data-field="notes" aria-label="${escape(t('notes'))}" rows="4" ${native?'':'readonly'}>${escape(values.notes)}</textarea></details>`:field('notes','notes',values.notes,true)}${detail.type_id==='story.scene'||isContainer()?'':`<div class="editor-footer">${button('remove','remove','trash',!native||busy,'danger')}</div>`}`:`<p class="empty">${escape(t('select'))}</p>`}</div>
      <footer class="native-hint">${icon('graph')}<span>${escape(t('native'))}</span></footer></section>
      <aside class="relations" id="story-relations"><h2>${escape(t('relationships'))}</h2><p>${escape(t('relationDescription'))}</p>${relations.map(node=>{const [a,b]=relatedPeople(model,node);return `<button class="relation-row ${node.id===selected?'active':''}" data-select="${node.id}"><span class="relation-names">${escape(a?.title||'—')} <span>${node.mutual?'↔':'→'}</span> ${escape(b?.title||'—')}</span><strong>${escape(node.title)}</strong><small>${escape(t(node.kind))}</small></button>`;}).join('')}${button('newRelation','createRelation','add',!native||busy||people.length<2)}</aside>
      <aside class="history-docked history-panel" hidden></aside>
    </main></div><footer class="notice" role="status">${error?`<span class="error">${escape(t(error))}</span>${button('refresh','refresh',null,busy)}`:`<span>${status?escape(t(status)):''}</span>`}${backupPath?`<span class="backup-path" title="${escape(backupPath)}">${escape(t('savedCopy'))}: ${escape(backupPath)}</span>`:''}<span class="status-selection">${escape(detail?.properties.title||'')}</span></footer><dialog id="create-dialog"></dialog>
  </div>`;
  shell.querySelector('.editor-content').scrollTop=preferences.writingMode==='vertical'&&(reading||detail?.type_id==='story.scene'||isContainer())?0:editorScroll;
  shell.querySelector('.node-list').scrollTop=listScroll;
  resizeManuscript();
  if(cursor) {
    const scope=cursor.scene?shell.querySelector(`[data-scene="${cursor.scene}"]`):shell;
    if(cursor.block)mountManuscriptInput(scope,cursor.block,cursor.fragment??0);
    const input=scope?.querySelector(cursor.block?`[data-block="${cursor.block}"][data-fragment="${cursor.fragment??0}"]`:cursor.title?`[data-outline-title="${cursor.title}"]`:`[data-field="${cursor.key}"]`);
    if(input){input.focus({preventScroll:true});if(typeof cursor.start==='number' && input.setSelectionRange)input.setSelectionRange(cursor.start,cursor.end,cursor.direction);}
  }
  shell.querySelector('.editor-actions').insertAdjacentHTML('afterbegin',button('writingAssist','writingAssist',null,!native||busy||reading||detail?.type_id!=='story.scene'||(floating&&!floatingWindow)));
  const sceneViewport=shell.querySelector('.scene-writing .manuscript-pages');if(sceneViewport&&preferences.writingMode==='vertical')sceneViewport.scrollLeft=sceneScroll;
  const groupViewport=shell.querySelector('.group-manuscript');if(groupViewport){groupViewport.scrollLeft=preferences.writingMode==='vertical'?groupScroll.left:0;groupViewport.scrollTop=preferences.writingMode==='horizontal'?groupScroll.top:0;}
  if(reading) renderReading();
  if(!reading&&tab==='scenes')observeManuscriptSize();
  if(tab==='history'&&!floatingWindow){const panel=shell.querySelector('.writing');panel.classList.add('history-panel');disposeHistory=mountHistory(panel,{native,invoke,t,escape,language,commit:commitDraft,revision:()=>model.revision,title:projectTitle});if(native)panel.insertAdjacentHTML('afterbegin',`<button class="history-float-button" data-float-panel="history">${escape(t(panelWindow==='history'?'returnSidePanel':'floatSidePanel'))}</button>`);}
  if(native&&!panelWindow&&historyDocked()){const panel=shell.querySelector('.history-docked');disposeHistory=mountHistory(panel,{native,invoke,t,escape,language,commit:commitDraft,revision:()=>model.revision,title:projectTitle});}
  if(embeddedGraph&&native&&!panelWindow){shell.querySelector('.writing').classList.add('graph-writing');const content=shell.querySelector('.editor-content');content.className='editor-content docked-graph-content';content.innerHTML=`<div class="docked-graph-actions"><button data-action="graph">${escape(t('editor'))}</button><button data-action="floatGraph">${escape(t('graph'))} ↗</button><button data-docked-action="zoom" data-factor="1.2" aria-label="${escape(t('zoomIn'))}">＋</button><button data-docked-action="zoom" data-factor="0.8333333333" aria-label="${escape(t('zoomOut'))}">−</button><button data-docked-action="fit">${escape(t('fit'))}</button></div><div class="docked-graph-workspace"><nav class="docked-graph-tools"><div class="icon-menu-items"></div></nav><div data-docked-graph aria-label="${escape(t('relationships'))}" tabindex="0"></div><aside class="docked-graph-inspector" hidden><main id="inspector"></main></aside></div>`;const rail=content.querySelector('.docked-graph-tools'),panel=content.querySelector('.docked-graph-inspector');dockedGraphTools=[mountGraphTools(rail),mountGraphTools(panel,{inspector:true,onState:state=>{panel.hidden=!state.open;}})];}
  renderPanelHandles(t,native);
  syncDockedGraph();
  if(reopenPreferences) showPreferences();
}
async function renderReading(anchor=null) {
  readingLayoutAbort?.abort();const layoutAbort=new AbortController();readingLayoutAbort=layoutAbort;
  try {
    const target=document.getElementById('reading');
    const requestPath=path;
    const result=native?await invoke('reading_data',{path:requestPath}):{revision:model.revision,scenes:routeNodes(preview.nodes,requestPath).map(node=>({id:node.id,title:node.title,canonical:preview.details[node.id].properties.canonical}))};
    if(!target?.isConnected||path!==requestPath||result.revision!==model.revision)return;
    const blocks=result.scenes.map(scene=>[scene.id,scene.title]);
    const documents=result.scenes.map(scene=>scene.canonical);
    let previousBlock=null,previousSequence=null;
    const entries=[];
    blocks.forEach(([id,title],index)=>{
      const scene=model.nodes.find(node=>node.id===id),sequence=model.nodes.find(node=>node.id===scene?.parent),block=model.nodes.find(node=>node.id===sequence?.parent);
      if(block&&block.id!==previousBlock)entries.push({kind:'heading',id:`block:${block.id}:${id}`,level:2,style:'reading-block-title',size:preferences.blockSize,text:block.title});
      if(sequence&&sequence.id!==previousSequence)entries.push({kind:'heading',id:`sequence:${sequence.id}:${id}`,level:2,style:'reading-sequence-title',size:preferences.sequenceSize,text:sequence.title});
      previousBlock=block?.id;previousSequence=sequence?.id;
      entries.push({kind:'heading',id:`scene:${id}`,level:3,style:'reading-scene-title',size:preferences.titleSize,text:title});
      for(const node of documents[index].content){if(node.type==='paragraph')entries.push({kind:'paragraph',id:`${id}:${node.id}`,text:paragraphText(node)});else entries.push({kind:'dialogue',id:`dialogue:${id}:${node.id}`,texts:node.content[0].content.map(cell=>paragraphText(cell.content[0])),actorWidth:node.extensions?.['komyaku.dialogue']?.actorWidth});}
    });
    if(!entries.length){target.insertAdjacentHTML('beforeend',`<p>${escape(t('emptyReading'))}</p>`);return;}
    const root=target.closest('.reading-viewport'),vertical=preferences.writingMode==='vertical';
    readingViewport?.disconnect();readingViewport=null;target.querySelectorAll('.reading-chunk').forEach(node=>node.remove());
    const bounded=await boundedReadingBlocks(entries,{article:target,vertical,span:vertical?root.clientHeight:target.clientWidth,signal:layoutAbort.signal});
    if(!target.isConnected||layoutAbort.signal.aborted||path!==requestPath)return;
    readingViewport?.disconnect();readingViewport=new ReadingViewport({root:vertical?root:document.querySelector('.editor-content'),article:target,blocks:bounded,vertical,
      options:()=>({vertical,span:vertical?root.clientHeight:target.clientWidth,fontSize:preferences.bodySize,lineHeight:preferences.lineHeight}),
      markup:block=>block.kind==='heading'?`<h${block.level} class="${block.style}" data-reading-block="${escape(block.id)}" data-reading-start="0">${escape(block.text)}</h${block.level}>`:block.kind==='paragraph'?`<p data-reading-block="${escape(block.id??'')}" data-reading-start="${block.sourceStart??0}">${escape(block.text)}</p>`:`<table class="dialogue-sheet reading-dialogue" data-width="${block.actorWidth??''}"><tbody><tr>${block.texts.map((text,index)=>`<td data-reading-block="${escape(block.id)}" data-reading-start="${index?block.texts[0].length+1:0}" data-reading-cell="${index}">${escape(text)}</td>`).join('')}</tr></tbody></table>`,
      measure:()=>resizeDialogueColumns(),reflow:anchor=>renderReading(anchor)
    });
    readingViewport.restore(anchor);
  } catch(e) { if(layoutAbort.signal.aborted)return;const target=document.getElementById('reading');if(target)target.innerHTML=`<p class="error">${escape(t(String(e)))}</p>`; }
}
async function commitDraft() {
  if(commitInFlight){await commitInFlight;if(error)return false;return commitDraft();}
  commitInFlight=(async()=>await saveDraft()&&await saveTitleDrafts()&&await saveGroupDrafts())();
  let saved;
  try{saved=await commitInFlight;}finally{commitInFlight=null;}
  if(saved&&native&&localDirty())return commitDraft();
  if(saved&&native&&diskDirty){try{busy=true;model=await invoke('save_now');error='';status='saved';}catch(e){error=String(e);status='unsaved';saved=false;}finally{busy=false;render();}}
  return saved;
}
async function saveDraft() {
  if(composing || widthDrag || error==='revision_conflict')return false;
  if (!primaryDirty() || busy || !native) return !busy;
  // Commit one field at a time, keeping the author's draft until all edits are accepted.
  const savingVersion=draftVersion;
  const savingDraft={...draft}, savingParagraphs=new Map(pendingParagraphs), savingWhole=wholeCanonicalDraft;
  let keepEditor=false;
  busy=true; status='saving'; error='';
  try {
    const updates=Object.entries(savingDraft).filter(([k,v])=>v!==draftBase(k));
    for(const [key,value] of updates) {
      model=await invoke('edit',{expectedRevision:model.revision,action:key==='canonical'?(savingWhole||!savingParagraphs.size?{kind:'canonical',id:detail.id,document:value}:{kind:'paragraphs',id:detail.id,changes:[...savingParagraphs].flatMap(([paragraph,changes])=>changes.map(change=>({paragraph,...change})))}):key==='projectTitle'?{kind:'project_title',title:value}:key==='text'?{kind:'text',id:detail.id,text:value}:{kind:'property',id:detail.id,key,value}});
    }
    keepEditor=updates.every(([key])=>key==='canonical')&&!savingWhole;
    if(detail) for(const [key,value] of updates)if(key!=='projectTitle')detail.properties[key]=value;
    for(const [id,changes] of savingParagraphs){const current=pendingParagraphs.get(id);if(current===changes)pendingParagraphs.delete(id);else if(current)pendingParagraphs.set(id,current.slice(changes.length));}
    if(savingVersion===draftVersion){draft=null;wholeCanonicalDraft=false;}
    status=dirty()?'unsaved':'saved';return true;
  } catch(e) {error=String(e);status='unsaved';return false;} finally {busy=false;if(keepEditor&&!error){const notice=document.querySelector('.notice span');if(notice)notice.textContent=t(status);}else render();if(dirty()&&!error){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>commitDraft(),900);}}
}
async function saveTitleDrafts() {
  if(composing||widthDrag||error==='revision_conflict')return false;
  if(!titleEdits.size||busy||!native)return !busy;
  busy=true;status='saving';error='';
  try {
    for(const [id,edit] of [...titleEdits]) {
      model=await invoke('edit',{expectedRevision:model.revision,action:{kind:'property',id,key:'title',value:edit.value}});
      if(detail?.id===id)detail.properties.title=edit.value;
      const scene=groupDetails.find(scene=>scene.id===id);if(scene)scene.properties.title=edit.value;
      if(titleEdits.get(id)===edit)titleEdits.delete(id);
    }
    status=dirty()?'unsaved':'saved';return true;
  }catch(e){error=String(e);status='unsaved';return false;}
  finally {
    busy=false;render();
    if(dirty()&&!error){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>commitDraft(),900);}
  }
}
async function saveGroupDrafts() {
  if(composing||widthDrag||error==='revision_conflict')return false;
  if(!groupEdits.size||busy||!native)return !busy;
  busy=true;status='saving';error='';let rebuild=false;
  try {
    for(const [id,edit] of [...groupEdits]) {
      const version=edit.version, canonical=edit.canonical, changes=new Map(edit.changes), whole=edit.whole;
      model=await invoke('edit',{expectedRevision:model.revision,action:whole?{kind:'canonical',id,document:canonical}:{kind:'paragraphs',id,changes:[...changes].flatMap(([paragraph,list])=>list.map(change=>({paragraph,...change})))}});
      const scene=groupDetails.find(scene=>scene.id===id);if(scene)scene.properties.canonical=canonical;
      if(edit.version===version)groupEdits.delete(id);
      else for(const [paragraph,list] of changes)edit.changes.set(paragraph,(edit.changes.get(paragraph)||[]).slice(list.length));
      rebuild||=whole;
    }
    status=dirty()?'unsaved':'saved';return true;
  }catch(e){error=String(e);status='unsaved';return false;}
  finally {
    busy=false;
    if(rebuild||error)render();else {const notice=document.querySelector('.notice span');if(notice)notice.textContent=t(status);}
    if(dirty()&&!error){clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>commitDraft(),900);}
  }
}
async function showWorkspaces() {
  if(document.querySelector('.workspace-dialog'))return;
  const dialog=document.createElement('dialog');dialog.className='workspace-dialog';
  dialog.innerHTML=`<h2>${escape(t('openWorkspace'))}</h2><label class="workspace-search">${escape(t('findWork'))}<input type="search" autofocus></label><div class="workspace-list" aria-live="polite">${escape(t('loadingWorkspaces'))}</div><p class="workspace-error" role="status"></p><footer><button data-work-close>${escape(t('close'))}</button></footer>`;
  document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.querySelector('[data-work-close]').onclick=()=>dialog.close();
  const list=dialog.querySelector('.workspace-list'),search=dialog.querySelector('input');let entries=[];
  const draw=()=>{
    const rows=entries.filter(item=>(item.title||t(item.default?'project':'untitledProject')).toLocaleLowerCase().includes(search.value.toLocaleLowerCase()));
    list.innerHTML=rows.map(item=>`<button class="workspace-row" data-work-id="${escape(item.id)}" ${item.current||item.opened||item.issue?'disabled':''}><strong>${escape(item.title||t(item.default?'project':'untitledProject'))}</strong><small>${escape(item.issue?t(item.issue):item.current?t('currentWorkspace'):item.opened?t('workspace_already_open'):item.modified?new Date(item.modified*1000).toLocaleString(language):'')}</small></button>`).join('')||`<p class="empty">${escape(t('noWorkspaces'))}</p>`;
  };
  search.oninput=draw;
  list.onclick=async event=>{
    const row=event.target.closest('[data-work-id]');if(!row||row.disabled)return;
    list.querySelectorAll('button').forEach(button=>button.disabled=true);search.disabled=true;
    try{await invoke('open_workspace',{id:row.dataset.workId});dialog.close();}
    catch(e){dialog.querySelector('.workspace-error').textContent=t(String(e));search.disabled=false;draw();}
  };
  try{entries=await invoke('saved_workspaces');if(dialog.isConnected)draw();}
  catch(e){list.textContent='';dialog.querySelector('.workspace-error').textContent=t(String(e));}
}
async function showBackups() {
  if(document.querySelector('.workspace-dialog'))return;
  const dialog=document.createElement('dialog');dialog.className='workspace-dialog backup-dialog';
  dialog.innerHTML=`<h2>${escape(t('restoreBackup'))}</h2><p class="backup-hint">${escape(t('restoreHint'))}</p><div class="workspace-list" aria-live="polite">${escape(t('loadingBackups'))}</div><p class="backup-details"></p><label class="workspace-search">${escape(t('restoredTitle'))}<input maxlength="200" required disabled></label><p class="workspace-error" role="status"></p><footer><button data-backup-close>${escape(t('close'))}</button><button class="primary" data-backup-restore disabled>${escape(t('restoreAndOpen'))}</button></footer>`;
  document.body.append(dialog);dialog.showModal();dialog.addEventListener('close',()=>dialog.remove(),{once:true});
  dialog.querySelector('[data-backup-close]').onclick=()=>dialog.close();
  const list=dialog.querySelector('.workspace-list'),title=dialog.querySelector('input'),restore=dialog.querySelector('[data-backup-restore]');let entries=[],selected=null;
  const draw=()=>{list.innerHTML=entries.map(item=>`<button class="workspace-row" data-backup-id="${escape(item.id)}" aria-pressed="${selected?.id===item.id}" ${item.issue?'disabled':''}><strong>${escape(item.title||model.projectTitle||t('untitledProject'))}</strong><small>${escape(item.modified?new Date(item.modified*1000).toLocaleString(language):'')}${item.issue?` · ${escape(t(item.issue))}`:''}</small></button>`).join('')||`<p class="empty">${escape(t('noBackups'))}</p>`;};
  list.onclick=event=>{
    const row=event.target.closest('[data-backup-id]');if(!row||row.disabled)return;selected=entries.find(item=>item.id===row.dataset.backupId);draw();
    title.disabled=false;title.value=`${[...(selected.title||model.projectTitle||t('untitledProject'))].slice(0,170).join('')}${t('restoredSuffix')}`;
    dialog.querySelector('.backup-details').textContent=t('backupDetails').replace('{scenes}',selected.scenes).replace('{nodes}',selected.nodes);
    restore.disabled=false;title.focus();title.select();
  };
  title.oninput=()=>{restore.disabled=!selected||!title.value.trim();};
  restore.onclick=async()=>{
    if(!selected||!title.reportValidity())return;
    restore.disabled=true;title.disabled=true;list.querySelectorAll('button').forEach(row=>row.disabled=true);
    try{await invoke('restore_backup',{id:selected.id,title:title.value});dialog.close();}
    catch(e){dialog.querySelector('.workspace-error').textContent=t(String(e));title.disabled=false;restore.disabled=false;draw();}
  };
  try{entries=await invoke('saved_backups');if(dialog.isConnected)draw();}
  catch(e){list.textContent='';dialog.querySelector('.workspace-error').textContent=t(String(e));}
}
function groupEdit(id) {
  if(!groupEdits.has(id))groupEdits.set(id,{canonical:groupDetails.find(scene=>scene.id===id).properties.canonical,changes:new Map(),whole:false,version:0});
  return groupEdits.get(id);
}
function groupBody() {
  let previous=null;
  return `<div class="group-manuscript"><header class="group-title ${detail.type_id==='story.block'?'block-title':'sequence-title'}"><span>${escape(t(detail.type_id==='story.block'?'block':'sequence'))}</span>${outlineTitle(detail.id,detail.properties.title,'group-title-input')}</header>${groupDetails.map(scene=>{
    const sequence=model.nodes.find(node=>node.id===scene.properties.parent);
    const heading=sequence&&sequence.id!==previous&&detail.type_id==='story.block'?outlineTitle(sequence.id,sequence.title,'group-sequence-heading'):'';
    previous=sequence?.id;
    return `${heading}<section class="group-scene" data-scene="${scene.id}">${outlineTitle(scene.id,scene.properties.title,'group-scene-title')}${sceneBody(groupEdits.get(scene.id)?.canonical??scene.properties.canonical,scene.id)}</section>`;
  }).join('')||`<p class="empty">${escape(t('noScenes'))}</p>`}</div>`;
}
async function mutate(action) {
  if(!await commitDraft())return;
  busy=true;error='';
  const previousIds=new Set(model.nodes.map(node=>node.id));
  try { model=await invoke('edit',{expectedRevision:model.revision,action});
    const added=action.kind==='move_outline'?model.nodes.find(node=>node.id===action.id):action.kind.startsWith('add_')?model.nodes.find(node=>!previousIds.has(node.id)):null;
    if(added){model=await invoke('choose',{id:added.id});tab=added.type==='story.character'?'characters':added.type==='story.relationship'?'relationships':'scenes';if(added.parent)collapsedOutline.delete(added.parent);const parent=model.nodes.find(n=>n.id===added.parent);if(parent?.parent)collapsedOutline.delete(parent.parent);}
    status='saved';await loadDetail(model.selected); }
  catch(e){error=String(e);status='unsaved';}finally{busy=false;render();}
}
function characterBody(values) {
  const portrait=detail.properties.portrait;
  return `<section class="character-portrait" aria-label="${escape(t('portrait'))}"><div class="portrait-preview">${portrait?`<img src="${escape(portrait)}" alt="${escape(values.title||'')}" width="96" height="96">`:`<span aria-hidden="true">${escape(Array.from(values.title||'?')[0])}</span>`}</div><div class="portrait-controls"><strong>${escape(t('portrait'))}</strong><div class="portrait-buttons">${button('importPortrait',portrait?'replacePortrait':'addPortrait','person',!native||busy)}${portrait?button('removePortrait','removePortrait',null,!native||busy):''}</div><p>${escape(t('portraitHint'))}</p></div></section>${field('role','role',values.role,true)}`;
}
function characterIcon(node) {
  return node.portraitKey&&native?`<img class="character-list-portrait" src="${escape(window.__TAURI__.core.convertFileSrc(node.id,'portrait')+'?v='+node.portraitKey)}" alt="" width="32" height="32">`:icon('person');
}
async function importPortrait() {
  if(!await commitDraft()||detail?.type_id!=='story.character')return;
  const id=detail.id;
  busy=true;error='';render();
  try {
    const preview=await invoke('prepare_portrait',{id,expectedRevision:model.revision});
    const updated=preview?await cropPortrait({preview,invoke,t,escape}):null;
    if(updated){model=updated;status='saved';await loadDetail(id);}
  }catch(e){error=String(e);}finally{busy=false;render();}
}
async function choose(id) {
  if(!await commitDraft()) return;
  if(native) model=await invoke('choose',{id});else model={...model,selected:id};
  await loadDetail(id);render();
}
const fragmentKey=(scene,id,index)=>`${scene}:${id}-${index}`;
const paragraphLayouts=createParagraphLayouts({
  blocked:()=>composing||Boolean(pointerSelection)||Boolean(widthDrag)||busy||reading||embeddedGraph,
  current:input=>paragraphById(paragraphDocument(input),input.dataset.block),
  apply:input=>{if(caretQA){const parts=paragraphLayouts.get(paragraphById(paragraphDocument(input),input.dataset.block));invoke('performance_qa_caret',{values:[-13,preferences.writingMode==='vertical'?1:0,parts.length,parts[0].text.length,parts[1]?.text.length??0,parts.at(-1).text.length,input.clientWidth,input.clientHeight,0,0]}).catch(()=>{});}const active=document.activeElement;const focused=active?.dataset.block===input.dataset.block&&inputScene(active)===inputScene(input);reflowParagraph(focused?active:input,focused?caretPosition(active):Number(input.dataset.start),focused);}
});
function paragraphMarkup(node,lazy=false,scene=detail?.id) {
  return (paragraphLayouts.get(node)??fragments(paragraphText(node))).map((part,index)=>{
    const key=fragmentKey(scene,node.id,index),source={text:part.text,start:part.start};
    const markup=()=>`<textarea class="manuscript-text" data-block="${node.id}" data-start="${source.start}" data-length="${source.text.length}" data-fragment="${index}" aria-label="${escape(t('body'))}" rows="1" ${native?'':'readonly'}>${escape(source.text)}</textarea>`;
    source.markup=markup;virtualSources.set(key,source);
    return `<div class="manuscript-block" data-manuscript-block="${key}" data-paragraph="${node.id}" data-start="${part.start}" data-length="${part.text.length}">${lazy?'':markup()}</div>`;
  }).join('');
}
function sceneBody(doc,scene=detail?.id) {
  const editable=native?'':'readonly';
  const input=(node,label,actor=false,part={start:0,text:paragraphText(node)},index=0)=>`<textarea class="${actor?'dialogue-actor':'manuscript-text'}" data-block="${node.id}" data-start="${part.start}" data-length="${part.text.length}" data-fragment="${index}" aria-label="${escape(t(label))}" placeholder="${label==='body'?'':escape(t(label))}" rows="1" ${editable}>${escape(part.text)}</textarea>`;
  const blocks=doc.content.flatMap(node=>{
    if(node.type==='paragraph')return [paragraphMarkup(node,lazyManuscript,scene)];
    const cells=node.content[0].content.map(cell=>cell.content[0]);
    const markup=()=>`<table class="dialogue-sheet" data-sheet="${node.id}" data-width="${node.extensions?.['komyaku.dialogue']?.actorWidth??''}" aria-label="${escape(t('dialogue'))}"><tbody><tr><td>${input(cells[0],'actorName',true)}${native?`<span class="dialogue-divider" data-divider="${node.id}" role="separator" aria-orientation="vertical" aria-label="${escape(t('resizeActor'))}" tabindex="0"></span>`:''}</td><td>${input(cells[1],'dialogueText')}</td></tr></tbody></table>`;
    virtualSources.set(`${scene}:${node.id}`,{markup,texts:cells.map(paragraphText),paragraphs:cells.map(cell=>cell.id),actorWidth:node.extensions?.['komyaku.dialogue']?.actorWidth});
    return [`<div class="manuscript-block" data-manuscript-block="${scene}:${node.id}" data-sheet-block="${node.id}">${lazyManuscript?'':markup()}</div>`];
  });
  return `<div class="manuscript"><div class="manuscript-pages">${blocks.join('')}</div></div>`;
}
function mountManuscriptInput(scope,id,fragment=0) {
  const block=manuscriptViewport?.findBlock(fragmentKey(inputScene(scope)??detail?.id,id,fragment))??scope?.querySelector(`[data-manuscript-block="${fragmentKey(inputScene(scope)??detail?.id,id,fragment)}"]`)??[...scope?.querySelectorAll('[data-sheet-block]')??[]].find(block=>virtualSources.get(block.dataset.manuscriptBlock)?.paragraphs.includes(id));
  if(block){manuscriptViewport?.mount(block);manuscriptViewport?.measureBlock(block);}
}
function resizeDialogueColumns(scope=document) {
  const context=document.createElement('canvas').getContext('2d');
  const rem=parseFloat(getComputedStyle(document.documentElement).fontSize);
  (scope.matches?.('.dialogue-sheet')?[scope]:scope.querySelectorAll('.dialogue-sheet')).forEach(table=>{
    const actor=table.querySelector('.dialogue-actor')||table.rows[0].cells[0];
    const style=getComputedStyle(actor);context.font=`${preferences.actorBold?'700':'400'} ${preferences.bodySize}px ${style.fontFamily}`;
    const text=actor.value??actor.textContent;
    const natural=preferences.writingMode==='vertical'?Math.max(1,...(text||t('actorName')).split('\n').map(line=>[...line].length))*preferences.bodySize+rem:Math.max(0,...(text||t('actorName')).split('\n').map(line=>context.measureText(line).width))+rem;
    const width=Math.max(16,Math.min(Number(table.dataset.width)||natural,(preferences.writingMode==='vertical'?table.clientHeight:table.clientWidth)-32));
    table.style.setProperty('--actor-width',`${width}px`);
    table.querySelector('[data-divider]')?.setAttribute('aria-orientation',preferences.writingMode==='vertical'?'horizontal':'vertical');
    const separator=table.querySelector('[data-divider]');
    separator?.setAttribute('aria-valuenow',String(Math.round(width)));
    separator?.setAttribute('aria-valuemin','16');separator?.setAttribute('aria-valuemax',String(Math.max(16,(preferences.writingMode==='vertical'?table.clientHeight:table.clientWidth)-32)));
  });
}
// Only the empty final column uses a visual caret; editing still belongs to textarea.
let emptyColumnInput=null, emptyColumnCaret=null;
function updateEmptyColumnCaret() {
  emptyColumnCaret?.remove();emptyColumnCaret=null;
  if(emptyColumnInput)emptyColumnInput.style.caretColor='';emptyColumnInput=null;
  const input=document.activeElement;
  if(composing||preferences.writingMode!=='vertical'||!input?.dataset?.block||!input.value.endsWith('\n')||input.selectionStart!==input.value.length||input.selectionEnd!==input.value.length)return;
  const wrapper=input.closest('.manuscript-block'),bounds=input.getBoundingClientRect(),parent=wrapper.getBoundingClientRect();
  const capacity=Math.max(1,Math.floor(input.clientHeight/preferences.bodySize));
  const columns=input.value.split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].length/capacity)),0);
  const caret=document.createElement('span');caret.className='empty-column-caret';caret.setAttribute('aria-hidden','true');
  caret.style.left=`${bounds.left-parent.left+Math.max(0,input.clientWidth-columns*preferences.bodySize*preferences.lineHeight)}px`;
  caret.style.top=`${bounds.top-parent.top}px`;caret.style.width=`${preferences.bodySize*preferences.lineHeight}px`;
  input.style.caretColor='transparent';wrapper.append(caret);emptyColumnInput=input;emptyColumnCaret=caret;
}
document.addEventListener('selectionchange',updateEmptyColumnCaret);
document.addEventListener('keyup',updateEmptyColumnCaret);
document.addEventListener('focusin',updateEmptyColumnCaret);
document.addEventListener('focusout',()=>requestAnimationFrame(updateEmptyColumnCaret));
function resizeOutlineTitle(input) {
  if(input.tagName!=='TEXTAREA')return;
  if(preferences.writingMode==='vertical'){
    const width=parseFloat(getComputedStyle(input).fontSize)*1.6;
    input.style.width=`${width}px`;input.style.width=`${Math.max(width,input.scrollWidth)}px`;
  }else {input.style.height='0px';input.style.height=`${input.scrollHeight}px`;}
}
function resizeManuscript(scope=null) {
  if(!scope) {
    document.querySelectorAll('textarea[data-outline-title]').forEach(resizeOutlineTitle);
    const blocks=[...document.querySelectorAll('.manuscript-block')];
    if(manuscriptViewport||blocks.length>80||blocks.some(block=>!block.firstElementChild)) {
      if(!manuscriptViewport)observeManuscript();
      blocks.filter(block=>block.classList.contains('block-visible')||block.contains(document.activeElement)).forEach(block=>resizeManuscript(block));
      return;
    }
    scope=document;
  }
  resizeDialogueColumns(scope);
  (scope.matches?.('[data-block]')?[scope]:scope.querySelectorAll('[data-block]')).forEach(input=>{
    const wrapper=input.closest('.manuscript-block');
    if(!input.closest('.dialogue-sheet')){const node=paragraphById(paragraphDocument(input),input.dataset.block);paragraphLayouts.queue(input,node,node?paragraphText(node):'');}
    const stretch=wrapper?.parentElement.classList.contains('manuscript-pages')&&wrapper===wrapper.parentElement.lastElementChild&&input.parentElement===wrapper;
    if(preferences.writingMode==='vertical'){input.style.flex='none';input.style.minHeight='0px';input.style.height='100%';input.style.minWidth='0px';const capacity=Math.max(1,Math.floor(input.clientHeight/preferences.bodySize));const columns=(input.value||input.placeholder||' ').split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].length/capacity)),0);input.style.width=`${columns*preferences.bodySize*preferences.lineHeight}px`;input.style.width=`${Math.max(input.scrollWidth,columns*preferences.bodySize*preferences.lineHeight)}px`;if(wrapper)wrapper.style.width=`${Math.max(...[...wrapper.querySelectorAll('textarea')].map(item=>parseFloat(item.style.width)||preferences.bodySize*preferences.lineHeight))}px`;const actor=wrapper?.querySelector('.dialogue-actor');if(actor)wrapper.querySelectorAll('.dialogue-sheet td').forEach(cell=>cell.style.setProperty('width',wrapper.style.width,'important'));return;}
    if(wrapper){wrapper.style.width='';wrapper.querySelectorAll('.dialogue-sheet td').forEach(cell=>cell.style.removeProperty('width'));}input.style.width='';input.style.minWidth='';
    input.style.flex='none';input.style.minHeight='0px';input.style.height='0px';
    const height=input.scrollHeight;
    input.style.height=stretch?'auto':`${height}px`;input.style.minHeight=stretch?`${height}px`:'';input.style.flex='';
  });
}
function observeManuscript() {
  const root=document.querySelector(isContainer()?'.group-manuscript':preferences.writingMode==='vertical'?'.manuscript-pages':'.editor-content');
  const vertical=preferences.writingMode==='vertical';
  const virtualBlocks=[...document.querySelectorAll('.manuscript-block')];
  manuscriptViewport?.disconnect();
  manuscriptViewport=new ManuscriptViewport({root,blocks:virtualBlocks,vertical,
    source:block=>virtualSources.get(block.dataset.manuscriptBlock).markup(),
    estimate:(block,values,actorWidth)=>{
      const source=virtualSources.get(block.dataset.manuscriptBlock),options={vertical,span:vertical?(manuscriptViewport?.container(block)??block.parentElement).clientHeight:(manuscriptViewport?.container(block)??block.parentElement).clientWidth,fontSize:preferences.bodySize,lineHeight:preferences.lineHeight,actorWidth:actorWidth??source?.actorWidth};
      return block.dataset.sheetBlock?estimatedDialogueExtent(values??source.texts,options):estimatedExtent(values?.[0]??source?.text??'',options);
    },
    measure:block=>{resizeManuscript(block);if(paragraphSelection&&selectedParagraph(document.activeElement))paintParagraphSelection(document.activeElement);if(documentSelection&&document.activeElement?.dataset.block)paintDocumentSelection(document.activeElement);},
    pinned:block=>block.contains(document.activeElement)||Boolean(compositionTarget&&block.contains(compositionTarget))||Boolean(widthDrag&&block.contains(widthDrag.table))
  });
}
function observeManuscriptSize() {
  const root=document.querySelector(isContainer()?'.group-manuscript':preferences.writingMode==='vertical'?'.manuscript-pages':'.editor-content');
  manuscriptSizeObserver?.disconnect();cancelAnimationFrame(manuscriptSizeFrame);
  // Docking can resize the writing area without a window resize. Recompute
  // textarea columns against the final grid height before revealing a caret.
  let size='';
  if(root&&typeof ResizeObserver!=='undefined'){
    manuscriptSizeObserver=new ResizeObserver(()=>{
      const next=`${root.clientWidth}:${root.clientHeight}`;if(next===size)return;size=next;
      cancelAnimationFrame(manuscriptSizeFrame);manuscriptSizeFrame=requestAnimationFrame(()=>{
        if(!root.isConnected)return;
        resizeManuscript();manuscriptViewport?.resize();
        const input=document.activeElement;if(input?.dataset.block&&root.contains(input))revealParagraphCaret(input,input.selectionStart);
      });
    });manuscriptSizeObserver.observe(root);
  }
}
function sceneBreadcrumb(values) {
  const sequence=model.nodes.find(node=>node.id===values.parent);
  const block=model.nodes.find(node=>node.id===sequence?.parent);
  const ancestors=[block,sequence].filter(Boolean);
  return `<nav class="scene-breadcrumb" aria-label="${escape(t('outline'))}">${ancestors.map(node=>`${outlineTitle(node.id,node.title,`breadcrumb-parent ${node.type==='story.block'?'block-title':'sequence-title'}`,true)}<span class="breadcrumb-separator" aria-hidden="true">›</span>`).join('')}${outlineTitle(detail.id,values.title,'breadcrumb-title',true)}</nav>`;
}
function outlineTitle(id,value,className,inline=false) {
  const node=model.nodes.find(node=>node.id===id),kind=node?.type?.split('.')[1]||'scene';
  const attributes=`class="outline-title ${className}" data-outline-title="${id}" aria-label="${escape(t(kind))}" maxlength="200" ${native?'':'readonly'}`;
  const title=escape(titleEdits.get(id)?.value??value);
  return inline?`<input ${attributes} value="${title}" ${kind==='scene'?'aria-current="page"':''}>`:`<textarea ${attributes} rows="1">${title}</textarea>`;
}
function createDialog(kind) {
  const dialog=document.getElementById('create-dialog');
  const people=model.nodes.filter(n=>n.type==='story.character');
  const structural=['newBlock','newSequence','newScene'].includes(kind);
  const parents=model.nodes.filter(n=>n.type===(kind==='newSequence'?'story.block':'story.sequence'));
  const current=model.nodes.find(n=>n.id===detail?.id);
  const selectedParent=parents.some(n=>n.id===current?.id)?current.id:parents.some(n=>n.id===current?.parent)?current.parent:parents.at(-1)?.id;
  const parentControl=structural&&kind!=='newBlock'?`<label class="field">${escape(t('parent'))}<select name="parent" required>${parents.map(n=>`<option value="${n.id}" ${n.id===selectedParent?'selected':''}>${escape(n.title)}</option>`).join('')}</select></label>`:'';
  const options=people.map(n=>`<option value="${n.id}">${escape(n.title)}</option>`).join('');
  dialog.innerHTML=`<form id="create-form"><h2>${escape(t(kind==='newRelation'?'createRelation':kind))}</h2><label class="field">${escape(t(kind==='newCharacter'?'name':kind==='newRelation'?'relationTitle':'title'))}<input name="title" required maxlength="200" value="${escape(kind==='newBlock'?t('block'):kind==='newSequence'?t('sequence'):kind==='newScene'?t('untitled'):kind==='newCharacter'?t('unnamed'):t('friend'))}"></label>${parentControl}${kind==='newRelation'?`<label class="field">${escape(t('from'))}<select name="from">${options}</select></label><label class="field">${escape(t('to'))}<select name="to">${options}</select></label><label class="field">${escape(t('kind'))}<select name="relation">${['family','friend','rival','trust','love'].map(k=>`<option value="${k}">${escape(t(k))}</option>`).join('')}</select></label><label class="check"><input name="mutual" type="checkbox" checked>${escape(t('mutual'))}</label>`:''}<p class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" data-action="cancel">${escape(t('cancel'))}</button><button class="primary" type="submit">${escape(t('add'))}</button></div></form>`;
  if(kind==='newRelation' && people.length>1) dialog.querySelector('[name=to]').value=people[1].id;
  dialog.showModal();dialog.querySelector('input').select();
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const form=new FormData(event.currentTarget);const title=form.get('title').trim();if(!title)return;
    if(kind==='newRelation' && form.get('from')===form.get('to')){dialog.querySelector('.form-error').textContent=t('invalid_relationship');return;}
    const action=kind==='newBlock'||kind==='newSequence'?{kind:'add_container',title,level:kind==='newBlock'?'block':'sequence',parent:form.get('parent')||null}:kind==='newScene'?{kind:'add_scene',title,path,parent:form.get('parent')||null}:kind==='newCharacter'?{kind:'add_character',title}:{kind:'add_relationship',title,from:form.get('from'),to:form.get('to'),relation:form.get('relation'),mutual:form.has('mutual')};
    dialog.close();await mutate(action);
  };
}
function storeSheetWidth(id,width,scene) {
  if(scene){const edit=groupEdit(scene);edit.whole=true;edit.canonical=setDialogueWidth(edit.canonical,id,width);edit.version++;status='unsaved';return;}
  wholeCanonicalDraft=true;draft??={};draft.canonical=setDialogueWidth(draft.canonical??detail.properties.canonical,id,width);draftVersion++;status='unsaved';
}
document.addEventListener('pointerdown',event=>{
  const handle=event.target.closest('[data-divider]');if(!handle||busy||!native||event.button!==0)return;
  event.preventDefault();clearTimeout(autosaveTimer);
  const table=handle.closest('.dialogue-sheet');
  const vertical=preferences.writingMode==='vertical',bounds=table.getBoundingClientRect(),cell=table.rows[0].cells[0].getBoundingClientRect();
  const offset=(vertical?event.clientY-bounds.top-cell.height:event.clientX-bounds.left-cell.width);
  widthDrag={id:handle.dataset.divider,table,handle,pointer:event.pointerId,offset};handle.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove',event=>{
  if(!widthDrag||event.pointerId!==widthDrag.pointer)return;
  const bounds=widthDrag.table.getBoundingClientRect(),width=Math.max(16,Math.min((preferences.writingMode==='vertical'?event.clientY-bounds.top:event.clientX-bounds.left)-widthDrag.offset,(preferences.writingMode==='vertical'?bounds.height:bounds.width)-32,4096));
  widthDrag.table.dataset.width=String(width);widthDrag.table.style.setProperty('--actor-width',`${width}px`);
  resizeManuscript(widthDrag.table);
});
async function finishWidthDrag(event) {
  if(!widthDrag||event.pointerId!==widthDrag.pointer)return;
  const drag=widthDrag;widthDrag=null;manuscriptViewport?.pruneSoon();
  if(event.type==='pointercancel'){resizeManuscript();render();return;}
  storeSheetWidth(drag.id,Number(drag.table.dataset.width)||drag.table.rows[0].cells[0].getBoundingClientRect().width,inputScene(drag.handle));
  await commitDraft();focusDialogueDivider(drag.id,inputScene(drag.handle));
}
function focusDialogueDivider(id,scene) {
  const scope=scene?document.querySelector(`[data-scene="${scene}"]`):document;
  const block=scope?.querySelector(`[data-sheet-block="${id}"]`);if(block){manuscriptViewport?.mount(block);manuscriptViewport?.measureBlock(block);}
  scope?.querySelector(`[data-divider="${id}"]`)?.focus({preventScroll:true});
}
document.addEventListener('pointerup',finishWidthDrag);document.addEventListener('pointercancel',finishWidthDrag);
document.addEventListener('keydown',async event=>{
  const handle=event.target.closest('[data-divider]');if(!handle||!(preferences.writingMode==='vertical'?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight']).includes(event.key))return;
  event.preventDefault();const table=handle.closest('.dialogue-sheet');
  const width=Math.max(16,Math.min((preferences.writingMode==='vertical'?table.rows[0].cells[0].getBoundingClientRect().height:table.rows[0].cells[0].getBoundingClientRect().width)+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)*(event.shiftKey?10:2),(preferences.writingMode==='vertical'?table.clientHeight:table.clientWidth)-32,4096));
  const id=handle.dataset.divider,scene=inputScene(handle);storeSheetWidth(id,width,scene);await commitDraft();focusDialogueDivider(id,scene);
});
document.addEventListener('dblclick',async event=>{
  const handle=event.target.closest('[data-divider]');if(!handle)return;
  storeSheetWidth(handle.dataset.divider,null,inputScene(handle));await commitDraft();
});
window.addEventListener('resize',()=>{resizeManuscript();manuscriptViewport?.resize();});
document.addEventListener('wheel',event=>{if(preferences.writingMode!=='vertical')return;const pages=event.target.closest('.group-manuscript')??event.target.closest('.manuscript-pages,.reading-viewport');if(!pages||pages.scrollWidth<=pages.clientWidth||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;event.preventDefault();pages.scrollLeft-=event.deltaY;},{passive:false});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.scene-notes')){const id=event.target.dataset.notesId;event.target.open?expandedNotes.add(id):expandedNotes.delete(id);}},true);
function paragraphInputs(input) {return manuscriptViewport?manuscriptViewport.paragraphInputs(input):[...input.closest('.manuscript').querySelectorAll('textarea[data-block]')].filter(next=>next.dataset.block===input.dataset.block);}
function paragraphDocument(input) {const scene=inputScene(input);return scene?(groupEdits.get(scene)?.canonical??groupDetails.find(item=>item.id===scene).properties.canonical):(draft?.canonical??detail.properties.canonical);}
function paragraphValue(input) {return paragraphText(paragraphById(paragraphDocument(input),input.dataset.block));}
function rawFragment(input) {return paragraphValue(input).slice(Number(input.dataset.start),Number(input.dataset.start)+Number(input.dataset.length));}
function caretPosition(input,position=input.selectionStart) {return Number(input.dataset.start)+canonicalPosition(rawFragment(input),position);}
function clearParagraphSelection() {paragraphSelection=null;documentSelection=null;document.querySelectorAll('.paragraph-selected').forEach(input=>input.classList.remove('paragraph-selected'));document.querySelectorAll('.paragraph-range-highlight').forEach(el=>el.remove());manuscriptViewport?.pruneSoon();}
function selectedParagraph(input) {return paragraphSelection?.id===input.dataset.block&&paragraphSelection.scene===inputScene(input);}
function paragraphOverlay(input) {
  const overlay=document.createElement('div');overlay.className='paragraph-range-highlight';overlay.setAttribute('aria-hidden','true');
  const style=getComputedStyle(input);for(const key of ['font','lineHeight','letterSpacing','wordSpacing','padding','writingMode','textOrientation','textAlign','wordBreak','overflowWrap','tabSize'])overlay.style[key]=style[key];
  overlay.style.width=`${input.offsetWidth}px`;overlay.style.height=`${input.offsetHeight}px`;return overlay;
}
function revealParagraphCaret(input,local) {
  // Use a real glyph rect: WebKit can place a zero-width span at the wrong
  // vertical column when the paragraph extends far beyond the viewport.
  const mirror=paragraphOverlay(input),text=document.createTextNode(input.value||' ');
  mirror.append(text);input.after(mirror);
  const range=document.createRange();let index=Math.max(0,Math.min(local,text.length-1));
  if(index>0&&/[\uDC00-\uDFFF]/.test(text.data[index]))index--;
  range.setStart(text,index);range.setEnd(text,Math.min(text.length,index+1));
  const rect=range.getBoundingClientRect(),vertical=preferences.writingMode==='vertical';
  const root=input.closest('.group-manuscript')??input.closest(vertical?'.manuscript-pages':'.editor-content');
  if(root){const bounds=root.getBoundingClientRect(),margin=12;
    if(caretQA)invoke('performance_qa_caret',{values:[rect.left,rect.top,bounds.left,bounds.top,root.scrollLeft,root.scrollTop,input.scrollLeft,input.scrollTop,input.offsetWidth,input.offsetHeight]}).catch(()=>{});
    if(vertical){const delta=rect.left<bounds.left+margin?rect.left-bounds.left-margin:rect.right>bounds.right-margin?rect.right-bounds.right+margin:0;root.scrollLeft+=delta;}
    else {const delta=rect.top<bounds.top+margin?rect.top-bounds.top-margin:rect.bottom>bounds.bottom-margin?rect.bottom-bounds.bottom+margin:0;root.scrollTop+=delta;}
  }
  range.detach();mirror.remove();
}
function hitParagraphPosition(input,x,y) {
  // Native textarea hit testing cannot select into another textarea. A bounded
  // text mirror gives WebKit the same font and writing mode for pointer hits.
  const mirror=paragraphOverlay(input),text=document.createTextNode(input.value||' ');
  mirror.append(text);mirror.style.pointerEvents='auto';mirror.style.zIndex='4';input.after(mirror);
  const bounds=input.getBoundingClientRect();
  Object.assign(mirror.style,{position:'fixed',inset:'auto',left:`${bounds.left}px`,top:`${bounds.top}px`});
  const px=Math.max(bounds.left+1,Math.min(x,bounds.right-1)),py=Math.max(bounds.top+1,Math.min(y,bounds.bottom-1));
  const caret=document.caretPositionFromPoint?.(px,py),range=caret?null:document.caretRangeFromPoint?.(px,py);
  const node=caret?.offsetNode??range?.startContainer,offset=caret?.offset??range?.startOffset;
  let position=node===text?caretPosition(input,Math.min(offset,input.value.length)):null;
  if(position===null){
    // WebKit can return the underlying native textarea rather than its text
    // mirror. Range geometry still describes the same glyphs. Search in reading
    // order instead of measuring every glyph in a potentially large cell.
    const glyph=document.createRange();
    const best=hitTextPosition(text.data,px,py,preferences.writingMode==='vertical',(i,end)=>{glyph.setStart(text,i);glyph.setEnd(text,end);return glyph.getBoundingClientRect();});
    glyph.detach();position=caretPosition(input,Math.min(best,input.value.length));
  }
  mirror.remove();range?.detach();return position;
}
function paintParagraphSelection(input) {
  paintingSelection=true;
  document.querySelectorAll('.paragraph-range-highlight').forEach(el=>el.remove());
  const peers=manuscriptViewport?manuscriptViewport.paragraphBlocks(input).flatMap(block=>{const peer=block.querySelector('textarea');return peer?[peer]:[];}):paragraphInputs(input),{start,end}=selectionRange(paragraphSelection);
  for(const peer of peers){
    const part={start:Number(peer.dataset.start),text:rawFragment(peer)},range=fragmentSelection(part,paragraphSelection);
    peer.classList.toggle('paragraph-selected',peer!==input&&range.start===0&&range.end===part.text.length&&range.end>range.start);
    if(peer!==input&&range.end>range.start&&(range.start>0||range.end<part.text.length)){
      const overlay=paragraphOverlay(peer);
      const mark=document.createElement('mark');mark.textContent=part.text.slice(range.start,range.end).replace(/\r\n?/g,'\n');
      overlay.append(document.createTextNode(part.text.slice(0,range.start).replace(/\r\n?/g,'\n')),mark,document.createTextNode(part.text.slice(range.end).replace(/\r\n?/g,'\n')));peer.after(overlay);
    }
  }
  const raw=rawFragment(input),offset=Number(input.dataset.start),local=fragmentSelection({start:offset,text:raw},paragraphSelection);
  const nativeStart=raw.slice(0,local.start).replace(/\r\n?/g,'\n').length,nativeEnd=raw.slice(0,local.end).replace(/\r\n?/g,'\n').length,direction=paragraphSelection.focus<paragraphSelection.anchor?'backward':'forward';
  if(input.selectionStart!==nativeStart||input.selectionEnd!==nativeEnd||input.selectionDirection!==direction)input.setSelectionRange(nativeStart,nativeEnd,direction);
  paintingSelection=false;
  if(start===end)clearParagraphSelection();
}
function paintDocumentSelection(input) {
  if(!documentSelection)return;
  paintingSelection=true;
  try{
    const canonical=paragraphDocument(input);
    document.querySelectorAll('.paragraph-range-highlight').forEach(el=>el.remove());
    for(const peer of document.querySelectorAll('textarea[data-block]')){
      if(inputScene(peer)!==documentSelection.scene)continue;
      const selected=documentLeafRange(canonical,documentSelection,peer.dataset.block);
      const raw=rawFragment(peer),start=Number(peer.dataset.start);
      const local=selected?fragmentSelection({start,text:raw},{anchor:selected.start,focus:selected.end}):{start:0,end:0};
      peer.classList.toggle('paragraph-selected',peer!==input&&local.start===0&&local.end===raw.length&&local.end>local.start);
      if(peer===input){
        const a=raw.slice(0,local.start).replace(/\r\n?/g,'\n').length,b=raw.slice(0,local.end).replace(/\r\n?/g,'\n').length;
        peer.setSelectionRange(a,b,documentRange(canonical,documentSelection).forward?'forward':'backward');
      }else if(local.end>local.start&&(local.start>0||local.end<raw.length)){
        const overlay=paragraphOverlay(peer),mark=document.createElement('mark');mark.textContent=raw.slice(local.start,local.end).replace(/\r\n?/g,'\n');
        overlay.append(document.createTextNode(raw.slice(0,local.start).replace(/\r\n?/g,'\n')),mark,document.createTextNode(raw.slice(local.end).replace(/\r\n?/g,'\n')));peer.after(overlay);
      }
    }
  }finally{paintingSelection=false;}
}
function selectDocumentPoint(input,anchor,focus) {
  clearParagraphSelection();reflowing=true;focusLogicalParagraph(input,focus.offset);reflowing=false;
  documentSelection={scene:inputScene(input),anchor,focus};paintDocumentSelection(document.activeElement);
}
function setWholeManuscript(canonical,scene) {
  if(scene){const edit=groupEdit(scene);edit.whole=true;edit.canonical=canonical;edit.changes.clear();edit.version++;}
  else {draft??={};draft.canonical=canonical;wholeCanonicalDraft=true;pendingParagraphs.clear();draftVersion++;}
  status='unsaved';clearTimeout(autosaveTimer);if(!composing)autosaveTimer=setTimeout(()=>commitDraft(),900);
}
function applyDocumentReplacement(canonical,selection,text,scene) {
  const result=replaceDocumentSelection(canonical,selection,text);
  setWholeManuscript(result.document,scene);clearParagraphSelection();render();
  const scope=scene?document.querySelector(`[data-scene="${scene}"]`):document;
  mountManuscriptInput(scope,result.caret.id);
  const input=scope?.querySelector(`textarea[data-block="${result.caret.id}"]`);
  if(input)focusLogicalParagraph(input,result.caret.offset);
}
function captureDocumentReplacement(input) {
  if(!documentSelection||documentSelection.scene!==inputScene(input)||documentReplacement)return;
  documentReplacement={input,canonical:paragraphDocument(input),selection:{...documentSelection},scene:inputScene(input),before:input.value,start:input.selectionStart,end:input.selectionEnd,insert:''};
}
function documentReplacementInput(input) {
  const pending=documentReplacement;if(pending?.input!==input)return false;
  pending.insert=input.value.slice(pending.start,Math.max(pending.start,input.value.length-(pending.before.length-pending.end)));
  if(!composing){documentReplacement=null;applyDocumentReplacement(pending.canonical,pending.selection,pending.insert,pending.scene);}
  return true;
}
function finishDocumentReplacement(event) {
  const pending=documentReplacement;if(pending?.input!==event.target)return false;
  documentReplacementInput(event.target);documentReplacement=null;composing=false;compositionTarget=null;
  if(!event.data&&event.target.value===pending.before){documentSelection=pending.selection;paintDocumentSelection(event.target);}
  else applyDocumentReplacement(pending.canonical,pending.selection,pending.insert,pending.scene);
  return true;
}
function selectParagraphPosition(input,selection) {
  reflowing=true;focusLogicalParagraph(input,selection.focus);reflowing=false;
  paragraphSelection={id:input.dataset.block,scene:inputScene(input),...selection};paintParagraphSelection(document.activeElement);
}
function queueParagraphPatch(input,change) {
  const id=input.dataset.block,scene=inputScene(input),old=paragraphValue(input),text=old.slice(0,change.start)+change.text+old.slice(change.end),delta=characters(change.text)-characters(change.removed);
  if(scene){const edit=groupEdit(scene);edit.canonical=updateParagraph(edit.canonical,id,text,delta);edit.changes.set(id,[...(edit.changes.get(id)||[]),{start:change.start,end:change.end,text:change.text}]);edit.version++;}
  else {draft??={};draft.canonical=updateParagraph(draft.canonical??detail.properties.canonical,id,text,delta);pendingParagraphs.set(id,[...(pendingParagraphs.get(id)||[]),{start:change.start,end:change.end,text:change.text}]);draftVersion++;}
  status='unsaved';clearTimeout(autosaveTimer);if(!composing)autosaveTimer=setTimeout(()=>commitDraft(),900);
  const notice=document.querySelector('.notice span');if(notice)notice.textContent=t('unsaved');
}
function focusParagraphPosition(inputs,position) {
  const input=inputs.find(next=>position>=Number(next.dataset.start)&&position<=Number(next.dataset.start)+Number(next.dataset.length))??inputs.find(next=>Number(next.dataset.start)>position)??inputs.at(-1);
  if(!input)return;
  const raw=rawFragment(input),local=raw.slice(0,Math.max(0,position-Number(input.dataset.start))).replace(/\r\n?/g,'\n').length;
  resizeManuscript(input.closest('.manuscript-block'));input.focus({preventScroll:true});input.setSelectionRange(local,local);revealParagraphCaret(input,local);updateEmptyColumnCaret();
}
function focusLogicalParagraph(input,position) {
  focusParagraphPosition(manuscriptViewport?[manuscriptViewport.positionInput(input,position)]:paragraphInputs(input),position);
}
function reflowParagraph(input,position,focus=true) {
  if(input.closest('.dialogue-sheet'))return;
  const oldBlocks=manuscriptViewport?[...manuscriptViewport.paragraphBlocks(input)]:paragraphInputs(input).map(peer=>peer.closest('.manuscript-block')),node=paragraphById(paragraphDocument(input),input.dataset.block),template=document.createElement('template');
  for(const block of oldBlocks){manuscriptViewport?.attach(block);virtualSources.delete(block.dataset.manuscriptBlock);}
  template.innerHTML=paragraphMarkup(node,Boolean(manuscriptViewport),inputScene(input)??detail?.id);
  const wrappers=[...template.content.children],first=oldBlocks[0];
  reflowing=true;clearParagraphSelection();first.before(template.content);
  for(const block of oldBlocks){manuscriptViewport?.remove(block);block.remove();}
  for(const block of wrappers){manuscriptViewport?.register(block);if(!manuscriptViewport)resizeManuscript(block);}
  if(manuscriptViewport){
    const target=wrappers.find(block=>{const part=virtualSources.get(block.dataset.manuscriptBlock);return position>=part.start&&position<=part.start+part.text.length;})??wrappers.at(-1);
    manuscriptViewport.mount(target);if(focus)focusParagraphPosition([target.querySelector('textarea')],position);
  }else if(focus)focusParagraphPosition(wrappers.map(block=>block.querySelector('textarea')),position);
  reflowing=false;
}
document.addEventListener('pointerdown',event=>{
  pointerSelection=null;
  const input=event.target,active=document.activeElement;
  if(native&&!composing&&event.button===0&&event.shiftKey&&input.dataset.block&&active?.dataset.block&&inputScene(active)===inputScene(input)&&(documentSelection||active.dataset.block!==input.dataset.block)){
    const anchorPoint=documentSelection?.anchor??{id:active.dataset.block,offset:selectedParagraph(active)?paragraphSelection.anchor:caretPosition(active,active.selectionDirection==='backward'?active.selectionEnd:active.selectionStart)};
    pointerSelection={input,anchorPoint,pointer:event.pointerId,document:true};
    reflowing=true;input.focus({preventScroll:true});input.setSelectionRange(0,0);reflowing=false;return;
  }
  if(native&&!composing&&event.button===0&&event.shiftKey&&input.dataset.block&&!input.closest('.dialogue-sheet')&&active?.dataset.block===input.dataset.block&&inputScene(active)===inputScene(input)&&(manuscriptViewport?manuscriptViewport.paragraphBlocks(input).length:paragraphInputs(input).length)>1){
    const anchor=selectedParagraph(active)?paragraphSelection.anchor:caretPosition(active,active.selectionDirection==='backward'?active.selectionEnd:active.selectionStart);
    pointerSelection={input,anchor,pointer:event.pointerId};
    // Some engines keep focus in the old textarea on Shift-click. Give the
    // target native hit-testing a local anchor, retaining the logical anchor.
    if(input!==active){reflowing=true;input.focus({preventScroll:true});input.setSelectionRange(0,0);reflowing=false;}
    return;
  }
  clearParagraphSelection();
  if(native&&!composing&&event.button===0&&input.dataset.block){
    const owned=Boolean(input.closest('.dialogue-sheet')),anchor=owned?hitParagraphPosition(input,event.clientX,event.clientY):null;
    const pending={input,anchor,pointer:event.pointerId,drag:true,crossed:false,owned:owned&&anchor!==null};pointerSelection=pending;
    if(pending.owned){event.preventDefault();input.setPointerCapture(event.pointerId);reflowing=true;focusLogicalParagraph(input,anchor);reflowing=false;return;}
    // Let the native pointer default action establish the anchor. In WebKit,
    // a mirror inserted before pointerdown completes can report its start.
    requestAnimationFrame(()=>{if(pointerSelection===pending)pending.anchor=caretPosition(input,input.selectionDirection==='backward'?input.selectionEnd:input.selectionStart);});
  }
},true);
let selectionPointerFrame=0,selectionScrollFrame=0;
function scrollPointerSelection(){
  selectionScrollFrame=0;const pending=pointerSelection;if(!pending?.drag||!pending.point)return;
  const vertical=preferences.writingMode==='vertical',root=pending.input.closest('.group-manuscript')??pending.input.closest(vertical?'.manuscript-pages':'.editor-content');
  if(!root)return;const r=root.getBoundingClientRect(),{x,y}=pending.point,axis=vertical?x:y,min=vertical?r.left:r.top,max=vertical?r.right:r.bottom;
  const delta=axis<min+28?-Math.min(22,(min+28-axis)/3):axis>max-28?Math.min(22,(axis-max+28)/3):0;
  if(delta){const before=vertical?root.scrollLeft:root.scrollTop;if(vertical)root.scrollLeft+=delta;else root.scrollTop+=delta;
    if((vertical?root.scrollLeft:root.scrollTop)!==before)extendPointerSelection({pointerId:pending.pointer,buttons:1,clientX:x,clientY:y});
  }
  selectionScrollFrame=requestAnimationFrame(scrollPointerSelection);
}

function pointerParagraph(block,x,y){
  const direct=document.elementFromPoint(x,y)?.closest('textarea[data-block]');
  if(direct&&block.contains(direct))return direct;
  // A newly mounted dialogue block may not be hit-tested until the next frame.
  let closest=null,distance=Infinity;
  for(const input of block.querySelectorAll('textarea[data-block]')){
    const r=input.getBoundingClientRect(),dx=Math.max(r.left-x,0,x-r.right),dy=Math.max(r.top-y,0,y-r.bottom),d=dx*dx+dy*dy;
    if(d<distance){closest=input;distance=d;}
  }
  return closest;
}
function extendPointerSelection(event){
  const pending=pointerSelection;if(!pending?.drag||pending.pointer!==event.pointerId||pending.anchor===null||!event.buttons)return;
  cancelAnimationFrame(selectionPointerFrame);
  pending.point={x:event.clientX,y:event.clientY};if(!selectionScrollFrame)selectionScrollFrame=requestAnimationFrame(scrollPointerSelection);
  const root=pending.input.closest('.group-manuscript')??pending.input.closest(preferences.writingMode==='vertical'?'.manuscript-pages':'.editor-content'),bounds=root?.getBoundingClientRect();
  const x=bounds?Math.max(bounds.left+2,Math.min(event.clientX,bounds.right-2)):event.clientX,y=bounds?Math.max(bounds.top+2,Math.min(event.clientY,bounds.bottom-2)):event.clientY;
  selectionPointerFrame=requestAnimationFrame(()=>{
    if(pointerSelection!==pending)return;
    const block=document.elementFromPoint(x,y)?.closest('.manuscript-block');
    if(!block||inputScene(block)!==inputScene(pending.input))return;
    manuscriptViewport?.mount(block);
    const target=pointerParagraph(block,x,y);if(!target||target===pending.input&&!pending.crossed&&!pending.owned)return;
    const focus=hitParagraphPosition(target,x,y);if(focus===null)return;
    pending.anchorPoint??={id:pending.input.dataset.block,offset:pending.anchor};
    pending.crossed=true;pending.focus=focus;
    if(target.dataset.block===pending.anchorPoint.id&&!documentSelection)selectParagraphPosition(target,pointSelection(paragraphValue(target).length,pending.anchor,focus));
    else selectDocumentPoint(target,pending.anchorPoint,{id:target.dataset.block,offset:focus});
    pending.input=target;
  });
}
document.addEventListener('pointermove',extendPointerSelection);
document.addEventListener('mousemove',event=>{if(pointerSelection?.drag)extendPointerSelection({pointerId:pointerSelection.pointer,buttons:event.buttons||1,clientX:event.clientX,clientY:event.clientY});});
function finishPointerSelection(event){
  const pending=pointerSelection;if(!pending||pending.pointer!==event.pointerId)return;
  // Read WebKit's native hit-tested caret after its pointer default action.
  requestAnimationFrame(()=>{
    if(pointerSelection!==pending)return;
    if(pending.drag){
      // A native text drag can suppress intermediate pointer events on macOS.
      // Always resolve the release point, including a move across a block.
      const block=document.elementFromPoint(event.clientX,event.clientY)?.closest('.manuscript-block');
      if(block&&inputScene(block)===inputScene(pending.input)){
        manuscriptViewport?.mount(block);
        const target=pointerParagraph(block,event.clientX,event.clientY);
        if(target&&(target!==pending.input||pending.owned)){
          const focus=hitParagraphPosition(target,event.clientX,event.clientY);
          if(focus!==null){pending.anchorPoint??={id:pending.input.dataset.block,offset:pending.anchor};pending.crossed=true;pending.focus=focus;
            if(target.dataset.block===pending.anchorPoint.id&&!documentSelection)selectParagraphPosition(target,pointSelection(paragraphValue(target).length,pending.anchor,focus));
            else selectDocumentPoint(target,pending.anchorPoint,{id:target.dataset.block,offset:focus});
            pending.input=target;
          }
        }
      }
    }
    pointerSelection=null;cancelAnimationFrame(selectionScrollFrame);selectionScrollFrame=0;const input=pending.input;
    if(pending.drag&&!pending.crossed)return;
    if(pending.document){selectDocumentPoint(input,pending.anchorPoint,{id:input.dataset.block,offset:caretPosition(input,input.selectionDirection==='backward'?input.selectionStart:input.selectionEnd)});return;}
    if(pending.drag&&documentSelection){paintDocumentSelection(input);return;}
    if(!input.isConnected||document.activeElement!==input){clearParagraphSelection();return;}
    const focus=pending.drag?pending.focus:caretPosition(input,input.selectionDirection==='backward'?input.selectionStart:input.selectionEnd);
    selectParagraphPosition(input,pointSelection(paragraphValue(input).length,pending.anchor,focus));
  });
}
document.addEventListener('pointerup',finishPointerSelection);
document.addEventListener('mouseup',event=>{if(pointerSelection?.drag)finishPointerSelection({pointerId:pointerSelection.pointer,clientX:event.clientX,clientY:event.clientY});});
function cancelPointerSelection(){cancelAnimationFrame(selectionScrollFrame);selectionScrollFrame=0;if(pointerSelection){pointerSelection=null;clearParagraphSelection();}}
document.addEventListener('pointercancel',event=>{if(event.pointerType!=='mouse')cancelPointerSelection();});
window.addEventListener('blur',cancelPointerSelection);
// macOS Edit > Select All can select the native textarea without a DOM keydown.
document.addEventListener('select',event=>{
  const input=event.target;if(reflowing||paintingSelection||pointerSelection||paragraphSelection||documentSelection||composing||!native||!input.dataset.block||input.closest('.dialogue-sheet')||!input.value.length||input.selectionStart!==0||input.selectionEnd!==input.value.length)return;
  if((manuscriptViewport?manuscriptViewport.paragraphBlocks(input).length:paragraphInputs(input).length)<2)return;
  paragraphSelection={id:input.dataset.block,scene:inputScene(input),anchor:0,focus:paragraphValue(input).length};paintParagraphSelection(input);
},true);
document.addEventListener('selectionchange',()=>{
  if(paintingSelection||reflowing||pointerSelection)return;
  const input=document.activeElement;
  if(documentSelection){
    if(composing||documentReplacement)return;
    if(!input?.dataset.block||inputScene(input)!==documentSelection.scene){clearParagraphSelection();return;}
    const selected=documentLeafRange(paragraphDocument(input),documentSelection,input.dataset.block);
    const local=selected?fragmentSelection({start:Number(input.dataset.start),text:rawFragment(input)},{anchor:selected.start,focus:selected.end}):{start:0,end:0};
    if(caretPosition(input)!==Number(input.dataset.start)+local.start||caretPosition(input,input.selectionEnd)!==Number(input.dataset.start)+local.end)clearParagraphSelection();
    return;
  }
  if(!paragraphSelection)return;
  if(!input?.dataset.block||!selectedParagraph(input)){clearParagraphSelection();return;}
  const local=fragmentSelection({start:Number(input.dataset.start),text:rawFragment(input)},paragraphSelection);
  if(caretPosition(input)!==Number(input.dataset.start)+local.start||caretPosition(input,input.selectionEnd)!==Number(input.dataset.start)+local.end)clearParagraphSelection();
});
function captureSelectionReplacement(input,retainComposition=false) {
  if(!input.dataset.block||!selectedParagraph(input)||selectionReplacements.has(input))return;
  selectionReplacements.set(input,{selection:{...paragraphSelection},before:input.value,start:input.selectionStart,end:input.selectionEnd,parts:retainComposition?(manuscriptViewport?manuscriptViewport.replacementParts(input,paragraphValue(input)):paragraphInputs(input).map(peer=>({input:peer,block:peer.closest('.manuscript-block'),start:Number(peer.dataset.start),text:rawFragment(peer)}))):null});
}
document.addEventListener('beforeinput',event=>{
  if(native&&event.target.dataset.block&&!composing&&['historyUndo','historyRedo'].includes(event.inputType)){
    event.preventDefault();if(!busy)mutate({kind:event.inputType==='historyUndo'?'undo':'redo'});return;
  }
  captureDocumentReplacement(event.target);captureSelectionReplacement(event.target,composing||event.isComposing);
});
document.addEventListener('keydown',event=>{
  if(!native||!event.target.dataset.block||composing||event.isComposing||!(event.metaKey||event.ctrlKey)||event.key.toLowerCase()!=='z')return;
  event.preventDefault();event.stopImmediatePropagation();if(!busy)mutate({kind:event.shiftKey?'redo':'undo'});
},true);
document.addEventListener('keydown',event=>{
  const input=event.target;if(!native||!input.dataset.block||composing||event.isComposing||event.keyCode===229)return;
  const backward=preferences.writingMode==='vertical'?'ArrowUp':'ArrowLeft',forward=preferences.writingMode==='vertical'?'ArrowDown':'ArrowRight';
  if(documentSelection&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='a'){
    event.preventDefault();event.stopImmediatePropagation();const canonical=paragraphDocument(input),{index}=documentRange(canonical,documentSelection),first=index.ordered[0].node,last=index.ordered.at(-1).node,scope=input.closest('.group-scene')??document;
    mountManuscriptInput(scope,last.id);const target=scope.querySelector(`textarea[data-block="${last.id}"]`);
    if(target)selectDocumentPoint(target,{id:first.id,offset:0},{id:last.id,offset:paragraphText(last).length});return;
  }
  if(documentSelection&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&[backward,forward].includes(event.key)){
    event.preventDefault();event.stopImmediatePropagation();const range=documentRange(paragraphDocument(input),documentSelection),point=event.key===forward?range.end:range.start,scope=input.closest('.group-scene')??document;
    mountManuscriptInput(scope,point.id);const target=scope.querySelector(`textarea[data-block="${point.id}"]`);clearParagraphSelection();if(target)focusLogicalParagraph(target,point.offset);return;
  }
  if(event.shiftKey&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&[backward,forward].includes(event.key)){
    const canonical=paragraphDocument(input),direction=event.key===forward?1:-1;
    const point=documentSelection?.focus??{id:input.dataset.block,offset:selectedParagraph(input)?paragraphSelection.focus:caretPosition(input,direction<0?input.selectionStart:input.selectionEnd)};
    const next=moveDocumentPoint(canonical,point,direction);
    if(documentSelection||next.id!==point.id){
      event.preventDefault();event.stopImmediatePropagation();
      const anchor=documentSelection?.anchor??{id:input.dataset.block,offset:selectedParagraph(input)?paragraphSelection.anchor:caretPosition(input,input.selectionDirection==='backward'?input.selectionEnd:input.selectionStart)};
      mountManuscriptInput(input.closest('.group-scene')??document,next.id);
      const scope=input.closest('.group-scene')??document,target=scope.querySelector(`textarea[data-block="${next.id}"]`);
      if(target)selectDocumentPoint(target,anchor,next);return;
    }
  }
  if(documentSelection&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&!event.shiftKey&&['Backspace','Delete'].includes(event.key)){
    event.preventDefault();event.stopImmediatePropagation();applyDocumentReplacement(paragraphDocument(input),documentSelection,'',inputScene(input));
  }
});
document.addEventListener('keydown',event=>{
  const input=event.target;if(!native||!input.dataset.block||composing||event.isComposing||event.keyCode===229||input.closest('.dialogue-sheet'))return;
  if((manuscriptViewport?manuscriptViewport.paragraphBlocks(input).length:paragraphInputs(input).length)<2)return;
  if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='a'){event.preventDefault();selectParagraphPosition(input,{anchor:0,focus:paragraphValue(input).length});return;}
  const backward=preferences.writingMode==='vertical'?'ArrowUp':'ArrowLeft',forward=preferences.writingMode==='vertical'?'ArrowDown':'ArrowRight';
  if(event.shiftKey&&!event.metaKey&&!event.ctrlKey&&!event.altKey&&[backward,forward].includes(event.key)){
    event.preventDefault();const direction=event.key===forward?1:-1;
    const selection=selectedParagraph(input)?paragraphSelection:{anchor:caretPosition(input,input.selectionDirection==='backward'?input.selectionEnd:input.selectionStart),focus:caretPosition(input,input.selectionDirection==='backward'?input.selectionStart:input.selectionEnd)};
    selectParagraphPosition(input,extendSelection(paragraphValue(input),selection,direction));return;
  }
  if(event.shiftKey||event.metaKey||event.ctrlKey||event.altKey)return;
  if(selectedParagraph(input)&&['Backspace','Delete'].includes(event.key)){
    event.preventDefault();const text=paragraphValue(input),{start,end}=selectionRange(paragraphSelection);clearParagraphSelection();queueParagraphPatch(input,{start,end,text:'',removed:text.slice(start,end)});reflowParagraph(input,start);return;
  }
  if(selectedParagraph(input)&&[backward,forward].includes(event.key)){event.preventDefault();const range=selectionRange(paragraphSelection),position=event.key===forward?range.end:range.start;clearParagraphSelection();focusLogicalParagraph(input,position);return;}
  if(![backward,forward,'Backspace','Delete'].includes(event.key)||input.selectionStart!==input.selectionEnd)return;
  const start=input.selectionStart===0,end=input.selectionStart===input.value.length,pos=caretPosition(input),text=paragraphValue(input);
  const direction=(start&&[backward,'Backspace'].includes(event.key))?-1:(end&&[forward,'Delete'].includes(event.key))?1:0;
  if(!direction)return;
  const target=graphemeStep(text,pos,direction);if(target===pos)return;
  event.preventDefault();clearParagraphSelection();
  if(event.key==='Backspace'||event.key==='Delete'){const from=Math.min(pos,target),to=Math.max(pos,target);queueParagraphPatch(input,{start:from,end:to,text:'',removed:text.slice(from,to)});reflowParagraph(input,from);}
  else focusLogicalParagraph(input,target);
});
for(const type of ['copy','cut'])document.addEventListener(type,event=>{
  const input=document.activeElement;if(!input?.dataset.block||!event.clipboardData)return;
  if(documentSelection){event.preventDefault();event.clipboardData.setData('text/plain',documentSelectionText(paragraphDocument(input),documentSelection));if(type==='cut')applyDocumentReplacement(paragraphDocument(input),documentSelection,'',inputScene(input));return;}
  if(!selectedParagraph(input))return;
  const text=paragraphValue(input),{start,end}=selectionRange(paragraphSelection);event.preventDefault();event.clipboardData.setData('text/plain',text.slice(start,end));
  if(type==='cut'){clearParagraphSelection();queueParagraphPatch(input,{start,end,text:'',removed:text.slice(start,end)});reflowParagraph(input,start);}
});
document.addEventListener('input',event=>{
  if(event.target.dataset.block) {
    if(documentReplacementInput(event.target))return;
    const input=event.target,start=Number(input.dataset.start||0),replacement=selectionReplacements.get(input);
    selectionReplacements.delete(input);
    const range=replacement?selectionRange(replacement.selection):null;
    const inserted=replacement?input.value.slice(replacement.start,Math.max(replacement.start,input.value.length-(replacement.before.length-replacement.end))):null;
    const change=replacement?{...range,text:inserted,removed:paragraphValue(input).slice(range.start,range.end)}:inputPatch(rawFragment(input),input.value,start);
    if(change.start===change.end&&!change.text)return;
    queueParagraphPatch(input,change);
    const position=replacement?range.start+inserted.length:start+canonicalPosition(paragraphValue(input).slice(start,start+Number(input.dataset.length)+change.text.length-(change.end-change.start)),input.selectionStart);
    if(replacement){
      clearParagraphSelection();
      if(!composing){reflowParagraph(input,position);return;}
      const retained=replaceSelectionFragments(replacement.parts,replacement.parts.findIndex(part=>part.input===input),replacement.selection,inserted);
      retained.forEach((part,index)=>{
        const {input:peer,block}=replacement.parts[index];
        if(!part){manuscriptViewport?.remove(block);virtualSources.delete(block.dataset.manuscriptBlock);block.remove();return;}
        const source=virtualSources.get(block.dataset.manuscriptBlock);if(source){source.start=part.start;if(!part.unchanged)source.text=part.text;}
        if(peer){peer.dataset.start=String(part.start);if(!part.unchanged){peer.dataset.length=String(part.text.length);if(peer!==input)peer.value=part.text.replace(/\r\n?/g,'\n');}}
        manuscriptViewport?.updateFragment(block,part);
      });
      compositionReflow.add(input);
    }else {
      const delta=change.text.length-(change.end-change.start);input.dataset.length=String(Number(input.dataset.length)+delta);
      if(manuscriptViewport)manuscriptViewport.shiftOffsets(input,delta);
      else for(const next of paragraphInputs(input))if(next!==input&&Number(next.dataset.start)>start)next.dataset.start=String(Number(next.dataset.start)+delta);
      if(!composing&&Number(input.dataset.length)>16384&&!input.closest('.dialogue-sheet')){reflowParagraph(input,position);return;}
    }
    const block=input.closest('.manuscript-block');
    if(manuscriptViewport)manuscriptViewport.measureBlock(block);else resizeManuscript(block);
    updateEmptyColumnCaret();return;
  }
  if(event.target.dataset.outlineTitle){
    titleEdits.set(event.target.dataset.outlineTitle,{value:event.target.value});
    status='unsaved';clearTimeout(autosaveTimer);if(!composing)autosaveTimer=setTimeout(()=>commitDraft(),900);
    resizeOutlineTitle(event.target);
    const notice=document.querySelector('.notice span');if(notice)notice.textContent=t('unsaved');return;
  }
  const key=event.target.dataset.field;if(!key||(!detail&&key!=='projectTitle'))return;
  draft??={};draft[key]=event.target.type==='checkbox'?event.target.checked:event.target.value;draftVersion++;status='unsaved';clearTimeout(autosaveTimer);if(!composing)autosaveTimer=setTimeout(()=>commitDraft(),900);
  if(event.target.closest('.group-title')&&preferences.writingMode==='horizontal'){event.target.style.height='0px';event.target.style.height=`${event.target.scrollHeight}px`;}
  const notice=document.querySelector('.notice span');if(notice)notice.textContent=t('unsaved');
});
document.addEventListener('compositionstart',event=>{captureDocumentReplacement(event.target);captureSelectionReplacement(event.target,true);composing=true;compositionTarget=event.target;updateEmptyColumnCaret();clearTimeout(autosaveTimer);});
document.addEventListener('compositionend',event=>{if(finishDocumentReplacement(event))return;composing=false;compositionTarget=null;selectionReplacements.delete(event.target);if(event.target.dataset.block&&(compositionReflow.has(event.target)||Number(event.target.dataset.length)>16384)){compositionReflow.delete(event.target);reflowParagraph(event.target,caretPosition(event.target));}manuscriptViewport?.pruneSoon();updateEmptyColumnCaret();clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>commitDraft(),900);});
document.addEventListener('focusin',event=>{const scene=inputScene(event.target);if(scene)groupFocus=scene;});
document.addEventListener('focusout',event=>{if(reflowing)return;manuscriptViewport?.pruneSoon();if(event.target.dataset.block){bodyCaret={scene:inputScene(event.target)??detail.id,id:event.target.dataset.block,start:caretPosition(event.target),end:caretPosition(event.target,event.target.selectionEnd)};if(!busy&&!composing&&!widthDrag)commitDraft();}if((event.target.dataset.field||event.target.dataset.outlineTitle)&&!busy&&!composing)commitDraft();});
document.addEventListener('change',async event=>{
  if(event.target.matches('[data-writing-mode]')){if(!await commitDraft())return;await savePreferences({...preferences,writingMode:event.target.value});return;}
  if(event.target.id==='language'){if(!await commitDraft())return;await savePreferences({...preferences,language:event.target.value});}
  if(event.target.id==='path'){if(!await commitDraft())return;path=event.target.value;const first=routeNodes(model.nodes,path)[0];if(first)await choose(first.id);else render();}
});
function clearDropMarks() {document.querySelectorAll('.drop-before,.drop-after,.drop-inside').forEach(el=>el.classList.remove('drop-before','drop-after','drop-inside'));}
function dropAction(event) {
  const row=event.target.closest('.node-row[data-select]')||event.target.closest('.outline-row')?.querySelector('.node-row[data-select]');
  if(row){const bounds=row.getBoundingClientRect();return outlineDrop(model.nodes,draggingOutlineId,row.dataset.select,event.clientY<bounds.top+bounds.height/2?'before':'after');}
  return event.target.closest('.node-list')?outlineDrop(model.nodes,draggingOutlineId,null,'root'):null;
}
document.addEventListener('dragstart',event=>{
  const row=event.target.closest('.node-row[draggable=true]');
  if(!row||busy||composing){event.preventDefault();return;}
  draggingOutlineId=row.dataset.select;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('application/x-story-outline',draggingOutlineId);
});
document.addEventListener('dragover',event=>{
  if(!draggingOutlineId)return;
  clearDropMarks();const action=dropAction(event);
  if(!action){event.dataTransfer.dropEffect='none';return;}
  event.preventDefault();event.dataTransfer.dropEffect='move';
  (event.target.closest('.node-row')||event.target.closest('.node-list')).classList.add(`drop-${action.position==='root'?'inside':action.position}`);
});
document.addEventListener('drop',async event=>{
  if(!draggingOutlineId)return;
  const action=dropAction(event);event.preventDefault();clearDropMarks();draggingOutlineId=null;
  if(action){await mutate(action);}
});
let outlineMenu=null, outlineMenuAnchor=null;
function closeOutlineMenu(restoreFocus=false) {
  outlineMenu?.remove();outlineMenu=null;
  if(restoreFocus)outlineMenuAnchor?.focus({preventScroll:true});
  outlineMenuAnchor=null;
}
async function renameOutline(id) {
  if(!await commitDraft())return;
  const node=await invoke('selected',{id});
  if(!['story.block','story.sequence','story.scene'].includes(node.type_id))return;
  const initial=node.properties.title||'';
  const dialog=document.createElement('dialog');dialog.className='rename-dialog';
  dialog.setAttribute('aria-labelledby','rename-heading');
  dialog.innerHTML=`<form><h2 id="rename-heading">${escape(t('rename'))}</h2><label>${escape(t('name'))}<input name="title" value="${escape(initial)}" maxlength="200" required autocomplete="off"></label><p class="preferences-error" role="status"></p><footer><button type="button" data-rename-cancel>${escape(t('cancel'))}</button><button type="submit">${escape(t('rename'))}</button></footer></form>`;
  document.body.append(dialog);
  dialog.addEventListener('close',()=>{dialog.remove();document.querySelector(`.node-row[data-select="${id}"]`)?.focus({preventScroll:true});});
  dialog.querySelector('[data-rename-cancel]').onclick=()=>dialog.close();
  dialog.querySelector('form').onsubmit=async event=>{
    event.preventDefault();const input=dialog.querySelector('input'),title=input.value.trim();
    if(!title){input.setCustomValidity(t('renameRequired'));input.reportValidity();return;}
    const submit=dialog.querySelector('[type=submit]');submit.disabled=true;
    try {
      const current=await invoke('selected',{id});
      if(current.properties.title!==node.properties.title)throw 'revision_conflict';
      await mutate({kind:'property',id,key:'title',value:title});
      if(error)throw error;
      dialog.close();
    }catch(e){dialog.querySelector('[role=status]').textContent=t(String(e));submit.disabled=false;}
  };
  const input=dialog.querySelector('input');input.oninput=()=>input.setCustomValidity('');
  dialog.showModal();input.focus();input.select();
}
function openOutlineMenu(event) {
  const row=event.target.closest('.outline-row[role="treeitem"]')?.querySelector('.node-row[data-select]');
  if(!row)return;
  event.preventDefault();event.stopImmediatePropagation();
  closeOutlineMenu();closeMenus();outlineMenuAnchor=row;
  const id=row.dataset.select;
  outlineMenu=document.createElement('div');outlineMenu.className='outline-context-menu';outlineMenu.setAttribute('role','menu');outlineMenu.setAttribute('aria-label',t('edit'));
  outlineMenu.innerHTML=`<button role="menuitem" data-outline-rename ${!native||busy?'disabled':''}><span>${escape(t('rename'))}</span></button><button role="menuitem" data-outline-delete ${!native||busy?'disabled':''}>${icon('trash')}<span>${escape(t('remove'))}</span></button>`;
  const sceneNode=model.nodes.find(n=>n.id===id&&n.type==='story.scene');
  if(sceneNode){
    const siblings=model.nodes.filter(n=>n.type==='story.scene'&&n.parent===sceneNode.parent).sort((a,b)=>a.outlineOrder-b.outlineOrder||a.id.localeCompare(b.id));
    const next=siblings[siblings.findIndex(n=>n.id===id)+1];
    for(const mode of ['split','merge']){
      const button=document.createElement('button');button.setAttribute('role','menuitem');button.textContent=t(mode==='split'?'splitScene':'mergeScene');button.disabled=!native||busy||(mode==='merge'&&!next);
      button.onclick=async event=>{event.stopPropagation();closeOutlineMenu();try{if(!await commitDraft())return;const scene=await invoke('selected',{id});const revision=model.revision;restructureScene({scene,next,mode,t,escape,save:async action=>{model=await invoke('edit',{expectedRevision:revision,action});model=await invoke('choose',{id:action.id??action.first});await loadDetail(model.selected);render();}});}catch(e){error=String(e);render();}};
      outlineMenu.append(button);
    }
  }
  document.body.append(outlineMenu);
  const bounds=row.getBoundingClientRect();
  const x=event.clientX||bounds.left+20,y=event.clientY||bounds.bottom;
  outlineMenu.style.left=`${Math.max(4,Math.min(x,innerWidth-outlineMenu.offsetWidth-4))}px`;
  outlineMenu.style.top=`${Math.max(4,Math.min(y,innerHeight-outlineMenu.offsetHeight-4))}px`;
  outlineMenu.querySelector('[data-outline-rename]').addEventListener('click',async event=>{
    event.stopPropagation();closeOutlineMenu();
    try{await renameOutline(id);}catch(e){error=String(e);render();}
  });
  outlineMenu.querySelector('[data-outline-delete]').addEventListener('click',async event=>{
    event.stopPropagation();closeOutlineMenu();
    if(confirm(t('deleteConfirm')))await mutate({kind:'remove',id});
  });
  outlineMenu.querySelector('button').focus({preventScroll:true});
}
document.addEventListener('contextmenu',openOutlineMenu);
document.addEventListener('click',event=>{if(event.ctrlKey&&event.button===0)openOutlineMenu(event);},true);
document.addEventListener('pointerdown',event=>{if(outlineMenu&&!outlineMenu.contains(event.target))closeOutlineMenu();});
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&outlineMenu){event.preventDefault();closeOutlineMenu(true);}
  else if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))openOutlineMenu(event);
});
window.addEventListener('resize',()=>closeOutlineMenu());
document.addEventListener('scroll',()=>closeOutlineMenu(),true);
document.addEventListener('dragend',()=>{draggingOutlineId=null;clearDropMarks();});
document.addEventListener('click',async event=>{
  if(event.target.closest('#preferences-dialog,.assistant-dialog,.rename-dialog,.workspace-dialog,.history-panel'))return;
  const element=event.target.closest('button');if(!element||element.disabled)return;
  try {
    if(element.dataset.collapse){if(!await commitDraft())return;const id=element.dataset.collapse;collapsedOutline.has(id)?collapsedOutline.delete(id):collapsedOutline.add(id);render();return;}
    if(element.dataset.select){await choose(element.dataset.select);return;}
    if(element.dataset.tab){if(!await commitDraft())return;if(element.dataset.tab!=='history')embeddedGraph=false;if(native&&!panelWindow&&element.dataset.tab==='history'){await toggleHistoryPanel(invoke);return;}if(native&&panelWindow==='navigator'&&element.dataset.tab==='history'){await invoke('float_side_panel',{panel:'history',floating:true});return;}tab=element.dataset.tab;reading=false;render();return;}
    const action=element.dataset.action;closeMenus();
    if(action==='exportGraph'){if(!native||busy||!await commitDraft())return;closeMenus();busy=true;error='';render();try{const destination=await invoke('export_graph',{format:element.dataset.format,language});if(destination)status='exportReady';}catch(e){error=String(e);}finally{busy=false;render();}return;}
    if(action==='export'){
      if(!native||busy||!await commitDraft())return;
      const scope=await exportScope({t,escape,selected:detail&&['story.block','story.sequence','story.scene'].includes(detail.type_id)?detail.id:null,path});if(!scope)return;
      const settings=['pdf','script'].includes(element.dataset.format)?await pdfSettings({t,escape,script:element.dataset.format==='script'}):null;if(['pdf','script'].includes(element.dataset.format)&&!settings)return;
      if(!await commitDraft())return;busy=true;error='';render();
      try{const destination=await invoke('export_manuscript',{format:element.dataset.format,language,scope,settings});if(destination)status='exportReady';}
      catch(e){error=String(e);}finally{busy=false;render();}return;
    }
    if(action==='toggleLeftPanel'||action==='toggleRightPanel'){const key=action==='toggleLeftPanel'?'leftPanelOpen':'rightPanelOpen';await savePreferences({...preferences,[key]:!preferences[key]});return;}
    if(action==='newWorkspace'){if(await commitDraft())await invoke('new_workspace');return;}
    if(action==='openWorkspace'){if(await commitDraft())await showWorkspaces();return;}
    if(action==='paths'){if(!native||busy||!await commitDraft())return;const expectedRevision=model.revision;openPaths({paths:model.paths,nodes:model.nodes,selected:path,t,escape,save:async(definitions,key,outlinePath)=>{busy=true;try{model=await invoke('edit',{expectedRevision,action:{kind:'paths',paths:definitions,outline_path:outlinePath}});path=key;const current=model.nodes.find(n=>n.id===model.selected);if(current?.type==='story.scene'&&!Object.hasOwn(current.routes,key)){const first=definitions.find(p=>(p.legacy??p.id)===key)?.scenes[0];if(first)model=await invoke('choose',{id:first});}await loadDetail(model.selected);status='saved';}finally{busy=false;render();}}});return;}
    if(action==='narrative'){if(!native||busy||!await commitDraft())return;await openNarrative({invoke,nodes:model.nodes,paths:model.paths,t,escape,save:async(declarations,expectedRevision)=>{const selected=detail?.id;busy=true;try{model=await invoke('edit',{expectedRevision,action:{kind:'narrative',declarations}});await loadDetail(selected??model.selected);status='saved';}finally{busy=false;render();}}});return;}
    if(action==='search'){if(await commitDraft())showSearch();return;}
    if(action==='exportArchive'||action==='importArchive'){if(!native||busy||!await commitDraft())return;busy=true;error='';render();try{const done=await invoke(action==='exportArchive'?'export_archive':'import_archive');if(done)status=action==='exportArchive'?'archiveReady':'saved';}catch(e){error=String(e);}finally{busy=false;render();}return;}
    if(action==='exportSharedWorkspace'||action==='exportSharedArchive'||action==='exportSharedHistory'){if(!native||busy||!await commitDraft())return;busy=true;error='';render();try{if(await invoke(action==='exportSharedWorkspace'?'export_shared_workspace':'export_shared_archive',action==='exportSharedWorkspace'?{}:{history:action==='exportSharedHistory'}))status='exportReady';}catch(e){error=String(e);}finally{busy=false;render();}return;}
    if(action==='importWorkspace'){if(await commitDraft()){busy=true;try{await invoke('import_workspace');}finally{busy=false;render();}}return;}
    if(action==='restoreBackup'){if(await commitDraft())await showBackups();return;}
    if(action==='preferences'){showPreferences();return;}
    if(action==='importPortrait'){await importPortrait();return;}
    if(action==='removePortrait'){await mutate({kind:'property',id:detail.id,key:'portrait',value:''});return;}
    if(action==='writingAssist'){if(await commitDraft())await openAssistant();return;}
    if(action==='dialogue') {
      if(!await commitDraft())return;
      const scene=writingScene();if(!scene)return;
      const added=insertDialogue(scene.properties.canonical,bodyCaret?.scene===scene.id?bodyCaret:null);
      if(isContainer()){const edit=groupEdit(scene.id);edit.whole=true;edit.canonical=added.document;edit.version++;}
      else {wholeCanonicalDraft=true;draft={canonical:added.document};draftVersion++;}
      await commitDraft();
      const scope=isContainer()?document.querySelector(`[data-scene="${scene.id}"]`):document;
      mountManuscriptInput(scope,added.focus);
      const actor=scope?.querySelector(`[data-block="${added.focus}"]`);actor?.focus();return;
    }
    if(action==='save'){await commitDraft();return;}
    if(['newBlock','newSequence','newScene','newCharacter','newRelation'].includes(action)){if(await commitDraft())createDialog(action);return;}
    if(action==='cancel'){document.getElementById('create-dialog').close();return;}
    if(action==='undo'||action==='redo'){await mutate({kind:action});return;}
    if(action==='remove'){if(confirm(t('deleteConfirm')))await mutate({kind:'remove',id:detail.id});return;}
    if(action==='refresh'){if(dirty()){pendingRemote=await invoke('workspace');latestDetail=await invoke('selected',{id:detail.id});render();}else await refresh();return;}
    if(action==='applyDraft' && pendingRemote){model=pendingRemote;pendingRemote=null;latestDetail=null;error='';await commitDraft();return;}
    if(action==='discardDraft'){draft=null;latestDetail=null;error='';await refresh();return;}
    if(!await commitDraft())return;
    if(action==='graph'){if(!await commitDraft())return;embeddedGraph=!embeddedGraph;render();return;}
    if(action==='floatGraph'){embeddedGraph=false;render();await invoke('canvas');}
    if(action==='backup'){backupPath=await invoke('backup');status='backupReady';render();}
    if(action==='float'||action==='dock')await invoke('panel',{floating:action==='float'});
    if(action==='read'||action==='write'){embeddedGraph=false;reading=action==='read';render();}
  }catch(e){error=String(e);render();}
});
document.addEventListener('click',event=>{if(!event.target.closest('.app-menu'))closeMenus();});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.app-menu')&&event.target.open)document.querySelectorAll('.app-menu[open]').forEach(menu=>{if(menu!==event.target)menu.open=false;});},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenus();if(event.key==='ArrowDown'&&event.target.matches('.app-menu>summary')){event.preventDefault();event.target.parentElement.open=true;event.target.parentElement.querySelector('button:not(:disabled)')?.focus();}});
document.addEventListener('pointerover',event=>{const submenu=event.target.closest('.export-submenu');if(submenu?.closest('.app-menu[open]'))submenu.open=true;});
document.addEventListener('click',event=>{if(event.target.closest('.export-submenu>summary')){event.preventDefault();event.target.closest('.export-submenu').open=true;}});
document.addEventListener('keydown',event=>{if(['ArrowRight','ArrowDown'].includes(event.key)&&event.target.matches('.export-submenu>summary')){event.preventDefault();event.target.parentElement.open=true;event.target.parentElement.querySelector('button:not(:disabled)')?.focus();}});
document.addEventListener('keydown',async event=>{if(native&&(event.metaKey||event.ctrlKey)&&event.key==='n'){event.preventDefault();try {if(await commitDraft())await invoke('new_workspace');}catch(e){error=String(e);render();}return;}if((event.metaKey||event.ctrlKey)&&event.key==='s'){event.preventDefault();await commitDraft();}});
document.addEventListener('keydown',async event=>{if(native&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='o'){event.preventDefault();if(await commitDraft())await showWorkspaces();}});
window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
function authSettings() {
  const disabled=!native||authBusy||chatgpt.pending;
  return `<div class="chatgpt-auth"><h4>ChatGPT</h4><p class="preferences-hint">${escape(t('authHint'))}</p>${chatgpt.accounts.map(account=>`<div class="chatgpt-account"><strong>${escape(account.email)}</strong><small>${escape(account.id)}</small><span>${escape(t(account.connected?'authConnected':'authDisconnected'))}${account.connected?` · ${escape(t(account.planEnabled?'authPlanEnabled':'authIdentityOnly'))}`:''}</span><button data-auth="${account.connected?'out':'in'}" data-account="${escape(account.id)}" ${disabled?'disabled':''}>${escape(t(account.connected?'authSignOut':'authReconnect'))}</button></div>`).join('')}<button class="chatgpt-continue" data-auth="in" ${disabled?'disabled':''}>Continue with ChatGPT</button>${chatgpt.pending?`<p role="status">${escape(t('authPending'))}</p><button data-auth="cancel" ${authBusy?'disabled':''}>${escape(t('cancel'))}</button>`:''}${chatgpt.error?`<p class="preferences-error" role="status">${escape(t(messages[language][chatgpt.error]?chatgpt.error:'auth_failed'))}</p>`:''}${!native?`<p>${escape(t('authNativeOnly'))}</p>`:''}<p class="preferences-hint">${escape(t('authWritingLater'))}</p></div>`;
}
function showPreferences() {
  preferencesOpen=true;
  let dialog=document.getElementById('preferences-dialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='preferences-dialog';dialog.className='preferences-dialog';document.getElementById('app').append(dialog);dialog.addEventListener('close',()=>{preferencesOpen=false;});}
  dialog.innerHTML=`<div class="preferences-header"><h2 id="preferences-heading">${escape(t('preferences'))}</h2><button data-pref-close aria-label="${escape(t('close'))}">×</button></div><div class="preferences-layout"><nav class="preferences-tabs" role="tablist" aria-label="${escape(t('preferences'))}">${['languageSettings','appearance','ai'].map(key=>`<button id="pref-tab-${key}" role="tab" aria-selected="${preferencesTab===key}" aria-controls="preferences-content" data-pref-tab="${key}">${escape(t(key))}</button>`).join('')}</nav><section id="preferences-content" role="tabpanel" aria-labelledby="pref-tab-${preferencesTab}"><h3>${escape(t(preferencesTab))}</h3>${preferencesTab==='languageSettings'?`<label class="preference-field">${escape(t('languageSettings'))}<select data-preference="language">${Object.entries(languages).map(([key,label])=>`<option value="${key}" ${language===key?'selected':''}>${label}</option>`).join('')}</select></label>`:preferencesTab==='appearance'?`<p class="preferences-hint">${escape(t('preferencesHint'))}</p><label class="preference-field">${escape(t('writingMode'))}<select data-preference="writingMode">${['horizontal','vertical'].map(key=>`<option value="${key}" ${preferences.writingMode===key?'selected':''}>${escape(t(key))}</option>`).join('')}</select></label><label class="preference-field">${escape(t('bodyFont'))}<select data-preference="bodyFont">${['serif','sans','mono'].map(key=>`<option value="${key}" ${preferences.bodyFont===key?'selected':''}>${escape(t(key))}</option>`).join('')}</select></label><label class="preference-check"><input type="checkbox" data-preference="actorBold" ${preferences.actorBold?'checked':''}>${escape(t('actorBold'))}</label>${[['bodySize',10,40,1,'px'],['lineHeight',1,3,0.1,'×'],['blockSize',12,48,1,'px'],['sequenceSize',12,48,1,'px'],['titleSize',12,48,1,'px']].map(([key,min,max,step,unit])=>`<label class="preference-field">${escape(t(key))}<span class="preference-number"><input type="number" required data-preference="${key}" value="${preferences[key]}" min="${min}" max="${max}" step="${step}"><span>${unit}</span></span></label>`).join('')}<button data-pref-reset>${escape(t('resetPreferences'))}</button>`:`${authSettings()}`}<p class="preferences-error" role="status">${preferencesError?escape(t('preferencesSaveError')):''}</p></section></div><footer class="preferences-footer"><button data-pref-close>${escape(t('close'))}</button></footer>`;
  dialog.setAttribute('aria-labelledby','preferences-heading');
  dialog.querySelector('.chatgpt-auth')?.insertAdjacentHTML('beforeend',chatgpt.accounts.filter(a=>a.connected&&!a.planEnabled).map(a=>`<button data-auth="plan" data-account="${escape(a.id)}" ${!native||authBusy||chatgpt.pending?'disabled':''}>${escape(t('aiEnablePlan'))} · ${escape(a.email)}</button>`).join(''));
  dialog.querySelectorAll('[data-pref-close]').forEach(button=>button.onclick=()=>dialog.close());
  dialog.querySelectorAll('[data-pref-tab]').forEach(button=>button.onclick=()=>{preferencesTab=button.dataset.prefTab;showPreferences();dialog.querySelector(`[data-pref-tab="${preferencesTab}"]`).focus();});
  dialog.querySelector('[data-pref-reset]')?.addEventListener('click',()=>savePreferences({...defaultPreferences,language,leftPanelOpen:preferences.leftPanelOpen,rightPanelOpen:preferences.rightPanelOpen}));
  dialog.querySelectorAll('input[type=number][data-preference]').forEach(input=>input.addEventListener('input',()=>{
    if(!input.checkValidity())return;
    pendingPreferences={...(pendingPreferences||preferences),[input.dataset.preference]:Number(input.value)};
    applyPreferences(pendingPreferences);
    clearTimeout(preferenceTimer);
    preferenceTimer=setTimeout(()=>{const value=pendingPreferences;pendingPreferences=null;savePreferences(value);},500);
  }));
  dialog.querySelectorAll('[data-preference]').forEach(input=>input.addEventListener('change',()=>{
    if(!input.checkValidity()){input.reportValidity();return;}
    const key=input.dataset.preference;
    clearTimeout(preferenceTimer);
    const value={...(pendingPreferences||preferences),[key]:input.type==='checkbox'?input.checked:input.type==='number'?Number(input.value):input.value};
    pendingPreferences=null;
    savePreferences(value);
  }));
  dialog.querySelectorAll('[data-auth]').forEach(button=>button.onclick=async()=>{
    if(authBusy)return;
    authBusy=true;
    dialog.querySelectorAll('[data-auth]').forEach(el=>el.disabled=true);
    try {
      const action=button.dataset.auth;
      await invoke(action==='cancel'?'chatgpt_cancel':action==='out'?'chatgpt_sign_out':'chatgpt_sign_in',action==='cancel'?{}:{accountId:button.dataset.account||null,enablePlan:action==='plan'});
      chatgpt=await invoke('chatgpt_status');
    }catch {chatgpt.error='auth_failed';}
    finally {authBusy=false;if(preferencesOpen&&preferencesTab==='ai')showPreferences();}
  });
  if(!dialog.open)dialog.showModal();
}
async function savePreferences(value) {
  if(preferencesSaving)return;
  preferencesSaving=true;preferencesError='';
  document.querySelectorAll('[data-preference],[data-pref-reset],#language,.panel-toggles button').forEach(input=>input.disabled=true);
  try {
    preferences=native?await invoke('set_preferences',{preferences:value}):value;
    if(!native)localStorage.setItem('story-preferences',JSON.stringify(preferences));
    language=preferences.language;localStorage.setItem('story-language',language);render();
  }catch(e){preferencesError=String(e);applyPreferences(preferences);if(preferencesOpen)showPreferences();else {error='preferencesSaveError';render();}}
  finally{preferencesSaving=false;document.querySelectorAll('[data-preference],[data-pref-reset],#language,.panel-toggles button').forEach(input=>input.disabled=false);}
}
async function start() {
  if(native) preferences=await invoke('get_preferences');
  else {try {preferences={...defaultPreferences,...JSON.parse(localStorage.getItem('story-preferences')||'{}')};}catch {} }
  preferences.rightPanelOpen=false;
  language=preferences.language;
  await loadPanelLayout();
  if(native)floating=(await invoke('floating_panels')).includes('editor');
  await installPerformanceQA({native,invoke});
  if(native)caretQA=await invoke('performance_qa_enabled');
  await refresh();
  if(native){
    await invoke('locale',{language});
    const currentWindow=window.__TAURI__.window.getCurrentWindow();
    await currentWindow.onCloseRequested(async event=>{
      if(busy || dirty()){event.preventDefault();if(await commitDraft())await currentWindow.close();}
    });
    const listen=window.__TAURI__.event.listen;
    chatgpt=await invoke('chatgpt_status');
    await listen('story://chatgpt',event=>{chatgpt=event.payload;if(preferencesOpen&&preferencesTab==='ai')showPreferences();});
    await listen('story://preferences',event=>{preferences=event.payload;language=preferences.language;render();});
    await listen('story://changed',async event=>{
      if(busy)return;
      if(localDirty()){if(event.payload.revision<=model?.revision)return;pendingRemote=event.payload;error='revision_conflict';render();return;}
      if(event.payload.revision<model?.revision)return;
      const delta=event.payload.paragraphDelta;
      let reused=false;
      if(delta&&delta.beforeRevision===model?.revision&&event.payload.revision===model.revision+1&&event.payload.selected===model.selected){
        const target=detail?.id===delta.scene?detail:groupDetails.find(scene=>scene.id===delta.scene);
        if(!target)reused=true;
        else {const canonical=applyRemoteParagraphs(target.properties.canonical,delta.paragraphs);if(canonical){target.properties={...target.properties,canonical};reused=true;}}
      }
      diskDirty=event.payload.saved===false;
      model=event.payload;if(!reused)await loadDetail(model.selected);status=model.saved===false?'unsaved':'saved';error=model.saved===false?'save_failed':'';if(embeddedGraph){for(const tools of dockedGraphTools)tools.refresh();}else render();
    });
    await listen('story://layout',event=>applyLayout(event.payload));
    await listen('story://panel',event=>{floating=event.payload;render();});
    await listen('story://history-command',async event=>{
      const input=document.activeElement;
      if(composing||busy)return;
      if(input?.matches('input,textarea,[contenteditable="true"]')&&!input.dataset.block){document.execCommand(event.payload);return;}
      await mutate({kind:event.payload});
    });
    await listen('story://save-error',()=>{status='unsaved';error='save_failed';render();});
  }
}
start().catch(e=>{document.getElementById('app').textContent=`${t('error')}: ${String(e)}`;});

function showSearch() {
  openSearch({t,escape,invoke,onHit:async(hit,revision)=>{
    try {
      if(!await commitDraft())return;tab='scenes';reading=false;await choose(hit.scene);
      if(model.revision!==revision)return;
      if(hit.paragraph){
        const peers=[...document.querySelectorAll('[data-paragraph]')].filter(block=>block.dataset.paragraph===hit.paragraph);
        const block=manuscriptViewport?.findParagraphFragment(hit.paragraph,hit.start,hit.scene)??peers.find(block=>hit.start>=Number(block.dataset.start)&&hit.start<Number(block.dataset.start)+Number(block.dataset.length))??peers.at(-1);
        if(block)mountManuscriptInput(document,hit.paragraph,Number(block.dataset.manuscriptBlock.split('-').at(-1)));
        else mountManuscriptInput(document,hit.paragraph);
        const input=[...document.querySelectorAll('textarea[data-block]')].find(input=>input.dataset.block===hit.paragraph&&hit.start>=Number(input.dataset.start)&&hit.start<=Number(input.dataset.start)+Number(input.dataset.length));
        if(input){const source=paragraphValue(input);const start=Number(input.dataset.start);input.focus();input.setSelectionRange(source.slice(start,hit.start).replace(/\r\n/g,'\n').length,source.slice(start,hit.end).replace(/\r\n/g,'\n').length);input.scrollIntoView({block:'nearest',inline:'nearest'});revealParagraphCaret(input,input.selectionStart);}
      }else{if(hit.field==='notes'){expandedNotes.add(hit.scene);render();}const input=hit.field==='title'?document.querySelector(`[data-outline-title="${hit.scene}"]`):document.querySelector(`[data-field="${hit.field}"]`);input?.focus();input?.setSelectionRange(hit.start,hit.end);}
    }catch(e){error=String(e);render();}
  }});
}
document.addEventListener('keydown',async event=>{if(native&&(event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='f'){event.preventDefault();if(!document.querySelector('dialog[open]')&&await commitDraft())showSearch();}});
