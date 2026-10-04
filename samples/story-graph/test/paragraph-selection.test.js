import {test,expect} from 'bun:test';
import {fragments,inputPatch} from '../src/text-performance.js';
import {selectionRange,extendSelection,fragmentSelection,replaceSelectionFragments,pointSelection} from '../src/paragraph-selection.js';

test('pointer extension retains its anchor across distant fragments and reversals',()=>{
  const text=('雨'.repeat(8190)+'\r\n').repeat(4),parts=fragments(text);
  const forward=pointSelection(text.length,4,24580);
  expect(selectionRange(forward)).toEqual({start:4,end:24580});
  expect(fragmentSelection(parts[1],forward)).toEqual({start:0,end:8190});
  const reversed=pointSelection(text.length,forward.anchor,1);
  expect(selectionRange(reversed)).toEqual({start:1,end:4});
  expect(text.slice(4,24580)).toContain('\r\n');
  expect(pointSelection(text.length,-1,text.length+100)).toEqual({anchor:0,focus:text.length});
});

test('shift selection crosses fragment boundaries and reverses without splitting emoji',()=>{
  const text='雨'.repeat(8191)+'👨‍👩‍👧‍👦'+'次',anchor=8190;
  let range={anchor,focus:anchor};range=extendSelection(text,range,1);expect(range.focus).toBe(8191);
  range=extendSelection(text,range,1);expect(text.slice(selectionRange(range).start,selectionRange(range).end)).toBe('雨👨‍👩‍👧‍👦');
  const parts=fragments(text);expect(fragmentSelection(parts[0],range)).toEqual({start:8190,end:8191});expect(fragmentSelection(parts[1],range)).toEqual({start:0,end:11});
  range=extendSelection(text,range,-1);expect(range.focus).toBe(8191);range=extendSelection(text,range,-1);expect(range.focus).toBe(anchor);
  range=extendSelection(text,range,-1);expect(selectionRange(range)).toEqual({start:8189,end:8190});expect(range.anchor).toBe(anchor);
});
test('cross-fragment replacements retain the native composition input in either direction',()=>{
  const text='abcdefghijklmnop',parts=fragments(text,4);
  for(const [anchor,focus,active] of [[2,14,3],[14,2,0],[2,6,1],[6,2,0],[4,8,1],[8,4,0]]){
    const selection={anchor,focus},range=selectionRange(selection),insert='🌕字',expected=text.slice(0,range.start)+insert+text.slice(range.end);
    const retained=replaceSelectionFragments(parts,active,selection,insert);
    expect(retained.filter(Boolean).map(part=>part.text).join('')).toBe(expected);
    for(const part of retained.filter(Boolean))expect(expected.slice(part.start,part.start+part.text.length)).toBe(part.text);
    const current=retained[active],native=current.text.replace(/\r\n?/g,'\n'),patch=inputPatch(current.text,native+'確定',current.start);
    expect(expected.slice(0,patch.start)+patch.text+expected.slice(patch.end)).toBe(expected.slice(0,current.start+current.text.length)+'確定'+expected.slice(current.start+current.text.length));
  }
});
test('range copy and replacement include omitted CRLF display separators',()=>{
  const text=('雨'.repeat(5)+'\r\n').repeat(4),parts=fragments(text,8),selection={anchor:3,focus:18},range=selectionRange(selection);
  expect(text.slice(range.start,range.end)).toBe('雨雨\r\n雨雨雨雨雨\r\n雨雨雨雨');
  const retained=replaceSelectionFragments(parts,2,selection,'字');
  const expected=text.slice(0,3)+'字'+text.slice(18);
  for(const part of retained.filter(Boolean))expect(expected.slice(part.start,part.start+part.text.length)).toBe(part.text);
  expect(selectionRange({anchor:18,focus:3})).toEqual(range);
});
