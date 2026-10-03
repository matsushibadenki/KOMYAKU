// Display fragments never alter canonical paragraph boundaries or IDs.
export function fragments(text,limit=8192) {
  const parts=[];let start=0;
  while(text.length-start>limit) {
    const edge=text.lastIndexOf('\n',start+limit);
    if(edge<start+limit/2)break; // Keep an unbroken long line intact.
    parts.push({start,text:text.slice(start,edge)});start=edge+1;
  }
  parts.push({start,text:text.slice(start)});return parts;
}
export function textDifference(before,after,offset=0) {
  let start=0,end=0;
  while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  if(start>0&&before.charCodeAt(start-1)>=0xd800&&before.charCodeAt(start-1)<=0xdbff)start--;
  while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
  if(end>0&&before.charCodeAt(before.length-end)>=0xdc00&&before.charCodeAt(before.length-end)<=0xdfff)end--;
  return {start:offset+start,end:offset+before.length-end,text:after.slice(start,after.length-end),removed:before.slice(start,before.length-end)};
}
export const characters=text=>{let count=0;for(const _ of text)count++;return count;};
