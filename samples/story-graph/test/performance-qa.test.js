import {test,expect} from 'bun:test';
import {frameSummary} from '../src/performance-qa.js';
test('local frame summaries count stalls and use sorted percentiles without changing samples',()=>{
 const samples=[100,16,17,NaN,-1,16,60,18,16,Infinity];
 expect(frameSummary(samples)).toEqual({samples:7,p50:17,p95:100,max:100,over50:2});
 expect(samples[0]).toBe(100);expect(frameSummary([])).toBeNull();
});
