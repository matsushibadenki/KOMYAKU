// Display fragments never alter canonical paragraph boundaries or IDs.
const graphemes=new Intl.Segmenter(undefined,{granularity:'grapheme'});
export function graphemeStep(text,position,direction) {
  const segments=graphemes.segment(text);
  if(direction<0)return position>0?segments.containing(position-1).index:0;
  if(position>=text.length)return text.length;
  const segment=segments.containing(position);return segment.index+segment.segment.length;
}
export function fragments(text,limit=8192) {
  if(!Number.isInteger(limit)||limit<2)throw new RangeError('fragment limit');
  const parts=[];let start=0;
  const boundaries=graphemes.segment(text);
  while(text.length-start>limit) {
    const edge=text.lastIndexOf('\n',start+limit);
    if(edge>=start+limit/2){
      const end=text[edge-1]==='\r'?edge-1:edge;
      parts.push({start,text:text.slice(start,end),separator:text.slice(end,edge+1)});start=edge+1;
    }else {
      const boundary=boundaries.containing(start+limit);
      const end=boundary.index>start?boundary.index:boundary.index+boundary.segment.length;
      parts.push({start,text:text.slice(start,end),separator:''});start=end;
    }
  }
  parts.push({start,text:text.slice(start),separator:''});return parts;
}
export function textDifference(before,after,offset=0) {
  let start=0,end=0;
  while(start<before.length&&start<after.length&&before[start]===after[start])start++;
  if(start>0&&before.charCodeAt(start-1)>=0xd800&&before.charCodeAt(start-1)<=0xdbff)start--;
  while(end<before.length-start&&end<after.length-start&&before[before.length-1-end]===after[after.length-1-end])end++;
  if(end>0&&before.charCodeAt(before.length-end)>=0xdc00&&before.charCodeAt(before.length-end)<=0xdfff)end--;
  return {start:offset+start,end:offset+before.length-end,text:after.slice(start,after.length-end),removed:before.slice(start,before.length-end)};
}
// WebKit normalizes CRLF/CR inside textarea; canonical offsets remain unchanged.
export function canonicalPosition(raw,target) {
  if(!raw.includes('\r'))return target;
  let normalized=0,index=0;while(normalized<target&&index<raw.length){if(raw[index]==='\r'&&raw[index+1]==='\n')index++;index++;normalized++;}return index;
}
export function inputPatch(raw,after,offset=0) {
  const before=raw.replace(/\r\n?/g,'\n'),change=textDifference(before,after);
  const start=canonicalPosition(raw,change.start),end=canonicalPosition(raw,change.end);
  return {...change,start:offset+start,end:offset+end,removed:raw.slice(start,end)};
}
export const characters=text=>{let count=0;for(const _ of text)count++;return count;};
