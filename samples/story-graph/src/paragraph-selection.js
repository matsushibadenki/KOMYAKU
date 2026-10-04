import {graphemeStep} from './text-performance.js';

export const selectionRange=selection=>({start:Math.min(selection.anchor,selection.focus),end:Math.max(selection.anchor,selection.focus)});
// A mouse extension retains the original anchor even after reversing direction.
export function pointSelection(length,anchor,focus) {
  return {anchor:Math.max(0,Math.min(length,anchor)),focus:Math.max(0,Math.min(length,focus))};
}
export function extendSelection(text,selection,direction) {
  return {...selection,focus:graphemeStep(text,selection.focus,direction)};
}
export function fragmentSelection(part,selection) {
  const {start,end}=selectionRange(selection),limit=part.start+part.text.length;
  return {start:Math.max(part.start,Math.min(start,limit))-part.start,end:Math.max(part.start,Math.min(end,limit))-part.start};
}
// Retain the active native input during composition, trimming only its peers.
// Canonical positions include newlines omitted at display boundaries.
export function replaceSelectionFragments(parts,active,selection,insert) {
  const {start,end}=selectionRange(selection),delta=insert.length-(end-start);
  return parts.map((part,index)=>{
    const limit=part.start+part.text.length;
    if(index===active)return {start:Math.min(part.start,start),text:part.text.slice(0,Math.max(0,start-part.start))+insert+part.text.slice(Math.max(0,end-part.start)),active:true};
    if(limit<=start)return {...part,active:false};
    if(part.start>=end)return {...part,start:part.start+delta,active:false};
    if(part.start<start)return {start:part.start,text:part.text.slice(0,start-part.start),active:false};
    if(limit>end)return {start:start+insert.length,text:part.text.slice(end-part.start),active:false};
    return null;
  });
}
