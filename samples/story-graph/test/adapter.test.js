import { describe, test, expect } from 'bun:test';
import { canonicalText, routeNodes, relatedPeople, outlineNodes, outlineDrop, containedScenes } from '../src/adapter.js';
import { messages } from '../src/locales.js';
import '../src/ai-locales.js';
import preview from '../src/preview.json';
describe('KOMYAKU authoring projections',()=>{
  test('every seeded body is canonical and preserves its Unicode text',()=>{
    for(const detail of Object.values(preview.details)) if(detail.type_id==='story.scene') expect(canonicalText(detail.properties.canonical)).toContain('。');
    const doc=structuredClone(Object.values(preview.details).find(n=>n.type_id==='story.scene').properties.canonical);
    const text='か\u3099 / が / 👨‍👩‍👧‍👦\n雨';doc.content[0].content[0].text=text;expect(canonicalText(doc)).toBe(text);
  });
  test('routes choose different development scenes and share the ending',()=>{
    const main=routeNodes(preview.nodes,'main'),alt=routeNodes(preview.nodes,'alternative');expect(main).toHaveLength(4);expect(alt).toHaveLength(4);expect(main[1].id).not.toBe(alt[1].id);expect(main[3].id).toBe(alt[3].id);
  });
  test('relationships resolve two character endpoints',()=>{
    for(const relation of preview.nodes.filter(n=>n.type==='story.relationship')) expect(relatedPeople(preview,relation).map(n=>n.type)).toEqual(['story.character','story.character']);
  });
  test('outline nesting and collapse preserve narrative routes',()=>{
    const outline=outlineNodes(preview.nodes,'main');
    expect(outline.map(n=>n.depth)).toEqual([0,1,2,2,2,2]);
    const block=outline[0],sequence=outline[1];
    expect(sequence.parent).toBe(block.id);
    expect(outlineNodes(preview.nodes,'main',new Set([sequence.id]))).toHaveLength(2);
    expect(outlineNodes(preview.nodes,'main',new Set([block.id]))).toHaveLength(1);
    expect(routeNodes(preview.nodes,'main')).toHaveLength(4);
    const legacy=preview.nodes.filter(n=>n.type==='story.scene').map(n=>({...n,parent:null}));
    expect(outlineNodes(legacy,'main').every(n=>n.depth===0)).toBe(true);
  });
  test('drop rules enforce folder levels and sibling reordering',()=>{
    const nodes=[{id:'b',type:'story.block'},{id:'q',type:'story.sequence',parent:'b'},{id:'s',type:'story.scene',parent:'q'},{id:'t',type:'story.scene',parent:'q'}];
    expect(outlineDrop(nodes,'q','b','after').position).toBe('inside');
    expect(outlineDrop(nodes,'s','q','before').position).toBe('inside');
    expect(outlineDrop(nodes,'s','t','before').position).toBe('before');
    for(const [a,b] of [['b','q'],['b','s'],['q','s'],['s','b'],['s','s']])expect(outlineDrop(nodes,a,b,'inside')).toBeNull();
    expect(outlineDrop(nodes,'s',null,'root')).toBeNull();
    expect(outlineDrop(nodes,'b',null,'root').position).toBe('root');
  });
  test('container writing includes every descendant once in structural order',()=>{
    const nodes=[{id:'b',type:'story.block'},{id:'q2',type:'story.sequence',parent:'b',outlineOrder:2},{id:'q1',type:'story.sequence',parent:'b',outlineOrder:1},
      {id:'s2',type:'story.scene',parent:'q1',outlineOrder:2,order:1,path:'alternative'},
      {id:'s1',type:'story.scene',parent:'q1',outlineOrder:1,order:9,path:'both'},
      {id:'s3',type:'story.scene',parent:'q2',outlineOrder:0,path:'main'},
      {id:'other',type:'story.scene',parent:null,path:'main'}];
    expect(containedScenes(nodes,'b').map(node=>node.id)).toEqual(['s1','s2','s3']);
    expect(containedScenes(nodes,'q1').map(node=>node.id)).toEqual(['s1','s2']);
    expect(containedScenes(nodes,'q2').map(node=>node.id)).toEqual(['s3']);
    expect(containedScenes(nodes,'empty')).toEqual([]);
  });
  test('UI translation keys match across all three languages',()=>{
    const keys=Object.keys(messages.ja).sort();expect(Object.keys(messages.en).sort()).toEqual(keys);expect(Object.keys(messages['zh-CN']).sort()).toEqual(keys);
  });
});
