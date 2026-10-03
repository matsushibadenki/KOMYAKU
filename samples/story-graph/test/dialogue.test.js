import {test,expect} from 'bun:test';
import {insertDialogue,updateParagraph,paragraphText,setDialogueWidth} from '../src/dialogue.js';
import {canonicalText} from '../src/adapter.js';
import preview from '../src/preview.json';
test('dialogue insertion splits at caret, preserves canonical IDs and edits both cells',()=>{
  const original=structuredClone(Object.values(preview.details).find(n=>n.type_id==='story.scene').properties.canonical);
  const text=paragraphText(original.content[0]);
  const {document,focus}=insertDialogue(original,{id:original.content[0].id,start:3,end:3});
  expect(document.id).toBe(original.id);expect(document.content[0].id).toBe(original.content[0].id);
  expect(document.content.map(n=>n.type)).toEqual(['paragraph','table','paragraph']);
  const sheet=document.content[1];expect(sheet.content).toHaveLength(1);expect(sheet.content[0].content).toHaveLength(2);
  expect(paragraphText(document.content[0])+paragraphText(document.content[2])).toBe(text);
  const actor=updateParagraph(document,focus,'灯');
  const edited=updateParagraph(actor,sheet.content[0].content[1].content[0].id,'また会おう。');
  expect(canonicalText(edited)).toContain('灯\tまた会おう。');expect(original.content).toHaveLength(1);
});

test('manual dialogue width survives cell edits and resets without changing content',()=>{
  const original=Object.values(preview.details).find(n=>n.type_id==='story.scene').properties.canonical;
  const {document,focus}=insertDialogue(original);
  const table=document.content[1];
  const resized=setDialogueWidth(document,table.id,123);
  const edited=updateParagraph(resized,focus,'長い名前');
  expect(edited.content[1].extensions['komyaku.dialogue'].actorWidth).toBe(123);
  expect(canonicalText(setDialogueWidth(edited,table.id,null))).toBe(canonicalText(edited));
  expect(setDialogueWidth(edited,table.id,null).content[1].extensions['komyaku.dialogue']).toBeUndefined();
  expect(()=>setDialogueWidth(edited,table.id,NaN)).toThrow();
});
