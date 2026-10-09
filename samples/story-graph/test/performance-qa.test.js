import {test,expect} from 'bun:test';
import {frameSummary,eventLatencyProbe} from '../src/performance-qa.js';
test('local frame summaries count stalls and use sorted percentiles without changing samples',()=>{
 const samples=[100,16,17,NaN,-1,16,60,18,16,Infinity];
 expect(frameSummary(samples)).toEqual({samples:7,p50:17,p95:100,max:100,over50:2});
 expect(samples[0]).toBe(100);expect(frameSummary([])).toBeNull();
});

test('first-frame latency retains paste stalls when scroll replaces the frame window',()=>{
 let time=100;const queue=[],reports=[];
 const probe=eventLatencyProbe({now:()=>time,schedule:callback=>queue.push(callback),report:value=>reports.push(value)});
 probe('paste');time=600;probe('scroll');probe('paste');probe('private manuscript');
 expect(queue.length).toBe(2);time=620;queue.splice(0).forEach(callback=>callback(100));
 expect(reports).toEqual([{kind:'paste',milliseconds:520},{kind:'scroll',milliseconds:20}]);
 time=700;probe('paste');time=720;queue.shift()(620);expect(reports.at(-1)).toEqual({kind:'paste',milliseconds:20});
});
