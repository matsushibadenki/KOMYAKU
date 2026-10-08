import {richText} from './rich-content.js';
import { parseCanonicalDocument } from '../../../packages/document-schema/src/index.js';
export function canonicalText(input) {
  const document = parseCanonicalDocument(input);
  return document.content.map(richText).join('\n');
}
export function routeNodes(nodes, path) {
  return nodes.filter(n => n.type === 'story.scene' && (n.routes ? Object.hasOwn(n.routes,path) : [path, 'both'].includes(n.path))).sort((a,b)=>(a.routes?.[path]??a.order)-(b.routes?.[path]??b.order));
}
export function relatedPeople(workspace, relationship) {
  return ['from','to'].map(port => {
    const edge = workspace.edges.find(e=>e.to===relationship.id && e.port===port);
    return workspace.nodes.find(n=>n.id===edge?.from);
  });
}
// Structural containment is separate from narrative flow/alternate routes.
export function outlineNodes(nodes, path, collapsed = new Set()) {
  const byOutline=(a,b)=>(a.outlineOrder??a.order??0)-(b.outlineOrder??b.order??0)||a.id.localeCompare(b.id);
  const scenes = routeNodes(nodes, path).sort(byOutline);
  const containers = nodes.filter(n=>['story.block','story.sequence'].includes(n.type)).sort(byOutline);
  const result=[];
  for(const block of containers.filter(n=>n.type==='story.block')) {
    result.push({...block,depth:0,container:true});
    if(collapsed.has(block.id))continue;
    for(const sequence of containers.filter(n=>n.type==='story.sequence'&&n.parent===block.id)) {
      result.push({...sequence,depth:1,container:true});
      if(!collapsed.has(sequence.id))result.push(...scenes.filter(n=>n.parent===sequence.id).map(n=>({...n,depth:2})));
    }
  }
  result.push(...scenes.filter(n=>!n.parent).map(n=>({...n,depth:0})));
  return result;
}

export function outlineDrop(nodes, sourceId, targetId, position) {
  const source=nodes.find(n=>n.id===sourceId),target=nodes.find(n=>n.id===targetId);
  if(!source||sourceId===targetId)return null;
  if(!target)return source.type==='story.block'?{kind:'move_outline',id:sourceId,target:null,position:'root'}:null;
  if((source.type==='story.sequence'&&target.type==='story.block')||(source.type==='story.scene'&&target.type==='story.sequence'))return {kind:'move_outline',id:sourceId,target:targetId,position:'inside'};
  if(source.type===target.type&&['before','after'].includes(position))return {kind:'move_outline',id:sourceId,target:targetId,position};
  return null;
}

// Follow structural order, independently of collapsed rows or narrative routes.
export function containedScenes(nodes, id) {
  const descendants=new Set([id]);
  for(const node of nodes)if(node.type==='story.sequence'&&node.parent===id)descendants.add(node.id);
  const parents=nodes.filter(node=>node.type==='story.sequence').sort((x,y)=>(x.outlineOrder??x.order??0)-(y.outlineOrder??y.order??0)||x.id.localeCompare(y.id));
  return nodes.filter(node=>node.type==='story.scene'&&descendants.has(node.parent)).sort((a,b)=>{
      return parents.findIndex(node=>node.id===a.parent)-parents.findIndex(node=>node.id===b.parent)||(a.outlineOrder??a.order??0)-(b.outlineOrder??b.order??0)||a.id.localeCompare(b.id);
    });
}
