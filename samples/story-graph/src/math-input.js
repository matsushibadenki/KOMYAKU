// Symbio's copied keyboard is intentionally unmodified. This adapter owns only
// a temporary input draft; the host commits LaTeX to the Rust-owned document.
import './vendor/symbio/keyboard.css';
let library;
const load=()=>library??=import(/* @vite-ignore */ new URL('/symbio/mathlive/mathlive.min.mjs',window.location.href).href);
// Use native MathML layout, avoiding injected HTML styles, external fonts or eval.
export async function renderFormula(host,source){
 const math=await load();if(!host.isConnected)return;
 const doc=new DOMParser().parseFromString(`<math xmlns="http://www.w3.org/1998/Math/MathML">${math.convertLatexToMathMl(source)}</math>`,'application/xml');
 const allowed=new Set('math mrow mi mn mo mfrac msqrt mroot msub msup msubsup munder mover munderover mtable mtr mtd mtext mstyle mspace menclose mpadded mphantom semantics annotation merror none'.split(' '));
 for(const node of doc.querySelectorAll('*')){if(!allowed.has(node.localName))throw Error('math_invalid');for(const attr of [...node.attributes])if(/^on/i.test(attr.name)||['href','src','style'].includes(attr.localName))node.removeAttribute(attr.name);}
 host.replaceChildren(document.importNode(doc.documentElement,true));
}
export function renderMathWithin(root){for(const host of root.querySelectorAll('[data-math-source]')){if(host.dataset.mathRendered)continue;host.dataset.mathRendered='true';renderFormula(host,host.dataset.mathSource).catch(()=>{host.textContent=host.dataset.mathSource;});}}
export async function openMathInput({source='',t,onCommit,block=false,fixedBlock=false}){
 const [{createMathKeyboard},{setLocale}]=await Promise.all([import('./vendor/symbio/math-keyboard.js'),import('./vendor/symbio/i18n.js')]);
 const math=await load();setLocale(document.documentElement.lang||'ja');
 const dialog=document.createElement('dialog');dialog.className='math-input-dialog';dialog.setAttribute('aria-label',t('mathInput'));
 const head=document.createElement('div');head.className='math-input-head';const title=document.createElement('strong');title.textContent=t('mathInput');
 const close=document.createElement('button');close.textContent='×';close.title=t('close');close.setAttribute('aria-label',t('close'));close.onclick=()=>dialog.close();head.append(title,close);
 const input=document.createElement('textarea');input.maxLength=4096;input.rows=3;input.value=source;input.spellcheck=false;input.setAttribute('aria-label','LaTeX');
 const preview=document.createElement('div');preview.className='math-input-preview';preview.setAttribute('aria-live','polite');
 const foot=document.createElement('div');foot.className='math-input-head';const label=document.createElement('label'),display=document.createElement('input');display.type='checkbox';display.checked=block;display.disabled=fixedBlock;label.append(display,document.createTextNode(t('mathBlock')));
 const status=document.createElement('span');status.setAttribute('role','status');const apply=document.createElement('button');apply.textContent=t('mathInsert');apply.className='primary';foot.append(label,status,apply);
 let version=0;async function update(){const ticket=++version;apply.disabled=true;status.textContent='';const value=input.value;if(!value.trim())return preview.replaceChildren();try{if(new TextEncoder().encode(value).length>4096||value.includes('□')||math.validateLatex(value).length)throw Error();await renderFormula(preview,value);if(ticket===version)apply.disabled=false;}catch{if(ticket===version){status.textContent=t('mathInvalid');preview.replaceChildren();}}}
 input.addEventListener('input',update);apply.onclick=async()=>{apply.disabled=true;try{await onCommit(input.value,display.checked);dialog.close();}catch{status.textContent=t('mathInvalid');apply.disabled=false;}};
 const keyboard=createMathKeyboard(input,{id:'komyaku',mode:'latex',onClose:()=>dialog.close()});
 dialog.append(head,input,preview,keyboard,foot);document.body.append(dialog);dialog.addEventListener('close',()=>{++version;dialog.remove();},{once:true});dialog.showModal();input.focus();await update();
}
