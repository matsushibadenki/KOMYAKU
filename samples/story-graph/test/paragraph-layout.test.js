import {test,expect} from 'bun:test';
import {displayPart} from '../src/paragraph-layout.js';
test('visual fragments retain canonical CRLF separators and UTF-16 offsets',()=>{
 const text='雨😀\r\n駅\n終わり';const parts=[displayPart(text,0,6),displayPart(text,6,8),displayPart(text,8,text.length)];
 expect(parts.map(p=>p.text+p.separator).join('')).toBe(text);expect(parts.map(p=>p.start)).toEqual([0,6,8]);
 expect(displayPart('雨\r\n',0,3)).toEqual({start:0,text:'雨',separator:'\r\n'});
});
