import {test,expect} from 'bun:test';
import preview from '../src/preview.json';
import {documentCharacters,updateParagraph,paragraphText} from '../src/dialogue.js';
import {fragments,textDifference,characters} from '../src/text-performance.js';
const seed=Object.values(preview.details).find(n=>n.type_id==='story.scene').properties.canonical;
for(const blocks of [100,1000]) test(`${blocks*1000}-character document uses copy-on-write edits and an incremental count`,()=>{
  const doc={...seed,content:Array.from({length:blocks},()=>({...seed.content[0],id:crypto.randomUUID(),content:[{type:'text',text:'雨'.repeat(1000),marks:[],metadata:{},extensions:{}}]}))};
  expect(documentCharacters(doc)).toBe(blocks*1000+blocks-1);
  const before=performance.now();let edited=doc;
  for(let i=0;i<100;i++)edited=updateParagraph(edited,doc.content[50].id,`${'雨'.repeat(1000)}${'字'.repeat(i+1)}`,1);
  console.log(`${blocks*1000}-character JS: 100 updates ${(performance.now()-before).toFixed(2)}ms`);
  expect(documentCharacters(edited)).toBe(blocks*1000+blocks-1+100);expect(edited.content[0]).toBe(doc.content[0]);expect(edited.content[51]).toBe(doc.content[51]);
  expect(paragraphText(doc.content[50])).toHaveLength(1000);
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
