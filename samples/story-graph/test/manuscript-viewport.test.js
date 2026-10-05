import {test,expect} from 'bun:test';
import {estimatedExtent,estimatedDialogueExtent} from '../src/manuscript-viewport.js';

test('viewport estimates account for empty lines, CRLF and Unicode in both writing directions',()=>{
  const options={span:100,fontSize:20,lineHeight:1.5};
  expect(estimatedExtent('雨'.repeat(11),{...options,vertical:false})).toBe(92);
  expect(estimatedExtent('雨'.repeat(11),{...options,vertical:true})).toBe(90);
  expect(estimatedExtent('🌕🌕🌕🌕🌕\r\n\r\n雨',{...options,vertical:false})).toBe(92);
  expect(estimatedExtent('',{...options,vertical:true})).toBe(30);
  expect(estimatedExtent('雨雨',{...options,span:0,vertical:true})).toBe(60);
});
test('dialogue estimates include both cells, manual actor width and multiline names',()=>{
  const options={span:200,fontSize:20,lineHeight:1.5,actorWidth:80};
  expect(estimatedDialogueExtent(['役者','雨'.repeat(11)],{...options,vertical:false})).toBe(92);
  expect(estimatedDialogueExtent(['役者','雨'.repeat(11)],{...options,vertical:true})).toBe(90);
  expect(estimatedDialogueExtent(['役者\n\n役者',''],{...options,vertical:false})).toBe(92);
  expect(estimatedDialogueExtent(['',''],{...options,vertical:true})).toBe(30);
  expect(estimatedDialogueExtent(['役者','雨'.repeat(11)],{...options,vertical:true,actorWidth:120})).toBeGreaterThan(90);
});
