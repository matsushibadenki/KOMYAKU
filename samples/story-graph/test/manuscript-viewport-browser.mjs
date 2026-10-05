import {chromium} from '../../../apps/desktop/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
const fixture=JSON.parse(await fs.readFile(new URL('../src/preview.json',import.meta.url),'utf8'));
const browser=await chromium.launch({executablePath:process.env.STORY_GRAPH_QA_BROWSER||undefined,headless:true});
const output=process.env.STORY_GRAPH_QA_OUTPUT||os.tmpdir();
await fs.mkdir(output,{recursive:true});
try {
 for(const [mode,kind] of [['horizontal','many'],['vertical','many'],['horizontal','million'],['vertical','million'],['horizontal','group'],['vertical','group'],['horizontal','medium'],['vertical','medium'],['horizontal','dialogue'],['vertical','dialogue'],['horizontal','dialogue-group'],['vertical','dialogue-group'],['horizontal','dialogue-only'],['vertical','dialogue-only'],['horizontal','crlf'],['vertical','crlf']]) {
  if(process.env.STORY_GRAPH_QA_CASE&&process.env.STORY_GRAPH_QA_CASE!==`${kind}-${mode}`)continue;
  const page=await browser.newPage({viewport:{width:1040,height:820}}),errors=[];
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(45000);
  page.on('pageerror',error=>errors.push(String(error)));
  page.on('console',message=>{if(['error','warning'].includes(message.type()))errors.push(message.text());});
  // Desktop icons belong to the Tauri bundle; the dev page has no favicon.
  await page.route('**/favicon.ico',route=>route.fulfill({status:204}));
  await page.addInitScript(({fixture,mode,kind})=>{
   let doc=fixture.details[fixture.selected].properties.canonical;
   const template=doc.content[0];
   const longText=kind==='crlf'?'雨'.repeat(8190)+'\r\n'+'雨'.repeat(1000000-8192):'雨'.repeat(kind==='medium'?400000:1000000);
   doc.content=['million','medium','crlf'].includes(kind)?[{...structuredClone(template),content:[{...template.content[0],text:longText}]}]:Array.from({length:1000},(_,i)=>({...structuredClone(template),id:crypto.randomUUID(),content:[{...template.content[0],text:`段落${i}：雨の駅から、手紙を届ける。`}]}));
   if(kind.startsWith('dialogue'))doc.content=doc.content.map((node,i)=>{
    if(i%2===0&&kind!=='dialogue-only')return node;
    const common=()=>({id:crypto.randomUUID(),schemaVersion:1,metadata:{},extensions:{},renderArtifacts:[]});
    return {...common(),type:'table',extensions:{'komyaku.dialogue':{actorWidth:80}},content:[{...common(),type:'table_row',content:[`役者${i}`,`セリフ${i}：雨の駅へ、手紙を届ける。`].map(text=>({...common(),type:'table_cell',attrs:{header:false,colspan:1,rowspan:1},content:[{...structuredClone(template),id:crypto.randomUUID(),content:[{...template.content[0],text}]}]}))}]};
   });
   window.__qaScene=fixture.selected;
   if(kind.endsWith('group'))fixture.selected=fixture.nodes.find(n=>n.type==='story.block').id;
   window.__qaFixture=fixture;
   const preferences={language:'ja',writingMode:mode,actorBold:false,bodyFont:'serif',bodySize:17,lineHeight:2.1,titleSize:18,leftPanelOpen:true,rightPanelOpen:false};
   window.__TAURI__={core:{convertFileSrc:()=>'',invoke:async(command,args={})=>{
    if(command==='get_preferences')return preferences;
    if(command==='workspace')return structuredClone(fixture);
    if(command==='selected')return structuredClone(fixture.details[args.id]);
    if(command==='chatgpt_status')return {pending:false,accounts:[],error:null};
    if(command==='edit'){
     const action=args.action;
     if(action.kind==='paragraphs')for(const change of action.changes){const p=doc.content.flatMap(node=>node.type==='paragraph'?[node]:node.content[0].content.map(cell=>cell.content[0])).find(p=>p.id===change.paragraph);const text=p.content.map(n=>n.text).join('');p.content=[{...template.content[0],text:text.slice(0,change.start)+change.text+text.slice(change.end)}];}
     if(action.kind==='canonical'){doc=structuredClone(action.document);fixture.details[window.__qaScene].properties.canonical=doc;}
     fixture.revision++;return structuredClone(fixture);
    }
    return null;
   }},window:{getCurrentWindow:()=>({setTitle:async()=>{},onCloseRequested:async()=>{},close:async()=>{}})},event:{listen:async()=>()=>{}}};
  },{fixture,mode,kind});
  await page.goto(process.env.STORY_GRAPH_QA_URL||'http://127.0.0.1:1448/');
  await page.waitForSelector('.manuscript-text');
  assert((await page.title()).includes('KOMYAKU Story Graph'));
  assert.equal(new URL(page.url()).origin,new URL(process.env.STORY_GRAPH_QA_URL||'http://127.0.0.1:1448/').origin);
  assert.equal(await page.locator('vite-error-overlay').count(),0);
  await page.waitForFunction(min=>document.querySelectorAll('.virtual-placeholder').length>min,['million','crlf'].includes(kind)?100:kind==='medium'?30:900);
  let controls=await page.locator('.manuscript-text').count();assert(controls<80,`${mode}: ${controls} controls`);
  const initialSheets=await page.locator('.dialogue-sheet').count();
  if(['million','medium','crlf'].includes(kind)) {
   const baseSize=kind==='medium'?400000:1000000;
   const firstBlock=page.locator('.manuscript-block').first(),first=firstBlock.locator('textarea');
   await first.evaluate(input=>{
    window.__qaPeakInputs=document.querySelectorAll('.manuscript-text').length;
    window.__qaInputObserver=new MutationObserver(()=>{window.__qaPeakInputs=Math.max(window.__qaPeakInputs,document.querySelectorAll('.manuscript-text').length);});
    window.__qaInputObserver.observe(document.getElementById('app'),{childList:true,subtree:true});
    input.focus();input.setSelectionRange(3,3);
   });
   await page.keyboard.type('A');await page.keyboard.insertText('🌕');
   await page.waitForFunction(size=>{const text=window.__qaFixture.details[window.__qaScene].properties.canonical.content[0].content[0].text;return text.length===size+3&&text.startsWith('雨雨雨A🌕雨');},baseSize);
   const firstLength=await first.evaluate(input=>{input.setSelectionRange(input.value.length,input.value.length);return Number(input.dataset.length);});
   await page.keyboard.press(mode==='vertical'?'ArrowDown':'ArrowRight');
   const nextPosition=await page.evaluate(()=>Number(document.activeElement.dataset.start)+document.activeElement.selectionStart);
   assert.equal(nextPosition,firstLength+(kind==='crlf'?2:1));
   assert.equal(await page.evaluate(()=>Number(document.activeElement.dataset.fragment)),1);
   await page.keyboard.type('B');
   await page.waitForFunction(({size,position})=>{const text=window.__qaFixture.details[window.__qaScene].properties.canonical.content[0].content[0].text;return text.length===size+4&&text[position]==='B';},{size:baseSize,position:nextPosition});
   const peakInputs=await page.evaluate(()=>{window.__qaInputObserver.disconnect();return window.__qaPeakInputs;});
   assert(peakInputs<8,`${mode}: normal typing/navigation transiently mounted ${peakInputs} inputs`);
   await firstBlock.scrollIntoViewIfNeeded();await first.waitFor();
   assert((await first.inputValue()).startsWith('雨雨雨A🌕雨'));
   assert.equal(Number(await first.getAttribute('data-length')),firstLength);
   await page.evaluate(()=>{window.__qaPeakInputs=document.querySelectorAll('.manuscript-text').length;window.__qaInputObserver.observe(document.getElementById('app'),{childList:true,subtree:true});});
   await first.focus();await page.keyboard.press('Meta+a');
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const selectionControls=await page.locator('.manuscript-text').count();
   assert(selectionControls<8,`${mode}: select-all mounted ${selectionControls} inputs`);
   const allCopied=await page.evaluate(()=>{const data=new DataTransfer();document.activeElement.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain').length;});
   assert.equal(allCopied,baseSize+4);
   await firstBlock.scrollIntoViewIfNeeded();
   await page.waitForFunction(()=>document.querySelector('.manuscript-block textarea.paragraph-selected'));
   assert((await page.locator('.manuscript-text').count())<8,`${mode}: scrolling selection kept offscreen inputs`);
   const peakSelectionInputs=await page.evaluate(()=>{window.__qaInputObserver.disconnect();return window.__qaPeakInputs;});
   assert(peakSelectionInputs<8,`${mode}: selection transiently mounted ${peakSelectionInputs} inputs`);
   await page.keyboard.press(mode==='vertical'?'ArrowUp':'ArrowLeft');
   await firstBlock.scrollIntoViewIfNeeded();await first.waitFor();
   const anchor=await first.evaluate(input=>{input.focus();const anchor=input.value.length-2;input.setSelectionRange(anchor,anchor);return anchor;});
   const second=page.locator('.manuscript-block').nth(1);await second.scrollIntoViewIfNeeded();
   await second.locator('textarea').waitFor();
   await second.evaluate((block,mode)=>{const root=document.querySelector(mode==='vertical'?'.manuscript-pages':'.editor-content');const bounds=block.getBoundingClientRect(),viewport=root.getBoundingClientRect();if(mode==='vertical')root.scrollLeft+=bounds.right-viewport.right;else root.scrollTop+=bounds.top-viewport.top;},mode);
   const box=await second.locator('textarea').boundingBox();
   await page.mouse.move(mode==='vertical'?box.x+box.width-3:box.x+3,box.y+3);
   await page.keyboard.down('Shift');await page.mouse.click(mode==='vertical'?box.x+box.width-3:box.x+3,box.y+3);await page.keyboard.up('Shift');
   await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
   const copied=await page.evaluate(()=>{const data=new DataTransfer();document.activeElement.dispatchEvent(new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data}));return data.getData('text/plain');});
   if(!copied.length){await page.screenshot({path:path.join(output,'komyaku-selection-failure.png')});console.log(await page.evaluate(()=>({active:document.activeElement.outerHTML.slice(0,400),start:document.activeElement.selectionStart,end:document.activeElement.selectionEnd})));}
   assert(copied.length>=2&&copied.length<20,`${mode}: copied ${copied.length}`);
   await page.keyboard.press('Backspace');
   await page.waitForFunction(length=>window.__qaFixture.details[window.__qaScene].properties.canonical.content[0].content[0].text.length===length,baseSize+4-copied.length);
   assert.equal(await page.evaluate(()=>window.__qaFixture.details[window.__qaScene].properties.canonical.content.length),1);
   await page.waitForFunction(()=>document.querySelectorAll('.manuscript-text').length<80);
   console.log(JSON.stringify({mode,kind,initialControls:controls,peakTypingInputs:peakInputs,selectionControls,peakSelectionInputs,allCopied,shiftedOffsets:true,selected:copied.length,canonicalParagraphs:1,consoleErrors:errors}));
   assert.deepEqual(errors,[]);await page.close();continue;
  }
  const first=page.locator('.manuscript-text').first();await first.fill('編集済み：本文と🌕');
  await page.waitForFunction(()=>{const node=window.__qaFixture.details[window.__qaScene].properties.canonical.content[0];return (node.type==='paragraph'?node:node.content[0].content[1].content[0]).content[0].text==='編集済み：本文と🌕';});
  await page.locator('.editor-toolbar').click();
  const viewport=kind.endsWith('group')?'.group-manuscript':mode==='vertical'?'.manuscript-pages':'.editor-content';
  if(kind.startsWith('dialogue')){
   const sheetId=await page.locator('.dialogue-sheet').first().getAttribute('data-sheet');
   let sheet=page.locator(`[data-sheet="${sheetId}"]`);
   await sheet.locator('.dialogue-actor').fill('編集役者🌕');
   await sheet.locator('.manuscript-text').fill('編集セリフ🌕\n次の行');
   await page.locator('.editor-toolbar').click();
   await page.waitForFunction(id=>{const sheet=window.__qaFixture.details[window.__qaScene].properties.canonical.content.find(node=>node.id===id);return sheet.content[0].content[0].content[0].content[0].text==='編集役者🌕'&&sheet.content[0].content[1].content[0].content[0].text==='編集セリフ🌕\n次の行';},sheetId);
   const handle=sheet.locator('[data-divider]');await handle.focus();await handle.press(mode==='vertical'?'ArrowDown':'ArrowRight');
   await page.waitForFunction(id=>window.__qaFixture.details[window.__qaScene].properties.canonical.content.find(node=>node.id===id).extensions['komyaku.dialogue'].actorWidth===82,sheetId);
   // Synthetic composition proves lifecycle pinning, not an OS IME session.
   await sheet.locator('.manuscript-text').focus();
   await sheet.locator('.manuscript-text').evaluate(input=>{window.__qaCompositionInput=input;input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
   await page.locator('.editor-toolbar').click();
   await page.locator(viewport).evaluate((el,mode)=>{if(mode==='vertical')el.scrollLeft=-el.scrollWidth;else el.scrollTop=el.scrollHeight;},mode);
   await page.waitForFunction(()=>[...document.querySelectorAll('.manuscript-text')].some(input=>input.value.startsWith('セリフ999')));
   assert(await sheet.count()===1,'composition sheet must stay mounted after focus moves');
   await page.evaluate(()=>window.__qaCompositionInput.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
   await page.waitForFunction(id=>!document.querySelector(`[data-sheet="${id}"]`),sheetId);
   assert((await page.locator('.dialogue-sheet').count())<80);
   await page.locator(viewport).evaluate((el,mode)=>{if(mode==='vertical')el.scrollLeft=0;else el.scrollTop=0;},mode);
   sheet=page.locator(`[data-sheet="${sheetId}"]`);await sheet.waitFor();
   assert.equal(await sheet.locator('.dialogue-actor').inputValue(),'編集役者🌕');
   assert.equal(await sheet.locator('.manuscript-text').inputValue(),'編集セリフ🌕\n次の行');
   assert.equal(await sheet.getAttribute('data-width'),'82');
   // Pointer capture must survive the dragged sheet leaving the viewport.
   const divider=sheet.locator('[data-divider]');await divider.scrollIntoViewIfNeeded();
   const bounds=await divider.boundingBox(),x=bounds.x+bounds.width/2,y=bounds.y+bounds.height/2;
   await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+(mode==='horizontal'?3:0),y+(mode==='vertical'?3:0));
   const draggedWidth=Number(await sheet.getAttribute('data-width'));
   assert.equal(draggedWidth,85,'dragging 3px must not jump at the initial grab position');
   await page.locator(viewport).evaluate((el,mode)=>{if(mode==='vertical')el.scrollLeft=-el.scrollWidth;else el.scrollTop=el.scrollHeight;},mode);
   await page.waitForFunction(()=>[...document.querySelectorAll('.manuscript-text')].some(input=>input.value.startsWith('セリフ999')));
   assert(await sheet.count()===1,'dragged sheet must stay mounted');
   await page.mouse.up();
   await page.waitForFunction(({id,width})=>window.__qaFixture.details[window.__qaScene].properties.canonical.content.find(node=>node.id===id).extensions['komyaku.dialogue'].actorWidth===width,{id:sheetId,width:draggedWidth});
   await page.locator('.editor-toolbar').click();
   await page.waitForFunction(id=>!document.querySelector(`[data-sheet="${id}"]`),sheetId);
   await page.locator(viewport).evaluate((el,mode)=>{if(mode==='vertical')el.scrollLeft=0;else el.scrollTop=0;},mode);
   await sheet.waitFor();assert.equal(Number(await sheet.getAttribute('data-width')),draggedWidth);
   await page.setViewportSize({width:820,height:650});
   await page.screenshot({path:path.join(output,`komyaku-viewport-${kind}-${mode}.png`)});
   await page.locator('[data-action="dialogue"]').click();
   await page.waitForFunction(()=>document.activeElement.classList.contains('dialogue-actor'));
   assert.equal(await page.evaluate(()=>window.__qaFixture.details[window.__qaScene].properties.canonical.content.length),1002);
   assert.deepEqual(errors,[]);console.log(JSON.stringify({mode,kind,totalBlocks:1000,totalSheets:kind==='dialogue-only'?1000:500,initialControls:controls,initialSheets,restoredCells:true,restoredWidth:draggedWidth,compositionPinned:true,dragPinned:true,newSheetFocused:true,consoleErrors:errors}));
   await page.close();continue;
  }
  await page.locator(viewport).evaluate((el,mode)=>{if(mode==='vertical')el.scrollLeft=-el.scrollWidth;else el.scrollTop=el.scrollHeight;},mode);
  await page.waitForFunction(()=>[...document.querySelectorAll('.manuscript-text')].some(input=>input.value.startsWith('段落999')));
  assert((await page.locator('.manuscript-text').count())<80);
  await page.locator(viewport).evaluate((el,mode)=>{if(mode==='vertical')el.scrollLeft=0;else el.scrollTop=0;},mode);
  await page.waitForFunction(()=>[...document.querySelectorAll('.manuscript-text')].some(input=>input.value==='編集済み：本文と🌕'));
  await page.setViewportSize({width:820,height:650});
  await page.screenshot({path:path.join(output,`komyaku-viewport-${kind}-${mode}.png`)});
  assert.deepEqual(errors,[]);console.log(JSON.stringify({mode,kind,total:1000,initialControls:controls,restoredEdit:true,consoleErrors:errors}));
  await page.close();
 }
}finally{await browser.close();}
