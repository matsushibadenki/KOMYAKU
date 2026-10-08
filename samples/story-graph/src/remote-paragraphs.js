// Apply only a contiguous Rust-authored revision; gaps must reload the native owner.
export function applyRemoteParagraphs(canonical, replacements) {
  const updates=new Map(replacements.map(paragraph=>[paragraph.id,paragraph]));
  if(updates.size!==replacements.length)return null;
  let matched=0;
  const visit=node=>{
    if(node.type==='paragraph'&&updates.has(node.id)){matched++;return updates.get(node.id);}
    if(!Array.isArray(node.content))return node;
    const content=node.content.map(visit);
    return content.some((child,index)=>child!==node.content[index])?{...node,content}:node;
  };
  const result=visit(canonical);
  return matched===updates.size?result:null;
}
