export function needsRichEditor(doc){return doc.content.some(node=>{
 if(node.type==='paragraph')return node.content.some(n=>n.type!=='text'||n.marks?.length);
 if(node.type!=='table'||node.content.length!==1||node.content[0].content.length!==2)return true;
 return node.content[0].content.some(cell=>cell.content.length!==1||cell.content[0].type!=='paragraph'||cell.content[0].content.some(n=>n.type!=='text'||n.marks?.length));
});}
export function richText(node){
 if(node.type==='text')return node.text;
 if(node.type==='hard_break')return '\n';
 if(node.type==='code_block')return node.source;
 if(node.type==='image')return node.altText+node.caption.map(richText).join('');
 const separator=['paragraph','heading'].includes(node.type)?'':node.type==='table_row'?'\t':'\n';
 return (node.content??[]).map(richText).join(separator);
}
export function richInlineHtml(content,escape,start=0,end=Infinity){
 let offset=0;return content.map(inline=>{
  const text=richText(inline),from=Math.max(0,start-offset),to=Math.min(text.length,end-offset);offset+=text.length;
  if(to<=from)return '';let html=escape(text.slice(from,to));
  for(const mark of inline.marks??[]){const tag={bold:'strong',italic:'em',underline:'u',strike:'s',code:'code'}[mark.type];if(tag)html=`<${tag}>${html}</${tag}>`;else if(mark.type==='link'&&/^(https?:|mailto:)/i.test(mark.href))html=`<a href="${escape(mark.href)}" rel="noopener noreferrer">${html}</a>`;}
  return html;
 }).join('');
}

// Changing a heading must retain the authored block identity and metadata.
export function changeBlockType(type,attrs={}){return (state,dispatch)=>{
 const targets=[];for(const range of state.selection.ranges)state.doc.nodesBetween(range.$from.pos,range.$to.pos,(node,pos)=>{if(!node.isTextblock)return;const resolved=state.doc.resolve(pos);if(resolved.parent.canReplaceWith(resolved.index(),resolved.index()+1,type))targets.push({node,pos});});
 if(!targets.length)return false;if(dispatch){const tr=state.tr;for(const {node,pos} of targets)tr.setNodeMarkup(pos,type,{...node.attrs,...attrs},node.marks);dispatch(tr);}return true;
};}
