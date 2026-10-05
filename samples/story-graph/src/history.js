import {GitClient} from './vendor/parts/parts-git-client.js';
import './vendor/parts/parts-git-client.css';
import './history-locales.js';
export function mountHistory(root,{native,invoke,t,escape,language,commit,revision,title}) {
  let client,disposed=false,working=false;
  root.innerHTML=`<header class="history-heading"><h2>${escape(t('history'))}</h2><p>${escape(t('versionHelp'))}</p></header><form class="version-form"><input name="message" maxlength="200" required aria-label="${escape(t('versionName'))}" placeholder="${escape(t('versionName'))}" ${native?'':'disabled'}><button class="primary" ${native?'':'disabled'}>${escape(t('saveVersion'))}</button></form><p class="history-status" role="status"></p><div class="parts-git-client parts-git-client--compact"><header class="parts-git-client__toolbar"><span class="parts-git-client__repo">${escape(title)}</span><input class="parts-git-client__search" type="search" data-parts-git-search aria-label="${escape(t('historyFilter'))}" placeholder="${escape(t('historyFilter'))}"><button type="button" data-parts-git-sync aria-label="${escape(t('historyRefresh'))}">↻</button></header><div class="parts-git-client__body"><div class="parts-git-client__history"><div class="parts-git-client__canvas"><svg class="parts-git-client__svg" aria-hidden="true"></svg><ol class="parts-git-client__list" aria-label="${escape(t('history'))}"></ol><div class="parts-git-client__empty">${escape(t('historyEmpty'))}</div></div></div></div></div>`;
  const status=root.querySelector('.history-status'),form=root.querySelector('form');
  const say=(key)=>{if(!disposed)status.textContent=t(key);};
  async function detail(version,target,graph) {
    target.innerHTML=`<time>${escape(version.date)}</time><p>${escape(version.title||title)} · ${escape(t('versionCounts'))}: ${version.scenes} / ${version.nodes}</p><code>${escape(version.id)}</code><h3>${escape(t('versionCompare'))}</h3><div class="version-changes"></div><form class="version-restore"><label>${escape(t('versionRestoreName'))}<input required maxlength="200" value="${escape(version.title||title)}"></label><p>${escape(t('versionRestoreHint'))}</p><button type="submit">${escape(t('versionRestore'))}</button><p role="status"></p></form>`;
    const changes=target.querySelector('.version-changes');
    try {
      const result=await invoke('version_detail',{id:version.id});
      if(disposed||!target.isConnected)return;
      changes.innerHTML=`${result.titleChanged?`<p>${escape(t('versionTitle'))}</p>`:''}${result.structureChanged?`<p>${escape(t('versionStructure'))}</p>`:''}<ul>${result.changes.map(change=>`<li><span class="change-${change.kind}">${escape(t({added:'versionAdded',changed:'versionChanged',deleted:'versionDeleted'}[change.kind]))}</span> ${escape(change.title||change.id)}</li>`).join('')}</ul>${!result.titleChanged&&!result.structureChanged&&!result.changes.length?`<p>${escape(t('versionSame'))}</p>`:''}`;
    }catch(e){if(target.isConnected)changes.textContent=t(String(e));}
    graph();
    target.querySelector('form').onsubmit=async event=>{
      event.preventDefault(); if(working||!await commit())return;
      working=true;const button=target.querySelector('button');button.disabled=true;
      try{await invoke('restore_version',{id:version.id,title:target.querySelector('input').value});say('versionOpened');}
      catch(e){target.querySelector('[role=status]').textContent=t(String(e));}
      finally{working=false;button.disabled=false;}
    };
  }
  async function load(){
    try{
      const versions=native?await invoke('versions'):[];
      if(disposed)return;
      client?.destroy();
      client=new GitClient(root.querySelector('.parts-git-client'),versions.map((v,index)=>({...v,lane:0,author:'',date:new Date(v.date*1000).toLocaleString(language),refs:index===0?[{name:t('versionLatest'),type:'head'}]:[]})),{t,detail,refresh:load});
    }catch(e){say(String(e));}
  }
  form.onsubmit=async event=>{
    event.preventDefault();if(working)return;
    const message=form.elements.message.value.trim();if(!message){say('version_name_invalid');return;}
    working=true;form.querySelector('button').disabled=true;
    try{if(!await commit())return;await invoke('save_version',{message,expectedRevision:revision()});form.reset();await load();say('versionSaved');}
    catch(e){say(String(e));}finally{working=false;if(!disposed)form.querySelector('button').disabled=!native;}
  };
  load();
  return ()=>{disposed=true;client?.destroy();};
}
