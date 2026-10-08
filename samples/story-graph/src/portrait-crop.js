import {messages} from './locales.js';
for(const [language,values]of Object.entries({
 ja:{cropPortrait:'人物画像を調整',cropX:'横の位置',cropY:'縦の位置',cropZoom:'拡大率',cropHint:'元画像から正方形に切り抜きます。位置と拡大率を調整して保存してください。',cropApply:'この画像を使用'},
 en:{cropPortrait:'Adjust portrait',cropX:'Horizontal position',cropY:'Vertical position',cropZoom:'Zoom',cropHint:'Crop a square from the original image. Adjust the position and zoom before saving.',cropApply:'Use this portrait'},
 'zh-CN':{cropPortrait:'调整人物图片',cropX:'水平位置',cropY:'垂直位置',cropZoom:'缩放',cropHint:'从原图裁剪正方形，调整位置和缩放后保存。',cropApply:'使用此图片'}
}))Object.assign(messages[language],values);
export function cropPortrait({preview,invoke,t,escape}){
 return new Promise(resolve=>{
  const dialog=document.createElement('dialog');dialog.className='workspace-dialog portrait-crop';
  dialog.innerHTML=`<h2>${escape(t('cropPortrait'))}</h2><p>${escape(t('cropHint'))}</p><img src="${escape(preview.image)}" width="192" height="192" alt="${escape(t('portrait'))}">${[['x','cropX',0,1,0.5,0.01],['y','cropY',0,1,0.5,0.01],['zoom','cropZoom',1,8,1,0.05]].map(([key,label,min,max,value,step])=>`<label>${escape(t(label))}<input type="range" name="${key}" min="${min}" max="${max}" step="${step}" value="${value}"><output data-value="${key}">${value}</output></label>`).join('')}<p role="status"></p><footer><button data-cancel>${escape(t('cancel'))}</button><button class="primary" data-apply>${escape(t('cropApply'))}</button></footer>`;
  document.body.append(dialog);let timer,ticket=0,working=false,settled=false;
  const settings=()=>Object.fromEntries([...dialog.querySelectorAll('input')].map(input=>[input.name,Number(input.value)]));
  dialog.oninput=event=>{dialog.querySelector(`[data-value="${event.target.name}"]`).textContent=event.target.value;clearTimeout(timer);const request=++ticket;timer=setTimeout(async()=>{try{const result=await invoke('crop_portrait',{token:preview.token,...settings(),apply:false});if(request===ticket&&!settled)dialog.querySelector('img').src=result.image;}catch(error){if(!settled)dialog.querySelector('[role=status]').textContent=t(String(error));}},120);};
  dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();
  dialog.querySelector('[data-apply]').onclick=async()=>{if(working)return;working=true;clearTimeout(timer);++ticket;dialog.querySelectorAll('button,input').forEach(n=>n.disabled=true);try{const result=await invoke('crop_portrait',{token:preview.token,...settings(),apply:true});settled=true;resolve(result);dialog.close();}catch(error){dialog.querySelector('[role=status]').textContent=t(String(error));dialog.querySelectorAll('button,input').forEach(n=>n.disabled=false);}finally{working=false;}};
  dialog.addEventListener('close',()=>{clearTimeout(timer);if(!settled){settled=true;invoke('cancel_portrait',{token:preview.token}).catch(()=>{});resolve(null);}dialog.remove();},{once:true});dialog.showModal();
 });
}
