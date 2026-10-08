import {test,expect} from 'bun:test';
import {hitTextPosition} from '../src/text-hit.js';
test('native textarea fallback follows both row and column wrapping with logarithmic measurement',()=>{
 const text='あ'.repeat(1000000),columns=40;
 for(const vertical of [false,true]){
  let calls=0;const rectAt=(i,end)=>{calls++;const line=Math.floor(i/columns),column=i%columns;return vertical?{left:100-line*20,right:120-line*20,top:column*18,bottom:(column+1)*18}:{left:column*18,right:(column+1)*18,top:line*20,bottom:line*20+18};};
  const point=vertical?[-130,96]:[96,240];
  expect(hitTextPosition(text,...point,vertical,rectAt)).toBe(485);
  expect(calls).toBeLessThan(22);
 }
});
test('fallback caret never bisects emoji or combining clusters',()=>{
 const text='👨🏽‍💻か\u3099あ',starts=[0,7,9],ends=[7,9,10];
 const rectAt=(i,end)=>{const column=starts.indexOf(i);expect(end).toBe(ends[column]);return {left:column*18,right:(column+1)*18,top:0,bottom:18};};
 expect(hitTextPosition(text,15,5,false,rectAt)).toBe(7);
 expect(hitTextPosition(text,24,5,false,rectAt)).toBe(7);
});
