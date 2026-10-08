// The window displays Rust-owned review snapshots/results. Tokens never enter this module.
export function installAssistant({invoke, native, t, escape, getScene, refresh, commit, settings, getLanguage}) {
  let dialog, state, diff=null, accounts=[], models=[], selectedAccount='', loading=false, timer, instruction='', selectedModel='';
  const setError=error=>{const el=dialog?.querySelector('[data-ai-error]');if(el)el.textContent=t(String(error));};
  function draw() {
    if(!dialog)return;
    const running=state?.phase==='generating', finished=state?.phase==='completed';
    dialog.innerHTML=`<header class="preferences-header"><h2>${escape(t('writingAssist'))}</h2><button data-ai-close aria-label="${escape(t('close'))}">×</button></header><div class="assistant-content"><p class="assistant-scene">${escape(state?.title||'')}</p><p class="preferences-hint">${escape(t('aiSendHint'))}</p><div class="assistant-selectors"><label>${escape(t('aiAccount'))}<select data-ai-account ${running?'disabled':''}>${accounts.map(a=>`<option value="${escape(a.id)}" ${a.id===selectedAccount?'selected':''}>${escape(a.email)} · ${escape(a.id.slice(-8))}</option>`).join('')}</select></label><label>${escape(t('aiModel'))}<select data-ai-model ${running||loading?'disabled':''}>${models.map(m=>`<option value="${escape(m.slug)}" ${m.slug===selectedModel?'selected':''}>${escape(m.displayName)}</option>`).join('')}</select></label></div>${!accounts.length?`<p>${escape(t('ai_sign_in_required'))}</p><button data-ai-settings>${escape(t('preferences'))} → AI</button>`:''}<p class="assistant-scope">${escape(t(state?.selection?'aiSelectionOnly':'aiWholeScene'))}${state?.phase==='ready'&&state.selection?` <button data-ai-whole>${escape(t('aiUseWhole'))}</button>`:''}</p><details class="assistant-source"><summary>${escape(t('aiSendSource'))} · ${[...(state?.sourceText||'')].length} ${escape(t('count'))}</summary><pre>${escape(state?.sourceText||t('aiEmptySource'))}</pre></details><label class="assistant-request">${escape(t('aiRequest'))}<textarea data-ai-instruction rows="3" maxlength="4000" ${running||finished?'readonly':''} placeholder="${escape(t('aiRequestPlaceholder'))}">${escape(instruction)}</textarea></label><div class="assistant-presets">${['aiContinue','aiPolish','aiIdeas'].map(key=>`<button data-ai-preset="${key}" ${running||finished?'disabled':''}>${escape(t(key))}</button>`).join('')}</div><div class="assistant-result"><label>${escape(t('aiResult'))}<textarea data-ai-result readonly rows="7">${escape(state?.text||'')}</textarea></label></div>${finished?`<button data-ai-compare>${escape(t('aiCompare'))}</button><div data-ai-diff></div>`:''}<p role="status" data-ai-phase>${escape(t(loading?'aiLoadingModels':running?'aiGenerating':finished?'aiCompleted':state?.phase==='applied'?'aiApplied':'aiReady'))}</p><p class="preferences-error" role="status" data-ai-error>${state?.error?escape(t(state.error)):''}</p>${state?.requestId?`<small class="preferences-hint">Request ID: ${escape(state.requestId)}</small>`:''}</div><footer class="preferences-footer assistant-footer"><button data-ai-refresh ${running||loading?'disabled':''}>${escape(t('aiRefreshModels'))}</button><button data-ai-new ${running?'disabled':''}>${escape(t('aiNewRequest'))}</button>${running?`<button data-ai-cancel>${escape(t('cancel'))}</button>`:`<button data-ai-send ${!native||!accounts.length||!selectedModel||loading||state?.phase!=='ready'?'disabled':''}>${escape(t('aiSend'))}</button>`}${state?.selection?`<button data-ai-replace ${finished?'':'disabled'}>${escape(t('aiReplace'))}</button>`:''}${state?.phase==='applied'?`<button data-ai-version>${escape(t('aiSaveVersion'))}</button>`:''}<button data-ai-append ${finished?'':'disabled'}>${escape(t('aiAppend'))}</button></footer>`;
    dialog.querySelector('[data-ai-close]').onclick=()=>dialog.close();
    dialog.querySelector('[data-ai-settings]')?.addEventListener('click',()=>{dialog.close();settings();});
    dialog.querySelector('[data-ai-account]').onchange=event=>{selectedAccount=event.target.value;selectedModel='';loadModels();};
    dialog.querySelector('[data-ai-model]').onchange=event=>selectedModel=event.target.value;
    dialog.querySelector('[data-ai-instruction]').oninput=event=>instruction=event.target.value;
    dialog.querySelectorAll('[data-ai-preset]').forEach(button=>button.onclick=()=>{instruction=t(`${button.dataset.aiPreset}Prompt`);draw();dialog.querySelector('[data-ai-instruction]').focus();});
    dialog.querySelector('[data-ai-refresh]').onclick=()=>loadModels();
    dialog.querySelector('[data-ai-new]').onclick=()=>open(true);
    dialog.querySelector('[data-ai-send]')?.addEventListener('click',async()=>{
      if(!instruction.trim()){setError('ai_request_required');return;}
      const button=dialog.querySelector('[data-ai-send]');button.disabled=true;
      try {await invoke('ai_generate',{id:state.id,accountId:selectedAccount,model:selectedModel,instruction,language:getLanguage()});state=await invoke('ai_status',{id:state.id});draw();poll();}catch(e){setError(e);button.disabled=false;}
    });
    dialog.querySelector('[data-ai-cancel]')?.addEventListener('click',async()=>{try{await invoke('ai_cancel',{id:state.id});}catch(e){setError(e);}});
    const showDiff=()=>{const output=dialog.querySelector('[data-ai-diff]');if(!output||!diff)return;const omit=n=>`<span class="diff-omission">${escape(t('versionDiffOmitted'))}: ${n}</span>`;output.innerHTML=`<p class="diff-counts">${escape(t('versionAdded'))}: ${diff.added} · ${escape(t('versionDeleted'))}: ${diff.removed}</p>${diff.coarse?`<p>${escape(t('versionDiffCoarse'))}</p>`:''}<div class="diff-text">${diff.contextBeforeOmitted?omit(diff.contextBeforeOmitted):''}${diff.segments.map(segment=>{const tag={added:'ins',removed:'del',equal:'span'}[segment.kind];return `<${tag}>${escape(segment.text)}</${tag}>${segment.omitted?omit(segment.omitted):''}`;}).join('')}${diff.contextAfterOmitted?omit(diff.contextAfterOmitted):''}</div>`;};
    dialog.querySelector('[data-ai-compare]')?.addEventListener('click',async()=>{try{diff=await invoke('ai_compare',{id:state.id});showDiff();}catch(e){setError(e);}});showDiff();
    dialog.querySelector('[data-ai-whole]')?.addEventListener('click',async()=>{try{const scene=getScene();state=await invoke('ai_prepare',{sceneId:scene.id,expectedRevision:scene.revision,selection:null});diff=null;draw();}catch(e){setError(e);}});
    for(const selector of ['[data-ai-append]','[data-ai-replace]'])dialog.querySelector(selector)?.addEventListener('click',async()=>{
      const button=dialog.querySelector(selector);button.disabled=true;
      try {if(!await commit())throw 'ai_source_changed';await invoke('ai_append',{id:state.id,replaceSelection:selector==='[data-ai-replace]'});state=await invoke('ai_status',{id:state.id});await refresh();draw();}catch(e){setError(e);button.disabled=false;}
    });
    dialog.querySelector('[data-ai-version]')?.addEventListener('click',async()=>{const button=dialog.querySelector('[data-ai-version]');button.disabled=true;try{const scene=getScene();await invoke('save_version',{message:t('aiVersionMessage'),expectedRevision:scene.revision});button.textContent=t('versionSaved');}catch(e){setError(e);button.disabled=false;}});

  }
  async function loadModels() {
    if(!selectedAccount){models=[];draw();return;}
    const account=selectedAccount;loading=true;models=[];draw();
    try {const result=await invoke('ai_models',{accountId:account});if(selectedAccount!==account)return;models=result;selectedModel=models.some(m=>m.slug===selectedModel)?selectedModel:(models[0]?.slug||'');loading=false;draw();if(!models.length)setError('ai_model_unavailable');}
    catch(e){if(selectedAccount===account){loading=false;draw();setError(e);}}
  }
  async function poll() {
    clearTimeout(timer);if(!dialog.open)return;
    try {state=await invoke('ai_status',{id:state.id});const text=dialog.querySelector('[data-ai-result]');if(text&&text.value!==state.text){const atEnd=text.scrollTop+text.clientHeight>=text.scrollHeight-20;text.value=state.text;if(atEnd)text.scrollTop=text.scrollHeight;}
      if(state.phase!=='generating'){draw();return;}
    }catch(e){setError(e);return;}
    timer=setTimeout(poll,400);
  }
  async function open(reset=false) {
    if(!native)return;
    if(!dialog){dialog=document.createElement('dialog');dialog.className='preferences-dialog assistant-dialog';dialog.setAttribute('aria-label',t('writingAssist'));document.body.append(dialog);dialog.addEventListener('close',()=>clearTimeout(timer));}
    if(state&&!reset&&state.phase!=='ready'){draw();if(!dialog.open)dialog.showModal();if(state.phase==='generating')poll();return;}
    const requested=getScene();
    if(!await commit())return;
    const scene=getScene();if(!scene||scene.id!==requested?.id)return;
    scene.selection=requested.selection;
    state=await invoke('ai_prepare',{sceneId:scene.id,expectedRevision:scene.revision,selection:scene.selection});diff=null;
    const auth=await invoke('chatgpt_status');accounts=auth.accounts.filter(a=>a.connected&&a.planEnabled);
    if(!accounts.some(a=>a.id===selectedAccount)){selectedAccount=accounts[0]?.id||'';selectedModel='';}
    draw();if(!dialog.open)dialog.showModal();await loadModels();
  }
  return open;
}
