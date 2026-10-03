import {test,expect} from 'bun:test';
import preview from '../src/preview.json';
import {documentCharacters,updateParagraph,paragraphText} from '../src/dialogue.js';
import {fragments,textDifference,characters,graphemeStep,inputPatch,canonicalPosition} from '../src/text-performance.js';
const seed=Object.values(preview.details).find(n=>n.type_id==='story.scene').properties.canonical;
test('textarea edits preserve canonical CRLF and absolute UTF-16 offsets',()=>{
  for(const [raw,after,wanted] of [['雨\r\n😀日','雨\n😀月','雨\r\n😀月'],['雨\r\n日','雨日','雨日'],['雨\r日','雨\n月','雨\r月'],['雨\r\n日','雨\n🌕日','雨\r\n🌕日']]){
    const prefix='前😀',patch=inputPatch(raw,after,prefix.length),text=prefix+raw;
    expect(text.slice(0,patch.start)+patch.text+text.slice(patch.end)).toBe(prefix+wanted);
  }
  expect(canonicalPosition('雨\r\n😀日',4)).toBe(5);
});
test('boundary deletions remove a full grapheme without inventing paragraph breaks',()=>{
  for(const separator of ['','\n','\r\n']){
    const text='雨'.repeat(8191)+'👨‍👩‍👧‍👦'+separator+'続き',parts=fragments(text),pos=parts[1].start;
    const from=graphemeStep(text,pos,-1),after=text.slice(0,from)+text.slice(pos);
    expect(fragments(after).map(part=>part.text+part.separator).join('')).toBe(after);
    expect(after.includes('👨‍👩‍👧‍👦')).toBe(true);
    const emojiEnd=8191+'👨‍👩‍👧‍👦'.length,emojiStart=graphemeStep(text,emojiEnd,-1);
    expect(text.slice(0,emojiStart)+text.slice(emojiEnd)).toBe('雨'.repeat(8191)+separator+'続き');
  }
});
for(const blocks of [100,1000]) test(`${blocks*1000}-character document uses copy-on-write edits and an incremental count`,()=>{
  const doc={...seed,content:Array.from({length:blocks},()=>({...seed.content[0],id:crypto.randomUUID(),content:[{type:'text',text:'雨'.repeat(1000),marks:[],metadata:{},extensions:{}}]}))};
  expect(documentCharacters(doc)).toBe(blocks*1000+blocks-1);
  const before=performance.now();let edited=doc;
  for(let i=0;i<100;i++)edited=updateParagraph(edited,doc.content[50].id,`${'雨'.repeat(1000)}${'字'.repeat(i+1)}`,1);
  console.log(`${blocks*1000}-character JS: 100 updates ${(performance.now()-before).toFixed(2)}ms`);
  expect(documentCharacters(edited)).toBe(blocks*1000+blocks-1+100);expect(edited.content[0]).toBe(doc.content[0]);expect(edited.content[51]).toBe(doc.content[51]);
  expect(paragraphText(doc.content[50])).toHaveLength(1000);
});
test('unbroken million-character paragraph is bounded without adding newlines',()=>{
  const text='雨'.repeat(1000000),before=performance.now(),parts=fragments(text);
  console.log(`unbroken million-character fragmentation: ${(performance.now()-before).toFixed(2)}ms`);
  expect(parts).toHaveLength(123);expect(parts.every(part=>part.text.length<=8192)).toBe(true);
  expect(parts.map(part=>part.text+part.separator).join('')).toBe(text);
  let offset=0;for(const part of parts){expect(part.start).toBe(offset);offset+=part.text.length+part.separator.length;}
});
test('fragment boundaries and deletion steps preserve complete graphemes',()=>{
  const clusters=['👨‍👩‍👧‍👦','か\u3099','🇯🇵','👍🏽','✈️'];
  for(const cluster of clusters){
    const text=('雨'+cluster).repeat(100),parts=fragments(text,32),boundaries=new Set([...new Intl.Segmenter(undefined,{granularity:'grapheme'}).segment(text)].map(part=>part.index));boundaries.add(text.length);
    expect(parts.map(part=>part.text+part.separator).join('')).toBe(text);
    for(const part of parts){expect(boundaries.has(part.start)).toBe(true);expect(boundaries.has(part.start+part.text.length)).toBe(true);}
    expect(graphemeStep(cluster,0,1)).toBe(cluster.length);expect(graphemeStep(cluster,cluster.length,-1)).toBe(0);
  }
  const text=('雨'.repeat(50)+'\r\n').repeat(10),parts=fragments(text,64);
  expect(parts.map(part=>part.text+part.separator).join('')).toBe(text);
  expect(graphemeStep('\r\n',2,-1)).toBe(0);
});
test('display fragments preserve canonical newlines and UTF-16 edit ranges preserve emoji',()=>{
  const text=('雨'.repeat(99)+'\n').repeat(10000);
  const parts=fragments(text);expect(parts.length).toBeGreaterThan(100);expect(parts.map(n=>n.text).join('\n')).toBe(text);
  expect(parts.every(n=>n.text.length<=8192)).toBe(true);
  for(const [before,after] of [['a😀z','a😃z'],['雨\n日','雨\n🌕日'],['か\u3099','が']]) {
    const patch=textDifference(before,after);expect(before.slice(0,patch.start)+patch.text+before.slice(patch.end)).toBe(after);
    expect(characters(after)-characters(before)).toBe(characters(patch.text)-characters(patch.removed));
  }
});
