import {test,expect} from 'bun:test';
import {valueType,parseStateValue,defaultStateValue} from '../src/state-values.js';
test('typed state values retain plain text, explicit null, finite numbers and structured JSON',()=>{
 for(const value of ['東京「鍵」',3,false,null,['鍵'],{owner:'灯'}]){const type=valueType(value);const input=type==='text'?value:JSON.stringify(value);expect(parseStateValue(type,input)).toEqual(value);}
 for(const input of ['', 'Infinity','NaN'])expect(()=>parseStateValue('number',input)).toThrow();
 expect(()=>parseStateValue('boolean','yes')).toThrow();
 expect(defaultStateValue('json')).toEqual([]);
});
