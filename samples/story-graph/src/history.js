import {GitClient} from './vendor/parts/parts-git-client.js';
import './vendor/parts/parts-git-client.css';
import './history-locales.js';
export function mountHistory(root,{native,invoke,t,escape,language,commit,revision,title}) {
  let client,disposed=false,working=false,versionEntries=[],pageOffset=0,pageHead=null,total=0,loadGeneration=0,searchTimer;
  const comparisons=new Map(),knownVersions=new Map();
  root.innerHTML=`<header class="history-heading"><h2>${escape(t('history'))}</h2><p>${escape(t('versionHelp'))}</p></header><form class="version-form"><input name="message" maxlength="200" required aria-label="${escape(t('versionName'))}" placeholder="${escape(t('versionName'))}" ${native?'':'disabled'}><button class="primary" ${native?'':'disabled'}>${escape(t('saveVersion'))}</button></form><p class="history-status" role="status"></p><div class="parts-git-client parts-git-client--compact"><header class="parts-git-client__toolbar"><span class="parts-git-client__repo">${escape(title)}</span><input class="parts-git-client__search" type="search" maxlength="200" data-parts-git-search aria-label="${escape(t('historyFilter'))}" placeholder="${escape(t('historyFilter'))}"><button type="button" data-parts-git-sync aria-label="${escape(t('historyRefresh'))}">↻</button></header><div class="parts-git-client__body"><div class="parts-git-client__history"><div class="parts-git-client__canvas"><svg class="parts-git-client__svg" aria-hidden="true"></svg><ol class="parts-git-client__list" aria-label="${escape(t('history'))}"></ol><div class="parts-git-client__empty">${escape(t('historyEmpty'))}</div></div></div></div></div><footer class="history-pager"><button type="button" data-newer>${escape(t('historyNewer'))}</button><span role="status"></span><button type="button" data-older>${escape(t('historyOlder'))}</button></footer>`;
  const status=root.querySelector('.history-status'),form=root.querySelector('form');
  const say=(key)=>{if(!disposed)status.textContent=t(key);};
  async function detail(version,target,graph) {
    target.innerHTML=`<time>${escape(version.date)}</time><p>${escape(version.title||title)} · ${escape(t('versionCounts'))}: ${version.scenes} / ${version.nodes}</p><code>${escape(version.id)}</code><label class="version-compare-picker">${escape(t('versionCompareTarget'))}<select><option value="">${escape(t('versionCurrentDraft'))}</option>${[...new Map([...versionEntries.map(item=>[item.id,item]),...(knownVersions.has(comparisons.get(version.id))?[[comparisons.get(version.id),knownVersions.get(comparisons.get(version.id))]]:[])]).values()].filter(item=>item.id!==version.id).map(item=>`<option value="${escape(item.id)}" ${comparisons.get(version.id)===item.id?'selected':''}>${escape(item.message)}</option>`).join('')}<option value="__older">${escape(t('historyMoreTargets'))}</option></select></label><h3>${escape(t('versionCompare'))}</h3><div class="version-changes"></div><form class="version-restore"><label>${escape(t('versionRestoreName'))}<input required maxlength="200" value="${escape(version.title||title)}"></label><p>${escape(t('versionRestoreHint'))}</p><button type="submit">${escape(t('versionRestore'))}</button><p role="status"></p></form>`;
    const operations=document.createElement('section');operations.className='version-lineage';
    operations.innerHTML=`<form class="version-fork"><label>${escape(t('branchName'))}<input name="branch" required maxlength="80" placeholder="${escape(t('branchName'))}"></label><p>${escape(t('branchHint'))}</p><button>${escape(t('branchCreate'))}</button><p role="status"></p></form><button type="button" data-merge>${escape(t('mergePreview'))}</button><div class="merge-preview"></div>`;target.append(operations);
    operations.querySelector('form').onsubmit=async event=>{event.preventDefault();if(working||!await commit())return;working=true;const button=event.target.querySelector('button');button.disabled=true;try{await invoke('fork_version',{id:version.id,branch:event.target.elements.branch.value.trim()});say('branchOpened');}catch(e){operations.querySelector('[role=status]').textContent=t(String(e));}finally{working=false;button.disabled=false;}};
    operations.querySelector('[data-merge]').onclick=async event=>{
      if(working||!await commit())return;working=true;event.target.disabled=true;const output=operations.querySelector('.merge-preview'),expectedRevision=revision();output.textContent=t('versionDiffLoading');
      try{const preview=await invoke('preview_merge',{target:version.id,expectedRevision});if(disposed||!output.isConnected)return;
        output.innerHTML=`<p>${escape(t('mergeHint'))}</p><p>${escape(t('mergeChanged'))}: ${preview.changedNodes}${preview.structureChanged?` · ${escape(t('versionStructure'))}`:''}</p><form><label>${escape(t('versionName'))}<input name="message" required maxlength="200" value="${escape(t('mergeDefault'))}"></label>${preview.conflicts.map(conflict=>`<label>${escape(conflict.title)} · ${escape(t('mergeField_'+conflict.field))}<select data-conflict="${escape(conflict.path)}" required><option value="">${escape(t('mergeChoose'))}</option><option value="current">${escape(t('versionCurrentDraft'))}</option><option value="alternative">${escape(t('mergeSelectedVersion'))}</option></select></label>`).join('')}<button>${escape(t('mergeOpen'))}</button><p role="status"></p></form>`;
        output.querySelector('form').onsubmit=async event=>{event.preventDefault();if(working)return;working=true;const button=event.target.querySelector('button');button.disabled=true;try{await invoke('merge_version',{request:{target:version.id,expectedHead:preview.head,expectedRevision,choices:Object.fromEntries([...output.querySelectorAll('[data-conflict]')].map(input=>[input.dataset.conflict,input.value])),message:event.target.elements.message.value.trim()}});say('mergeOpened');}catch(e){output.querySelector('[role=status]').textContent=t(String(e));}finally{working=false;button.disabled=false;}};
      }catch(e){output.textContent=t(String(e));}finally{working=false;event.target.disabled=false;graph();}
    };
    const changes=target.querySelector('.version-changes');
    const location=change=>{
      const loc=change.location;if(!loc)return '';
      return `<p class="version-location">${loc.parentChanged?`${escape(t('versionMoved'))}: ${escape(loc.beforeParent||t('versionRoot'))} → ${escape(loc.afterParent||t('versionRoot'))}`:''}${loc.orderChanged?` <span>${escape(t('versionOrder'))}: ${Number.isInteger(loc.beforeOrder)?loc.beforeOrder+1:'—'} → ${Number.isInteger(loc.afterOrder)?loc.afterOrder+1:'—'}</span>`:''}</p>`;
    };
    const picker=target.querySelector('.version-compare-picker select');
    let generation=0;
    async function compare(){
      const request=++generation,compareId=picker.value||null;
      comparisons.set(version.id,picker.value);
      changes.textContent=t('versionDiffLoading');
      try {
        const result=await invoke('version_detail',{id:version.id,compareId});
        if(disposed||!target.isConnected||request!==generation)return;
        const graphDiff=result.graphDiff;
        const endpoint=value=>value?`${value.from} (${value.fromPort}) → ${value.to} (${value.toPort})`:'—';
        const position=value=>value?`${Math.round(value.x)}, ${Math.round(value.y)} · ${Math.round(value.width)}×${Math.round(value.height)}`:'—';
        const graphChanges=graphDiff?.total?`<details class="version-graph-diff"><summary>${escape(t('versionGraphDiff'))} · ${graphDiff.total}</summary><ul>${graphDiff.changes.map(item=>`<li><strong>${escape(t({edge:'versionConnection',placement:'versionPosition',portrait:'versionPortrait',path:'route',group:'versionGroup'}[item.type]))}</strong> ${escape(item.title||'')}<p>${escape(item.type==='edge'?endpoint(item.before)+' → '+endpoint(item.after):item.type==='placement'?position(item.before)+' → '+position(item.after):item.type==='path'?(item.before?.name??'—')+' ('+(item.before?.scenes??0)+') → '+(item.after?.name??'—')+' ('+(item.after?.scenes??0)+')'+(item.orderChanged?' · '+t('versionOrder'):''):item.type==='group'?(item.before?.name??'—')+' ('+(item.before?.members??0)+') → '+(item.after?.name??'—')+' ('+(item.after?.members??0)+')':item.type==='portrait'?(item.before?t('versionExistingImage'):'—')+' → '+(item.after?t('versionExistingImage'):'—'):item.id)}</p></li>`).join('')}</ul>${graphDiff.omitted?`<p>${escape(t('versionStructureOmitted'))}: ${graphDiff.omitted}</p>`:''}</details>`:'';
        changes.innerHTML=`${graphChanges}${result.titleChanged?`<p>${escape(t('versionTitle'))}</p>`:''}${result.structureChanged?`<p>${escape(t('versionStructure'))}</p>`:''}<ul>${result.changes.map(change=>`<li><span class="change-${change.kind}">${escape(t({added:'versionAdded',changed:'versionChanged',deleted:'versionDeleted'}[change.kind]))}</span> ${escape(change.title||change.id)}${location(change)}${change.textAvailable?`<button type="button" data-text-diff="${escape(change.id)}">${escape(t('versionTextDiff'))}</button><div class="version-text-diff" hidden></div>`:''}${change.structureAvailable?`<button type="button" data-structure-diff="${escape(change.id)}">${escape(t('versionStructureDiff'))}</button><div class="version-structure-diff" hidden></div>`:''}</li>`).join('')}</ul>${!result.titleChanged&&!result.structureChanged&&!result.changes.length?`<p>${escape(t('versionNoChanges'))}</p>`:''}`;
        for(const button of changes.querySelectorAll('[data-structure-diff]'))button.onclick=async()=>{
          const output=button.nextElementSibling;
          if(output.dataset.loaded){output.hidden=!output.hidden;graph();return;}
          button.disabled=true;output.hidden=false;output.textContent=t('versionDiffLoading');
          try{
            const diff=await invoke('version_structure_diff',{id:version.id,nodeId:button.dataset.structureDiff,compareId,expectedRevision:result.revision});
            if(disposed||!output.isConnected||request!==generation)return;
            output.innerHTML=diff.total?`<ol>${diff.changes.map(item=>`<li><span class="change-${item.kind}">${escape(t({added:'versionAdded',changed:'versionChanged',deleted:'versionDeleted',moved:'versionMoved'}[item.kind]))}</span> ${escape(t(item.blockType==='dialogue'?'versionDialogue':'versionParagraph'))} ${item.beforePosition??'—'} → ${item.afterPosition??'—'}${['actorChanged','dialogueChanged','layoutChanged','textChanged'].filter(key=>item[key]).map(key=>`<span class="structure-tag">${escape(t({actorChanged:'versionActorChanged',dialogueChanged:'versionDialogueChanged',layoutChanged:'versionLayoutChanged',textChanged:'versionParagraphChanged'}[key]))}</span>`).join('')}</li>`).join('')}</ol>${diff.omitted?`<p>${escape(t('versionStructureOmitted'))}: ${diff.omitted}</p>`:''}`:`<p>${escape(t('versionNoChanges'))}</p>`;
            output.dataset.loaded='true';
          }catch(e){if(output.isConnected)output.textContent=t(String(e));}
          finally{button.disabled=false;graph();}
        };
        for(const button of changes.querySelectorAll('[data-text-diff]'))button.onclick=async()=>{
          const output=button.nextElementSibling;
          if(output.dataset.loaded){output.hidden=!output.hidden;graph();return;}
          button.disabled=true;output.hidden=false;output.textContent=t('versionDiffLoading');
          try{
            const diff=await invoke('version_text_diff',{id:version.id,nodeId:button.dataset.textDiff,compareId,expectedRevision:result.revision});
            if(disposed||!output.isConnected||request!==generation)return;
            const omit=n=>`<span class="diff-omission">${escape(t('versionDiffOmitted'))}: ${n}</span>`;
            output.innerHTML=`<p class="diff-counts"><span>${escape(t('versionAdded'))}: ${diff.added}</span><span>${escape(t('versionDeleted'))}: ${diff.removed}</span></p>${diff.coarse?`<p class="diff-note">${escape(t('versionDiffCoarse'))}</p>`:''}<div class="diff-text">${diff.contextBeforeOmitted?omit(diff.contextBeforeOmitted):''}${diff.segments.map(segment=>{const tag={added:'ins',removed:'del',equal:'span'}[segment.kind]||'span';return `<${tag}>${escape(segment.text)}</${tag}>${segment.omitted?omit(segment.omitted):''}`;}).join('')}${diff.contextAfterOmitted?omit(diff.contextAfterOmitted):''}</div>${!diff.added&&!diff.removed?`<p>${escape(t('versionTextSame'))}</p>`:''}`;
            output.dataset.loaded='true';
          }catch(e){if(output.isConnected)output.textContent=t(String(e));}
          finally{button.disabled=false;graph();}
        }
      }catch(e){if(target.isConnected&&request===generation)changes.textContent=t(String(e));}
      graph();
    }
    let compareOffset=0,compareHead=null;
    picker.onchange=async()=>{
      if(picker.value!=='__older'){await compare();return;}
      picker.disabled=true;
      try{
        const result=await invoke('version_page',{query:'',offset:compareOffset,head:compareHead});
        if(disposed||!target.isConnected)return;
        compareHead=result.head;compareOffset+=result.items.length;
        for(const item of result.items){knownVersions.set(item.id,item);if(item.id!==version.id&&![...picker.options].some(option=>option.value===item.id)){
          const option=document.createElement('option');option.value=item.id;option.textContent=item.message;
          picker.insertBefore(option,picker.lastElementChild);
        }}
        if(compareOffset>=result.total)picker.querySelector('[value="__older"]')?.remove();
      }catch(e){changes.textContent=t(String(e));}
      finally{picker.value=comparisons.get(version.id)||'';picker.disabled=false;graph();}
    };
    await compare();
    target.querySelector('form').onsubmit=async event=>{
      event.preventDefault(); if(working||!await commit())return;
      working=true;const button=target.querySelector('.version-restore button');button.disabled=true;
      try{await invoke('restore_version',{id:version.id,title:target.querySelector('input').value});say('versionOpened');}
      catch(e){target.querySelector('[role=status]').textContent=t(String(e));}
      finally{working=false;button.disabled=false;}
    };
  }
  const search=root.querySelector('[data-parts-git-search]'),pager=root.querySelector('.history-pager');
  pager.querySelector('[data-newer]').onclick=()=>load(Math.max(0,pageOffset-40),pageHead);
  pager.querySelector('[data-older]').onclick=()=>load(pageOffset+40,pageHead);
  async function load(offset=0,head=null){
    const request=++loadGeneration;
    for(const button of pager.querySelectorAll('button'))button.disabled=true;
    try{
      const result=native?await invoke('version_page',{query:search.value.slice(0,200),offset,head}):{items:[],total:0,head:0,offset:0};
      if(disposed||request!==loadGeneration)return;
      const versions=result.items;pageOffset=result.offset;pageHead=result.head;total=result.total;
      versionEntries=versions;for(const version of versions)knownVersions.set(version.id,version);
      pager.querySelector('span').textContent=`${total?offset+1:0}–${Math.min(offset+40,total)} / ${total}`;
      pager.querySelector('[data-newer]').disabled=offset===0;
      pager.querySelector('[data-older]').disabled=offset+40>=total;
      root.querySelector('.parts-git-client__empty').textContent=t(search.value.trim()?'historyNoMatches':'historyEmpty');
      client?.destroy();
      const lanes=new Map();for(const v of [...knownVersions.values()])if(!lanes.has(v.branch||'main'))lanes.set(v.branch||'main',lanes.size%4);
      client=new GitClient(root.querySelector('.parts-git-client'),versions.map((v,index)=>({...v,lane:lanes.get(v.branch||'main'),author:'',date:new Date(v.date*1000).toLocaleString(language),refs:[{name:v.branch||'main',type:'branch'},...(v.sequence===pageHead?[{name:t('versionLatest'),type:'head'}]:[])]})),{t,detail,refresh:()=>load(),search:()=>{clearTimeout(searchTimer);++loadGeneration;searchTimer=setTimeout(()=>load(),180);}});
    }catch(e){if(!disposed&&request===loadGeneration){say(String(e));pager.querySelector('[data-newer]').disabled=pageOffset===0;pager.querySelector('[data-older]').disabled=pageOffset+40>=total;}}
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(working)return;
    const message=form.elements.message.value.trim();if(!message){say('version_name_invalid');return;}
    working=true;form.querySelector('button').disabled=true;
    try{if(!await commit())return;await invoke('save_version',{message,expectedRevision:revision()});form.reset();await load();say('versionSaved');}
    catch(e){say(String(e));}finally{working=false;if(!disposed)form.querySelector('button').disabled=!native;}
  };
  load();
  return ()=>{disposed=true;clearTimeout(searchTimer);client?.destroy();};
}
