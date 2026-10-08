import {test,expect} from 'bun:test';
import {applyRemoteParagraphs} from '../src/remote-paragraphs.js';
test('remote paragraph revisions replace only affected branches and reject missing or duplicate IDs',()=>{
 const one={type:'paragraph',id:'one',content:[{type:'text',text:'原文\r\n'}]};
 const two={type:'paragraph',id:'two',content:[]};
 const table={type:'table',attrs:{actorWidth:80},content:[{type:'row',content:[two]}]};
 const doc={type:'doc',content:[one,table]};
 const replacement={...two,content:[{type:'text',text:'更新😀'}]};
 const changed=applyRemoteParagraphs(doc,[replacement]);
 expect(changed.content[0]).toBe(one);expect(changed.content[1].attrs).toBe(table.attrs);
 expect(changed.content[1].content[0].content[0]).toBe(replacement);
 expect(doc.content[1].content[0].content[0]).toBe(two);
 expect(applyRemoteParagraphs(doc,[{type:'paragraph',id:'missing'}])).toBeNull();
 expect(applyRemoteParagraphs(doc,[replacement,replacement])).toBeNull();
});
