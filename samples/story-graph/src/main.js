import './style.css';
import { fragments, textDifference, characters } from './text-performance.js';
import { paragraphText, insertDialogue, updateParagraph, setDialogueWidth, paragraphById } from './dialogue.js';
import { messages, languages } from './locales.js';
import { canonicalText, routeNodes, relatedPeople, outlineNodes, outlineDrop, containedScenes } from './adapter.js';
import preview from './preview.json';
import { defaultPreferences, applyPreferences } from './preferences.js';
import { installAssistant } from './assistant.js';
import './ai-locales.js';
let preferences = {...defaultPreferences};
let chatgpt = {pending:false,accounts:[],error:null}, authBusy=false;
let preferenceTimer, pendingPreferences = null;
let preferencesTab = 'languageSettings', preferencesOpen = false, preferencesError = '', preferencesSaving = false;
const native = Boolean(window.__TAURI__);
const invoke = (command,args={}) => window.__TAURI__.core.invoke(command,args);
const openAssistant=installAssistant({invoke,native,t:key=>t(key),escape:value=>escape(value),getLanguage:()=>language,getScene:()=>detail?.type_id==='story.scene'?{id:detail.id,revision:model.revision}:null,refresh,commit:commitDraft,settings:()=>{preferencesTab='ai';showPreferences();}});
const floatingWindow = new URLSearchParams(location.search).get('panel') === 'editor';
let language = localStorage.getItem('story-language') || 'ja';
if (!messages[language]) language = 'ja';
let model = null, detail = null, tab = 'scenes', path = 'main', reading = false, floating = false;
let busy = false, draft = null, status = native ? 'saved' : '', error = '', backupPath = '';
let latestDetail=null, composing=false, bodyCaret=null, widthDrag=null;
let pendingRemote = null, autosaveTimer, draftVersion=0, commitInFlight=null;
let displayedWindowTitle = null;
const collapsedOutline = new Set();
const expandedNotes = new Set();
let draggingOutlineId=null;
let renderedDetailId;
const pendingParagraphs=new Map();
const inputValues=new WeakMap();
let wholeCanonicalDraft=false, manuscriptObserver=null;
let groupDetails=[], groupFocus=null;
const groupEdits=new Map();
const isContainer=()=>['story.block','story.sequence'].includes(detail?.type_id);
const writingScene=()=>detail?.type_id==='story.scene'?detail:groupDetails.find(scene=>scene.id===groupFocus);
const inputScene=input=>input?.closest('[data-scene]')?.dataset.scene;
const t = key => messages[language][key] || messages[language].error;
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${{leftPanel:'M3 4h18v16H3z M9 4v16',rightPanel:'M3 4h18v16H3z M15 4v16',block:'M3 6h7l2 3h9v12H3z M3 6V3h7l2 3',sequence:'M3 6h7l2 3h9v12H3z M3 6V3h7l2 3 M7 14h10 M7 17h10',scene:'M6 3h12v18H6z M9 8h6 M9 12h6',graph:'M5 6h4v4H5z M15 14h4v4h-4z M9 8h6v8 M5 17h4v4H5z M9 19h6',undo:'M9 5 4 10l5 5 M4 10h9a6 6 0 0 1 6 6',redo:'m15 5 5 5-5 5 M20 10h-9a6 6 0 0 0-6 6',add:'M12 5v14 M5 12h14',float:'M14 3h7v7 M21 3l-9 9 M10 3H3v18h18v-7',book:'M12 5v16 M12 5C8 2 3 3 3 3v16s5-1 9 2c4-3 9-2 9-2V3s-5-1-9 2',person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M4 21v-2a8 8 0 0 1 16 0v2',backup:'M12 3v12 m-4-4 4 4 4-4 M4 16v5h16v-5',trash:'M3 6h18 M9 6V3h6v3 M6 6l1 15h10l1-15 M10 10v7 M14 10v7'}[name] || ''}"/></svg>`;
function button(action,label,ico,disabled=false,kind='') { return `<button class="${kind}" data-action="${action}" ${disabled?'disabled':''}>${ico?icon(ico):''}<span>${escape(t(label))}</span></button>`; }
function menu(label,items) {return `<details class="app-menu"><summary>${escape(t(label))}</summary><div class="menu-popup">${items.join('')}</div></details>`;}
function closeMenus() { document.querySelectorAll('.app-menu[open]').forEach(menu=>menu.open=false); }
function field(key,label,value,multiline=false) { return `<label class="field">${escape(t(label))}${multiline?`<textarea data-field="${key}" rows="${key==='text'?16:5}" ${native?'':'readonly'}>${escape(value)}</textarea>`:`<input data-field="${key}" value="${escape(value)}" maxlength="200" ${native?'':'readonly'}>`}</label>`; }
function draftBase(key) { return key==='canonical'?detail.properties.canonical:key==='projectTitle' ? model.projectTitle??'' : key==='text'?canonicalText(detail.properties.canonical):(detail?.properties[key]??''); }
function primaryDirty() { return draft && Object.entries(draft).some(([key,value])=>value!==draftBase(key)); }
function dirty() { return primaryDirty() || groupEdits.size>0; }
async function loadDetail(id) {
  detail = id ? (native ? await invoke('selected',{id}) : preview.details[id]) : null;
  draft=null;pendingParagraphs.clear();wholeCanonicalDraft=false;groupEdits.clear();
  groupDetails=isContainer()?await Promise.all(containedScenes(model.nodes,id).map(node=>native?invoke('selected',{id:node.id}):preview.details[node.id])):[];
  if(!groupDetails.some(scene=>scene.id===groupFocus))groupFocus=groupDetails[0]?.id??null;
}
async function refresh() { model = native ? await invoke('workspace') : preview; await loadDetail(model.selected); pendingRemote=null; render(); }
function render() {
  closeOutlineMenu();manuscriptObserver?.disconnect();manuscriptObserver=null;
  const reopenPreferences = preferencesOpen;
  applyPreferences(preferences);
  const preserveScroll=renderedDetailId===detail?.id;
  const editorScroll=preserveScroll?document.querySelector('.editor-content')?.scrollTop||0:0;
  const groupScroll=preserveScroll?document.querySelector('.group-manuscript')?.scrollLeft||0:0;
  const listScroll=document.querySelector('.node-list')?.scrollTop||0;
  renderedDetailId=detail?.id;
  const active=document.activeElement;
  const cursor=active?.dataset?.block ? {scene:inputScene(active),block:active.dataset.block,fragment:active.dataset.fragment,start:active.selectionStart,end:active.selectionEnd} : active?.dataset?.field ? {key:active.dataset.field,start:active.selectionStart,end:active.selectionEnd} : null;
  document.documentElement.lang = language;
  const projectTitle=model?.projectTitle?.trim()||t(model?.untitled?'untitledProject':'project');
  const windowTitle = `${projectTitle} · KOMYAKU Story Graph${floatingWindow ? ` · ${t('editor')}` : ''}`;
  document.title = windowTitle;
  if (native && displayedWindowTitle !== windowTitle) {
    displayedWindowTitle = windowTitle;
    window.__TAURI__.window.getCurrentWindow().setTitle(windowTitle).catch(() => { displayedWindowTitle = null; });
  }
  const selected = detail?.id;
  const scenes = routeNodes(model?.nodes||[],path);
  const people = (model?.nodes||[]).filter(n=>n.type==='story.character');
  const relations = (model?.nodes||[]).filter(n=>n.type==='story.relationship');
  const list = tab==='scenes'?outlineNodes(model?.nodes||[],path,collapsedOutline):tab==='characters'?people:relations;
  const props = detail?.properties || {};
  const values = {...props,...draft};
  const shell = document.getElementById('app');
  const leftOpen=preferences.leftPanelOpen, rightOpen=preferences.rightPanelOpen;
  shell.innerHTML = `<div class="shell ${floatingWindow?'detached':''} ${!leftOpen?'left-panel-closed':''} ${!rightOpen?'right-panel-closed':''} ${!leftOpen&&!rightOpen?'focus-writing':''} ${native&&navigator.platform.includes('Mac')?'mac-native':''}">
    ${!floatingWindow?`<header class="window-titlebar" data-tauri-drag-region><span class="window-title" data-tauri-drag-region>${escape(projectTitle)}</span><div class="panel-toggles"><button data-action="toggleLeftPanel" title="${escape(t(leftOpen?'hideLeftPanel':'showLeftPanel'))}" aria-label="${escape(t(leftOpen?'hideLeftPanel':'showLeftPanel'))}" aria-pressed="${leftOpen}" aria-controls="left-icon-menu story-navigator">${icon('leftPanel')}</button><button data-action="toggleRightPanel" title="${escape(t(rightOpen?'hideRightPanel':'showRightPanel'))}" aria-label="${escape(t(rightOpen?'hideRightPanel':'showRightPanel'))}" aria-pressed="${rightOpen}" aria-controls="story-relations">${icon('rightPanel')}</button></div></header>`:''}
    <nav class="menubar" aria-label="${escape(t('appMenu'))}">
      <details class="app-menu logo-menu"><summary class="menu-logo" aria-label="KOMYAKU Story Graph">${icon('graph')}</summary><div class="menu-popup">${button('preferences','preferences',null)}</div></details>
      ${menu('file',[button('newWorkspace','newWorkspace',null,!native||busy),button('save','save',null,!native||busy),button('backup','backup',null,!native||busy)])}
      ${menu('edit',[button('undo','undo','undo',!native||busy),button('redo','redo','redo',!native||busy),button('remove','remove',null,!native||busy||!detail)])}
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
      </nav>
    <main>
      <nav class="navigator" id="story-navigator" aria-label="${escape(t('view'))}"><div class="navtabs">${['scenes','characters','relationships'].map(key=>`<button data-tab="${key}" aria-pressed="${tab===key}">${escape(t(key))}</button>`).join('')}</div>
      ${tab==='scenes'?`<label class="route-label">${escape(t('route'))}<select id="path">${['main','alternative'].map(key=>`<option value="${key}" ${path===key?'selected':''}>${escape(t(key))}</option>`).join('')}</select></label>`:`<h2>${escape(t('people'))}</h2>`}
      <div class="node-list" ${tab==='scenes'?'role="tree"':''}>${tab==='scenes'?`<label class="project-title-field"><span>${escape(t('workTitle'))}</span><input data-field="projectTitle" aria-label="${escape(t('workTitle'))}" value="${escape(draft?.projectTitle??model.projectTitle??'')}" placeholder="${escape(projectTitle)}" maxlength="200" ${native?'':'readonly'}></label>`:''}${list.map((node,i)=>`<div class="outline-row" ${tab==='scenes'?`role="treeitem" aria-level="${(node.depth||0)+1}" ${node.container?`aria-expanded="${!collapsedOutline.has(node.id)}"`:''}`:''}>${node.container?`<button class="outline-toggle" data-collapse="${node.id}" aria-label="${escape(t(collapsedOutline.has(node.id)?'expand':'collapse'))}" aria-expanded="${!collapsedOutline.has(node.id)}">${collapsedOutline.has(node.id)?'▸':'▾'}</button>`:''}<button class="node-row ${node.id===selected?'active':''}" data-select="${node.id}" ${tab==='scenes'&&native?'draggable="true"':''} ${busy?'disabled':''}><span class="ordinal">${tab==='scenes'?icon(node.type==='story.block'?'block':node.type==='story.sequence'?'sequence':'scene'):icon('person')}</span><span><strong>${escape(node.title)}</strong><small>${escape(tab==='scenes'?t(node.type==='story.block'?'block':node.type==='story.sequence'?'sequence':node.path==='both'?'scene':node.path):tab==='characters'?t('role'):t(node.kind))}</small></span></button></div>`).join('')||`<p class="empty">${escape(t(tab==='scenes'?'noScenes':'noRelations'))}</p>`}</div>
      <div class="navbottom">${tab==='scenes'?`<div class="structure-actions">${[['newBlock','block'],['newSequence','sequence'],['newScene','scene']].map(([action,ico])=>`<button data-action="${action}" title="${escape(t(action))}" aria-label="${escape(t(action))}" ${!native||busy||(action==='newSequence'&&!model.nodes.some(n=>n.type==='story.block'))||(action==='newScene'&&!model.nodes.some(n=>n.type==='story.sequence'))?'disabled':''}>${icon(ico)}</button>`).join('')}</div>`:button(tab==='characters'?'newCharacter':'newRelation',tab==='characters'?'newCharacter':'createRelation','add',!native||busy||(tab==='relationships'&&people.length<2),'primary')}</div></nav>
      <section class="writing"><div class="editor-toolbar"><div class="viewtabs"><button data-action="write" aria-pressed="${!reading}">${escape(t('editor'))}</button><button data-action="read" aria-pressed="${reading}">${escape(t('reading'))}</button></div><div class="editor-actions"><select data-writing-mode aria-label="${escape(t('writingMode'))}">${['horizontal','vertical'].map(key=>`<option value="${key}" ${preferences.writingMode===key?'selected':''}>${escape(t(key))}</option>`).join('')}</select>${button('dialogue','dialogue',null,!native||busy||reading||!writingScene()||(floating&&!floatingWindow))}${button(floatingWindow?'dock':'float',floatingWindow?'dock':'float','float',!native||busy)}</div></div>
      <div class="editor-content ${reading?'reading-content ':''}${!reading&&isContainer()&&(!floating||floatingWindow)?'group-writing ':''}${!reading&&detail?.type_id==='story.scene'&&(!floating||floatingWindow)?'scene-writing':''}">${reading?`<div class="reading-viewport"><article class="reading" id="reading"><h2>${escape(t(path))}</h2></article></div>`:floating&&!floatingWindow?`<div class="empty floating-message">${icon('float')}<p>${escape(t('floating'))}</p>${button('dock','dock',null,!native)}</div>`:detail?`
      ${isContainer()?'':detail.type_id==='story.scene'?sceneBreadcrumb(values):`<div class="selection-label">${escape(t(detail.type_id==='story.character'?'characters':'relationships'))}</div>${field('title',detail.type_id==='story.character'?'name':'title',values.title)}`}
      ${isContainer()?groupBody():detail.type_id==='story.scene'?sceneBody(values.canonical??props.canonical):detail.type_id==='story.character'?field('role','role',values.role,true):`<div class="relation-inspector">${relatedPeople(model,detail).map(n=>`<span>${escape(n?.title||'—')}</span>`).join(`<span class="connection">${props.mutual?'↔':'→'}</span>`)}<label class="field">${escape(t('kind'))}<select data-field="kind" ${native?'':'disabled'}>${['family','friend','rival','trust','love'].map(k=>`<option value="${k}" ${values.kind===k?'selected':''}>${escape(t(k))}</option>`).join('')}</select></label><label class="check"><input data-field="mutual" type="checkbox" ${values.mutual?'checked':''} ${native?'':'disabled'}>${escape(t('mutual'))}</label></div>`}
      ${['story.block','story.sequence'].includes(detail.type_id)?'':detail.type_id==='story.scene'?`<details class="scene-notes" data-notes-id="${detail.id}" ${expandedNotes.has(detail.id)?'open':''}><summary>${escape(t('notes'))}</summary><textarea data-field="notes" aria-label="${escape(t('notes'))}" rows="4" ${native?'':'readonly'}>${escape(values.notes)}</textarea></details>`:field('notes','notes',values.notes,true)}${detail.type_id==='story.scene'||isContainer()?'':`<div class="editor-footer">${button('remove','remove','trash',!native||busy,'danger')}</div>`}`:`<p class="empty">${escape(t('select'))}</p>`}</div>
      <footer class="native-hint">${icon('graph')}<span>${escape(t('native'))}</span></footer></section>
      <aside class="relations" id="story-relations"><h2>${escape(t('relationships'))}</h2><p>${escape(t('relationDescription'))}</p>${relations.map(node=>{const [a,b]=relatedPeople(model,node);return `<button class="relation-row ${node.id===selected?'active':''}" data-select="${node.id}"><span class="relation-names">${escape(a?.title||'—')} <span>${node.mutual?'↔':'→'}</span> ${escape(b?.title||'—')}</span><strong>${escape(node.title)}</strong><small>${escape(t(node.kind))}</small></button>`;}).join('')}${button('newRelation','createRelation','add',!native||busy||people.length<2)}</aside>
    </main></div><footer class="notice" role="status">${error?`<span class="error">${escape(t(error))}</span>${button('refresh','refresh',null,busy)}`:`<span>${status?escape(t(status)):''}</span>`}${backupPath?`<span class="backup-path" title="${escape(backupPath)}">${escape(t('savedCopy'))}: ${escape(backupPath)}</span>`:''}<span class="status-selection">${escape(detail?.properties.title||'')}</span></footer><dialog id="create-dialog"></dialog>
  </div>`;
  shell.querySelector('.editor-content').scrollTop=editorScroll;
  shell.querySelector('.node-list').scrollTop=listScroll;
  if(cursor) {
    const scope=cursor.scene?shell.querySelector(`[data-scene="${cursor.scene}"]`):shell;
    const input=scope?.querySelector(cursor.block?`[data-block="${cursor.block}"][data-fragment="${cursor.fragment??0}"]`:`[data-field="${cursor.key}"]`);
    if(input){input.focus({preventScroll:true});if(typeof cursor.start==='number' && input.setSelectionRange)input.setSelectionRange(cursor.start,cursor.end);}
  }
  shell.querySelector('.editor-actions').insertAdjacentHTML('afterbegin',button('writingAssist','writingAssist',null,!native||busy||reading||detail?.type_id!=='story.scene'||(floating&&!floatingWindow)));
  resizeManuscript();
  const groupViewport=shell.querySelector('.group-manuscript');if(groupViewport)groupViewport.scrollLeft=groupScroll;
  if(reading) renderReading();
  if(reopenPreferences) showPreferences();
}
async function renderReading() {
  try {
    const blocks = native ? await invoke('reading',{path}) : routeNodes(preview.nodes,path).map(n=>[n.id,n.title,canonicalText(preview.details[n.id].properties.canonical)]);
    const target=document.getElementById('reading');
    const documents=await Promise.all(blocks.map(async ([id])=>native?(await invoke('selected',{id})).properties.canonical:preview.details[id].properties.canonical));
    if(target) target.innerHTML=`<h2>${escape(t(path))}</h2>${blocks.map(([,title],index)=>`<section><h3>${escape(title)}</h3>${documents[index].content.map(node=>node.type==='paragraph'?`<p>${escape(paragraphText(node))}</p>`:`<table class="dialogue-sheet reading-dialogue" data-width="${node.extensions?.['komyaku.dialogue']?.actorWidth??''}"><tbody><tr>${node.content[0].content.map(cell=>`<td>${escape(paragraphText(cell.content[0]))}</td>`).join('')}</tr></tbody></table>`).join('')}</section>`).join('')||`<p>${escape(t('emptyReading'))}</p>`}`;
    resizeDialogueColumns();
  } catch(e) { const target=document.getElementById('reading');if(target)target.innerHTML=`<p class="error">${escape(t(String(e)))}</p>`; }
}
async function commitDraft() {
  if(commitInFlight){await commitInFlight;if(error)return false;return commitDraft();}
  commitInFlight=(async()=>await saveDraft()&&await saveGroupDrafts())();
  try{return await commitInFlight;}finally{commitInFlight=null;}
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
function groupEdit(id) {
  if(!groupEdits.has(id))groupEdits.set(id,{canonical:groupDetails.find(scene=>scene.id===id).properties.canonical,changes:new Map(),whole:false,version:0});
  return groupEdits.get(id);
}
function groupBody() {
  let previous=null;
  return `<div class="group-manuscript"><header class="group-title"><span>${escape(t(detail.type_id==='story.block'?'block':'sequence'))}</span><textarea data-field="title" aria-label="${escape(t('heading'))}" maxlength="200" rows="1" ${native?'':'readonly'}>${escape(draft?.title??detail.properties.title)}</textarea></header>${groupDetails.map(scene=>{
    const sequence=model.nodes.find(node=>node.id===scene.properties.parent);
    const heading=sequence?.id!==previous&&detail.type_id==='story.block'?`<h2 class="group-sequence-heading">${escape(sequence?.title||'')}</h2>`:'';
    previous=sequence?.id;
    return `${heading}<section class="group-scene" data-scene="${scene.id}"><h3 class="group-scene-title">${escape(scene.properties.title)}</h3>${sceneBody(groupEdits.get(scene.id)?.canonical??scene.properties.canonical)}</section>`;
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
async function choose(id) {
  if(!await commitDraft()) return;
  if(native) model=await invoke('choose',{id});else model={...model,selected:id};
  await loadDetail(id);render();
}
function sceneBody(doc) {
  const editable=native?'':'readonly';
  const input=(node,label,actor=false,part={start:0,text:paragraphText(node)},index=0)=>`<textarea class="${actor?'dialogue-actor':'manuscript-text'}" data-block="${node.id}" data-start="${part.start}" data-fragment="${index}" aria-label="${escape(t(label))}" placeholder="${label==='body'?'':escape(t(label))}" rows="1" ${editable}>${escape(part.text)}</textarea>`;
  const blocks=doc.content.flatMap(node=>{
    if(node.type==='paragraph')return fragments(paragraphText(node)).map((part,index)=>`<div class="manuscript-block" data-manuscript-block="${node.id}-${index}">${input(node,'body',false,part,index)}</div>`);
    return [`<div class="manuscript-block" data-manuscript-block="${node.id}"><table class="dialogue-sheet" data-sheet="${node.id}" data-width="${node.extensions?.['komyaku.dialogue']?.actorWidth??''}" aria-label="${escape(t('dialogue'))}"><tbody><tr><td>${input(node.content[0].content[0].content[0],'actorName',true)}${native?`<span class="dialogue-divider" data-divider="${node.id}" role="separator" aria-orientation="vertical" aria-label="${escape(t('resizeActor'))}" tabindex="0"></span>`:''}</td><td>${input(node.content[0].content[1].content[0],'dialogueText')}</td></tr></tbody></table></div>`];
  });
  return `<div class="manuscript"><div class="manuscript-pages">${blocks.join('')}</div></div>`;
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
function resizeManuscript(scope=null) {
  if(!scope) {
    const blocks=[...document.querySelectorAll('.manuscript-block')];
    if(blocks.length>80) {
      if(!manuscriptObserver)observeManuscript();
      blocks.filter(block=>block.classList.contains('block-visible')||block.contains(document.activeElement)).forEach(block=>resizeManuscript(block));
      return;
    }
    scope=document;
  }
  resizeDialogueColumns(scope);
  (scope.matches?.('[data-block]')?[scope]:scope.querySelectorAll('[data-block]')).forEach(input=>{
    const wrapper=input.closest('.manuscript-block');
    const stretch=wrapper?.parentElement.classList.contains('manuscript-pages')&&wrapper===wrapper.parentElement.lastElementChild&&input.parentElement===wrapper;
    if(preferences.writingMode==='vertical'){input.style.flex='none';input.style.minHeight='0px';input.style.height='100%';input.style.minWidth='0px';const capacity=Math.max(1,Math.floor(input.clientHeight/preferences.bodySize));const columns=(input.value||input.placeholder||' ').split('\n').reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].length/capacity)),0);input.style.width=`${columns*preferences.bodySize*preferences.lineHeight}px`;input.style.width=`${Math.max(input.scrollWidth,columns*preferences.bodySize*preferences.lineHeight)}px`;if(wrapper)wrapper.style.width=`${Math.max(...[...wrapper.querySelectorAll('textarea')].map(item=>parseFloat(item.style.width)||preferences.bodySize*preferences.lineHeight))}px`;const actor=wrapper?.querySelector('.dialogue-actor');if(actor)wrapper.querySelectorAll('.dialogue-sheet td').forEach(cell=>cell.style.setProperty('width',wrapper.style.width,'important'));return;}
    if(wrapper){wrapper.style.width='';wrapper.querySelectorAll('.dialogue-sheet td').forEach(cell=>cell.style.removeProperty('width'));}input.style.width='';input.style.minWidth='';
    input.style.flex='none';input.style.minHeight='0px';input.style.height='0px';
    const height=input.scrollHeight;
    input.style.height=stretch?'auto':`${height}px`;input.style.minHeight=stretch?`${height}px`:'';input.style.flex='';
  });
}
function observeManuscript() {
  manuscriptObserver?.disconnect();
  const root=document.querySelector(isContainer()?'.group-manuscript':preferences.writingMode==='vertical'?'.manuscript-pages':'.editor-content');
  manuscriptObserver=new IntersectionObserver(entries=>{
    for(const entry of entries){entry.target.classList.toggle('block-visible',entry.isIntersecting);if(entry.isIntersecting)resizeManuscript(entry.target);}
  },{root,rootMargin:'800px'});
  for(const block of document.querySelectorAll('.manuscript-block'))manuscriptObserver.observe(block);
}
function sceneBreadcrumb(values) {
  const sequence=model.nodes.find(node=>node.id===values.parent);
  const block=model.nodes.find(node=>node.id===sequence?.parent);
  const ancestors=[block,sequence].filter(Boolean);
  return `<nav class="scene-breadcrumb" aria-label="${escape(t('outline'))}">${ancestors.map(node=>`<span class="breadcrumb-parent" title="${escape(node.title)}">${escape(node.title)}</span><span class="breadcrumb-separator" aria-hidden="true">›</span>`).join('')}<input class="breadcrumb-title" data-field="title" aria-label="${escape(t('title'))}" aria-current="page" value="${escape(values.title)}" maxlength="200" ${native?'':'readonly'}></nav>`;
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
  widthDrag={id:handle.dataset.divider,table,handle,pointer:event.pointerId};handle.setPointerCapture(event.pointerId);
});
document.addEventListener('pointermove',event=>{
  if(!widthDrag||event.pointerId!==widthDrag.pointer)return;
  const bounds=widthDrag.table.getBoundingClientRect(),width=Math.max(16,Math.min(preferences.writingMode==='vertical'?event.clientY-bounds.top:event.clientX-bounds.left,(preferences.writingMode==='vertical'?bounds.height:bounds.width)-32,4096));
  widthDrag.table.dataset.width=String(width);widthDrag.table.style.setProperty('--actor-width',`${width}px`);
  resizeManuscript(widthDrag.table);
});
async function finishWidthDrag(event) {
  if(!widthDrag||event.pointerId!==widthDrag.pointer)return;
  const drag=widthDrag;widthDrag=null;
  if(event.type==='pointercancel'){resizeManuscript();render();return;}
  storeSheetWidth(drag.id,Number(drag.table.dataset.width)||drag.table.rows[0].cells[0].getBoundingClientRect().width,inputScene(drag.handle));
  await commitDraft();document.querySelector(`[data-divider="${drag.id}"]`)?.focus({preventScroll:true});
}
document.addEventListener('pointerup',finishWidthDrag);document.addEventListener('pointercancel',finishWidthDrag);
document.addEventListener('keydown',async event=>{
  const handle=event.target.closest('[data-divider]');if(!handle||!(preferences.writingMode==='vertical'?['ArrowUp','ArrowDown']:['ArrowLeft','ArrowRight']).includes(event.key))return;
  event.preventDefault();const table=handle.closest('.dialogue-sheet');
  const width=Math.max(16,Math.min((preferences.writingMode==='vertical'?table.rows[0].cells[0].getBoundingClientRect().height:table.rows[0].cells[0].getBoundingClientRect().width)+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1)*(event.shiftKey?10:2),(preferences.writingMode==='vertical'?table.clientHeight:table.clientWidth)-32,4096));
  storeSheetWidth(handle.dataset.divider,width,inputScene(handle));await commitDraft();document.querySelector(`[data-divider="${handle.dataset.divider}"]`)?.focus({preventScroll:true});
});
document.addEventListener('dblclick',async event=>{
  const handle=event.target.closest('[data-divider]');if(!handle)return;
  storeSheetWidth(handle.dataset.divider,null,inputScene(handle));await commitDraft();
});
window.addEventListener('resize',()=>resizeManuscript());
document.addEventListener('wheel',event=>{const group=event.target.closest('.group-manuscript');const pages=group??event.target.closest('.manuscript-pages,.reading-viewport');if((!group&&preferences.writingMode!=='vertical')||!pages||pages.scrollWidth<=pages.clientWidth||event.ctrlKey||Math.abs(event.deltaX)>Math.abs(event.deltaY))return;if(group&&preferences.writingMode!=='vertical'&&event.target.closest('.group-scene'))return;event.preventDefault();pages.scrollLeft+=preferences.writingMode==='vertical'?-event.deltaY:event.deltaY;},{passive:false});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.scene-notes')){const id=event.target.dataset.notesId;event.target.open?expandedNotes.add(id):expandedNotes.delete(id);}},true);
document.addEventListener('input',event=>{
  if(event.target.dataset.block) {
    const input=event.target,id=input.dataset.block,start=Number(input.dataset.start||0),before=inputValues.get(input)??input.defaultValue;
    const change=textDifference(before,input.value,start);inputValues.set(input,input.value);
    if(change.start===change.end&&!change.text)return;
    const scene=inputScene(input);
    if(scene){
      const edit=groupEdit(scene),old=paragraphText(paragraphById(edit.canonical,id));
      edit.canonical=updateParagraph(edit.canonical,id,old.slice(0,change.start)+change.text+old.slice(change.end),characters(change.text)-characters(change.removed));
      edit.changes.set(id,[...(edit.changes.get(id)||[]),{start:change.start,end:change.end,text:change.text}]);edit.version++;
      const delta=input.value.length-before.length;
      for(const next of input.closest('[data-scene]').querySelectorAll(`[data-block="${id}"]`))if(next!==input&&Number(next.dataset.start)>start)next.dataset.start=String(Number(next.dataset.start)+delta);
      status='unsaved';clearTimeout(autosaveTimer);if(!composing)autosaveTimer=setTimeout(()=>commitDraft(),900);
      resizeManuscript(input.closest('.manuscript-block'));updateEmptyColumnCaret();
      return;
    }
    draft??={};const current=draft.canonical??detail.properties.canonical,old=paragraphText(paragraphById(current,id));
    draft.canonical=updateParagraph(current,id,old.slice(0,change.start)+change.text+old.slice(change.end),characters(change.text)-characters(change.removed));
    pendingParagraphs.set(id,[...(pendingParagraphs.get(id)||[]),{start:change.start,end:change.end,text:change.text}]);
    const delta=input.value.length-before.length;
    for(const next of document.querySelectorAll(`[data-block="${id}"]`))if(next!==input&&Number(next.dataset.start)>start)next.dataset.start=String(Number(next.dataset.start)+delta);
    draftVersion++;status='unsaved';clearTimeout(autosaveTimer);if(!composing)autosaveTimer=setTimeout(()=>commitDraft(),900);resizeManuscript(event.target.closest('.manuscript-block'));updateEmptyColumnCaret();return;
  }
  const key=event.target.dataset.field;if(!key||(!detail&&key!=='projectTitle'))return;
  draft??={};draft[key]=event.target.type==='checkbox'?event.target.checked:event.target.value;draftVersion++;status='unsaved';clearTimeout(autosaveTimer);if(!composing)autosaveTimer=setTimeout(()=>commitDraft(),900);
  const notice=document.querySelector('.notice span');if(notice)notice.textContent=t('unsaved');
});
document.addEventListener('compositionstart',()=>{composing=true;updateEmptyColumnCaret();clearTimeout(autosaveTimer);});
document.addEventListener('compositionend',event=>{composing=false;updateEmptyColumnCaret();clearTimeout(autosaveTimer);autosaveTimer=setTimeout(()=>commitDraft(),900);});
document.addEventListener('focusin',event=>{const scene=inputScene(event.target);if(scene)groupFocus=scene;});
document.addEventListener('focusout',event=>{if(event.target.dataset.block){bodyCaret={scene:inputScene(event.target)??detail.id,id:event.target.dataset.block,start:Number(event.target.dataset.start||0)+event.target.selectionStart,end:Number(event.target.dataset.start||0)+event.target.selectionEnd};if(!busy&&!composing&&!widthDrag)commitDraft();}if(event.target.dataset.field&&!busy&&!composing)commitDraft();});
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
  if(event.target.closest('#preferences-dialog,.assistant-dialog,.rename-dialog'))return;
  const element=event.target.closest('button');if(!element||element.disabled)return;
  try {
    if(element.dataset.collapse){if(!await commitDraft())return;const id=element.dataset.collapse;collapsedOutline.has(id)?collapsedOutline.delete(id):collapsedOutline.add(id);render();return;}
    if(element.dataset.select){await choose(element.dataset.select);return;}
    if(element.dataset.tab){if(!await commitDraft())return;tab=element.dataset.tab;reading=false;render();return;}
    const action=element.dataset.action;closeMenus();
    if(action==='toggleLeftPanel'||action==='toggleRightPanel'){const key=action==='toggleLeftPanel'?'leftPanelOpen':'rightPanelOpen';await savePreferences({...preferences,[key]:!preferences[key]});return;}
    if(action==='newWorkspace'){if(await commitDraft())await invoke('new_workspace');return;}
    if(action==='preferences'){showPreferences();return;}
    if(action==='writingAssist'){if(await commitDraft())await openAssistant();return;}
    if(action==='dialogue') {
      if(!await commitDraft())return;
      const scene=writingScene();if(!scene)return;
      const added=insertDialogue(scene.properties.canonical,bodyCaret?.scene===scene.id?bodyCaret:null);
      if(isContainer()){const edit=groupEdit(scene.id);edit.whole=true;edit.canonical=added.document;edit.version++;}
      else {wholeCanonicalDraft=true;draft={canonical:added.document};draftVersion++;}
      await commitDraft();
      const scope=isContainer()?document.querySelector(`[data-scene="${scene.id}"]`):document;
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
    if(action==='graph')await invoke('canvas');
    if(action==='backup'){backupPath=await invoke('backup');status='backupReady';render();}
    if(action==='float'||action==='dock')await invoke('panel',{floating:action==='float'});
    if(action==='read'||action==='write'){reading=action==='read';render();}
  }catch(e){error=String(e);render();}
});
document.addEventListener('click',event=>{if(!event.target.closest('.app-menu'))closeMenus();});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.app-menu')&&event.target.open)document.querySelectorAll('.app-menu[open]').forEach(menu=>{if(menu!==event.target)menu.open=false;});},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeMenus();if(event.key==='ArrowDown'&&event.target.matches('.app-menu>summary')){event.preventDefault();event.target.parentElement.open=true;event.target.parentElement.querySelector('button:not(:disabled)')?.focus();}});
document.addEventListener('keydown',async event=>{if(native&&(event.metaKey||event.ctrlKey)&&event.key==='n'){event.preventDefault();try {if(await commitDraft())await invoke('new_workspace');}catch(e){error=String(e);render();}return;}if((event.metaKey||event.ctrlKey)&&event.key==='s'){event.preventDefault();await commitDraft();}});
window.addEventListener('beforeunload',event=>{if(dirty()){event.preventDefault();event.returnValue='';}});
function authSettings() {
  const disabled=!native||authBusy||chatgpt.pending;
  return `<div class="chatgpt-auth"><h4>ChatGPT</h4><p class="preferences-hint">${escape(t('authHint'))}</p>${chatgpt.accounts.map(account=>`<div class="chatgpt-account"><strong>${escape(account.email)}</strong><small>${escape(account.id)}</small><span>${escape(t(account.connected?'authConnected':'authDisconnected'))}${account.connected?` · ${escape(t(account.planEnabled?'authPlanEnabled':'authIdentityOnly'))}`:''}</span><button data-auth="${account.connected?'out':'in'}" data-account="${escape(account.id)}" ${disabled?'disabled':''}>${escape(t(account.connected?'authSignOut':'authReconnect'))}</button></div>`).join('')}<button class="chatgpt-continue" data-auth="in" ${disabled?'disabled':''}>Continue with ChatGPT</button>${chatgpt.pending?`<p role="status">${escape(t('authPending'))}</p><button data-auth="cancel" ${authBusy?'disabled':''}>${escape(t('cancel'))}</button>`:''}${chatgpt.error?`<p class="preferences-error" role="status">${escape(t(messages[language][chatgpt.error]?chatgpt.error:'auth_failed'))}</p>`:''}${!native?`<p>${escape(t('authNativeOnly'))}</p>`:''}<p class="preferences-hint">${escape(t('authWritingLater'))}</p></div>`;
}
function showPreferences() {
  preferencesOpen=true;
  let dialog=document.getElementById('preferences-dialog');
  if(!dialog){dialog=document.createElement('dialog');dialog.id='preferences-dialog';dialog.className='preferences-dialog';document.getElementById('app').append(dialog);dialog.addEventListener('close',()=>{preferencesOpen=false;});}
  dialog.innerHTML=`<div class="preferences-header"><h2 id="preferences-heading">${escape(t('preferences'))}</h2><button data-pref-close aria-label="${escape(t('close'))}">×</button></div><div class="preferences-layout"><nav class="preferences-tabs" role="tablist" aria-label="${escape(t('preferences'))}">${['languageSettings','appearance','ai'].map(key=>`<button id="pref-tab-${key}" role="tab" aria-selected="${preferencesTab===key}" aria-controls="preferences-content" data-pref-tab="${key}">${escape(t(key))}</button>`).join('')}</nav><section id="preferences-content" role="tabpanel" aria-labelledby="pref-tab-${preferencesTab}"><h3>${escape(t(preferencesTab))}</h3>${preferencesTab==='languageSettings'?`<label class="preference-field">${escape(t('languageSettings'))}<select data-preference="language">${Object.entries(languages).map(([key,label])=>`<option value="${key}" ${language===key?'selected':''}>${label}</option>`).join('')}</select></label>`:preferencesTab==='appearance'?`<p class="preferences-hint">${escape(t('preferencesHint'))}</p><label class="preference-field">${escape(t('writingMode'))}<select data-preference="writingMode">${['horizontal','vertical'].map(key=>`<option value="${key}" ${preferences.writingMode===key?'selected':''}>${escape(t(key))}</option>`).join('')}</select></label><label class="preference-field">${escape(t('bodyFont'))}<select data-preference="bodyFont">${['serif','sans','mono'].map(key=>`<option value="${key}" ${preferences.bodyFont===key?'selected':''}>${escape(t(key))}</option>`).join('')}</select></label><label class="preference-check"><input type="checkbox" data-preference="actorBold" ${preferences.actorBold?'checked':''}>${escape(t('actorBold'))}</label>${[['bodySize',10,40,1,'px'],['lineHeight',1,3,0.1,'×'],['titleSize',12,48,1,'px']].map(([key,min,max,step,unit])=>`<label class="preference-field">${escape(t(key))}<span class="preference-number"><input type="number" required data-preference="${key}" value="${preferences[key]}" min="${min}" max="${max}" step="${step}"><span>${unit}</span></span></label>`).join('')}<button data-pref-reset>${escape(t('resetPreferences'))}</button>`:`${authSettings()}`}<p class="preferences-error" role="status">${preferencesError?escape(t('preferencesSaveError')):''}</p></section></div><footer class="preferences-footer"><button data-pref-close>${escape(t('close'))}</button></footer>`;
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
      if(dirty()){pendingRemote=event.payload;error='revision_conflict';render();return;}
      model=event.payload;await loadDetail(model.selected);status=model.saved===false?'unsaved':'saved';if(model.saved===false)error='save_failed';render();
    });
    await listen('story://panel',event=>{floating=event.payload;render();});
    await listen('story://save-error',()=>{status='unsaved';error='save_failed';render();});
  }
}
start().catch(e=>{document.getElementById('app').textContent=`${t('error')}: ${String(e)}`;});
