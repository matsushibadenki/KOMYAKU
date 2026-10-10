import {fragments,inputPatch} from '../src/text-performance.js';
import {frameSummary} from '../src/performance-qa.js';
import {createHash} from 'node:crypto';
const rows=[];
for(const size of [100000,1000000,5000000])for(const layout of ['newlines','unbroken']){
 const unit='雨の日。か\u3099👨‍👩‍👧‍👦🇯🇵'+(layout==='newlines'?'\r\n':'');
 const text=unit.repeat(Math.ceil(size/unit.length));
 const expected=createHash('sha256').update(text).digest('hex');
 const timings=[];let count=0;
 for(let run=0;run<12;run++){
  const begin=performance.now(),parts=fragments(text);const elapsed=performance.now()-begin;
  if(run>=2)timings.push(elapsed);
  const restored=parts.map(part=>part.text+part.separator).join('');
  if(createHash('sha256').update(restored).digest('hex')!==expected)throw Error('fragment corruption');
  let offset=0;for(const part of parts){if(part.start!==offset)throw Error('offset corruption');offset+=part.text.length+part.separator.length;}
  count=parts.length;
 }
 const patchTimes=[];const raw=fragments(text)[Math.floor(count/2)].text;
 const normalized=raw.replace(/\r\n?/g,'\n');
 for(let run=0;run<100;run++){
  const after=normalized+'🌕',begin=performance.now(),patch=inputPatch(raw,after);patchTimes.push(performance.now()-begin);
  if(raw.slice(0,patch.start)+patch.text+raw.slice(patch.end)!==raw+'🌕')throw Error('edit corruption');
 }
 rows.push({layout,utf16:text.length,fragments:count,fragmentMs:frameSummary(timings),localEditMs:frameSummary(patchTimes),sha256:expected,exact:true});
}
console.log(JSON.stringify({runtime:process.version,scope:'CPU text preparation; excludes WebView layout, GPU presentation and disk',warmup:2,runs:10,rows},null,2));
