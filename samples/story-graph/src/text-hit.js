import {graphemeCuts} from './text-performance.js';
// Range rectangles follow source order: rows left-to-right or columns top-to-bottom.
// A logarithmic fallback for WebKit native textarea hit testing.
export function hitTextPosition(text,x,y,vertical,rectAt){
 if(!text.length)return 0;
 const boundary=graphemeCuts(text);let lo=0,hi=text.length-1,best=0,distance=Infinity;
 while(lo<=hi){const mid=Math.floor((lo+hi)/2);const end=boundary(mid+1,mid),cut=boundary(mid);
  // boundary(mid) can round upward only for the first grapheme. Use its start.
  const start=cut>mid?0:cut,r=rectAt(start,end);
  const dx=Math.max(r.left-x,0,x-r.right),dy=Math.max(r.top-y,0,y-r.bottom),d=dx*dx+dy*dy;
  const trailing=vertical?y>(r.top+r.bottom)/2:x>(r.left+r.right)/2;
  if(d<distance){distance=d;best=trailing?end:start;}
  const later=vertical?(x<r.left||(x<=r.right&&y>(r.top+r.bottom)/2)):(y>=r.bottom||(y>=r.top&&x>(r.left+r.right)/2));
  if(later)lo=Math.max(lo+1,end);else hi=start-1;
 }
 return best;
}
