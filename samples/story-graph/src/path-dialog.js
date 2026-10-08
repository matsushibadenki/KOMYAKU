import {messages} from './locales.js';
const copy={
 ja:{managePaths:'読み順を編集…',pathName:'読み順の名前',pathNew:'読み順を追加',pathDelete:'この読み順を削除',pathHelp:'シーンの参照を並べます。本文とフォルダの所属関係は保持されます。チェックを入れると同じ親の中のツリー順も一緒に更新します。複数の読み順をまたいで循環する並びは保存できません。',pathAddScene:'シーンを追加',pathChooseScene:'追加するシーン',pathEmpty:'シーンがありません。',pathUp:'上へ移動',pathDown:'下へ移動',pathRemove:'この読み順から外す',pathSave:'読み順を保存',pathDefault:'新しい読み順',invalid_path:'名前の重複、シーンの重複、または参照を確認してください。',disconnected_path:'読み順が接続されていません。',path_failed:'読み順を保存できませんでした。',cycle:'読み順に循環があります。並びを見直してください。'},
 en:{managePaths:'Edit reading paths…',pathName:'Path name',pathNew:'Add path',pathDelete:'Delete this path',pathHelp:'Arrange scene references while preserving prose and folder membership. Optionally update outline order within each parent at the same time. Orders forming a cycle across paths cannot be saved.',pathAddScene:'Add scene',pathChooseScene:'Scene to add',pathEmpty:'No scenes.',pathUp:'Move up',pathDown:'Move down',pathRemove:'Remove from this path',pathSave:'Save paths',pathDefault:'New path',invalid_path:'Check duplicate names, duplicate scenes and references.',disconnected_path:'The reading path is disconnected.',path_failed:'Could not save reading paths.',cycle:'The paths form a cycle. Review the order.'},
 'zh-CN':{managePaths:'编辑阅读顺序…',pathName:'阅读顺序名称',pathNew:'添加阅读顺序',pathDelete:'删除此阅读顺序',pathHelp:'排列场景引用，保留正文和文件夹归属关系。勾选后可同时更新同一父项内的结构顺序。多个阅读顺序之间形成循环时无法保存。',pathAddScene:'添加场景',pathChooseScene:'要添加的场景',pathEmpty:'没有场景。',pathUp:'上移',pathDown:'下移',pathRemove:'从此阅读顺序移除',pathSave:'保存阅读顺序',pathDefault:'新的阅读顺序',invalid_path:'请检查重复名称、重复场景和引用。',disconnected_path:'阅读顺序未连接。',path_failed:'无法保存阅读顺序。',cycle:'阅读顺序存在循环，请检查排列。'}
};for(const [language,values]of Object.entries(copy))Object.assign(messages[language],values);
export function openPaths({paths,nodes,selected,t,escape,save}) {
 const values=paths.map(({id,name,scenes,legacy})=>({id,name,scenes:[...scenes],...(legacy?{legacy}:{})}));
 let active=values.findIndex(p=>(p.legacy??p.id)===selected);if(active<0)active=0;let working=false,dragged=null,outlineSync=false;
 const dialog=document.createElement('dialog');dialog.className='workspace-dialog path-dialog';document.body.append(dialog);
 dialog.addEventListener('close',()=>dialog.remove(),{once:true});
 const sceneNodes=nodes.filter(n=>n.type==='story.scene');
 const label=p=>p.legacy&&p.name===p.legacy?t(p.name):p.name;
 const capture=()=>{const name=dialog.querySelector('[name=name]').value.trim();if(name!==label(values[active]))values[active].name=name;};
 const draw=()=>{
  const current=values[active];
  dialog.innerHTML=`<h2>${escape(t('managePaths'))}</h2><p>${escape(t('pathHelp'))}</p><div class="path-picker"><select aria-label="${escape(t('route'))}" data-route>${values.map((p,index)=>`<option value="${index}" ${index===active?'selected':''}>${escape(label(p))}</option>`).join('')}</select><button data-new ${values.length>=32?'disabled':''}>${escape(t('pathNew'))}</button><button data-delete ${values.length<=1?'disabled':''}>${escape(t('pathDelete'))}</button></div><label class="workspace-search">${escape(t('pathName'))}<input name="name" maxlength="80" value="${escape(label(current))}"></label><div class="path-scenes">${current.scenes.map((id,index)=>`<div class="path-scene" draggable="true" data-index="${index}"><span>${index+1}. ${escape(sceneNodes.find(n=>n.id===id)?.title??id)}</span><button data-up="${index}" aria-label="${escape(t('pathUp'))}" ${index===0?'disabled':''}>↑</button><button data-down="${index}" aria-label="${escape(t('pathDown'))}" ${index===current.scenes.length-1?'disabled':''}>↓</button><button data-remove="${index}" aria-label="${escape(t('pathRemove'))}">×</button></div>`).join('')||`<p>${escape(t('pathEmpty'))}</p>`}</div><div class="path-picker"><select data-scene aria-label="${escape(t('pathChooseScene'))}">${sceneNodes.filter(n=>!current.scenes.includes(n.id)).map(n=>`<option value="${escape(n.id)}">${escape(n.title)}</option>`).join('')}</select><button data-add ${sceneNodes.every(n=>current.scenes.includes(n.id))?'disabled':''}>${escape(t('pathAddScene'))}</button></div><label><input type="checkbox" data-outline-sync ${outlineSync?'checked':''}> ${escape(t('pathOutlineSync'))}</label><p role="status"></p><footer><button data-close>${escape(t('cancel'))}</button><button class="primary" data-save>${escape(t('pathSave'))}</button></footer>`;
 };
 dialog.onchange=e=>{if(e.target.hasAttribute('data-outline-sync'))outlineSync=e.target.checked;else if(e.target.matches('[data-route]')){capture();active=Number(e.target.value);draw();}};
 dialog.onclick=async e=>{const button=e.target.closest('button');if(!button||working)return;capture();const current=values[active];
  if(button.hasAttribute('data-close')){dialog.close();return;}
  if(button.hasAttribute('data-new')){let name=t('pathDefault'),suffix=2;while(values.some(p=>label(p)===name))name=`${t('pathDefault')} ${suffix++}`;values.push({id:crypto.randomUUID(),name,scenes:[]});active=values.length-1;}
  else if(button.hasAttribute('data-delete')){if(values.length<=1)return;values.splice(active,1);active=Math.min(active,values.length-1);}
  else if(button.hasAttribute('data-add')){const id=dialog.querySelector('[data-scene]').value;if(id&&!current.scenes.includes(id))current.scenes.push(id);}
  else if(button.hasAttribute('data-remove'))current.scenes.splice(Number(button.dataset.remove),1);
  else if(button.hasAttribute('data-up')||button.hasAttribute('data-down')){const index=Number(button.dataset.up??button.dataset.down),other=index+(button.hasAttribute('data-up')?-1:1);[current.scenes[index],current.scenes[other]]=[current.scenes[other],current.scenes[index]];}
  else if(button.hasAttribute('data-save')){working=true;const disabled=new Map([...dialog.querySelectorAll('button,input,select')].map(element=>[element,element.disabled]));for(const element of disabled.keys())element.disabled=true;try{await save(values,current.legacy??current.id,outlineSync?current.id:null);dialog.close();}catch(error){dialog.querySelector('[role=status]').textContent=t(String(error));for(const [element,value]of disabled)element.disabled=value;}finally{working=false;}return;}
  draw();
 };
 dialog.ondragstart=e=>{const row=e.target.closest('[data-index]');if(!row||working)return;capture();dragged=Number(row.dataset.index);e.dataTransfer.setData('text/plain',String(dragged));};
 dialog.ondragover=e=>{if(dragged!==null&&e.target.closest('[data-index]'))e.preventDefault();};
 dialog.ondrop=e=>{const row=e.target.closest('[data-index]');if(!row||dragged===null||working)return;e.preventDefault();const list=values[active].scenes;list.splice(Number(row.dataset.index),0,list.splice(dragged,1)[0]);dragged=null;draw();};dialog.ondragend=()=>dragged=null;
 draw();dialog.showModal();
}

for(const [lang,text]of Object.entries({ja:'選択した読み順に合わせてツリーを並べ替える（同じ親の中）',en:'Reorder the outline to match this path (within each parent)',"zh-CN":'按当前阅读顺序排列结构树（仅在同一父项内）'}))messages[lang].pathOutlineSync=text;
