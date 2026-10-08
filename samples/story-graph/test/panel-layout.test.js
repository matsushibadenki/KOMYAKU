import {test,expect}from 'bun:test';
import {panelWidth}from '../src/panel-layout.js';
test('panel layout clamps widths and rejects unknown targets and non-finite input',()=>{expect(panelWidth('navigator',120)).toBe(180);expect(panelWidth('inspector',800)).toBe(480);expect(panelWidth('navigator',312)).toBe(312);expect(()=>panelWidth('document',200)).toThrow();expect(()=>panelWidth('navigator',NaN)).toThrow();});
test('dock projection allocates each visible panel once and removes hidden tracks',async()=>{
 const {dockGrid}=await import('../src/panel-layout.js');
 const normal=dockGrid({navigator:'left',inspector:'right'});expect(normal.columns).toBe('var(--navigator-width) minmax(0,1fr) var(--inspector-width)');
 const swapped=dockGrid({navigator:'right',inspector:'left'});expect(swapped.columns).toBe('var(--inspector-width) minmax(0,1fr) var(--navigator-width)');
 const vertical=dockGrid({navigator:'top',inspector:'bottom'});expect(vertical.rows).toBe('minmax(120px,25%) minmax(0,1fr) minmax(120px,25%)');
 const hidden=dockGrid({navigator:'top',inspector:'right'},{navigator:false,inspector:false});expect(hidden.columns).toBe('0px minmax(0,1fr) 0px');expect(hidden.areas).not.toContain('navigator');
});

test('editor and history can occupy independent center and side tracks',async()=>{
 const {dockGrid}=await import('../src/panel-layout.js');
 const grid=dockGrid({navigator:'top',inspector:'bottom',editor:'left',history:'center'},{navigator:true,inspector:true,editor:true,history:true});
 expect(grid.areas).toBe('"navigator navigator navigator" "writing history ." "inspector inspector inspector"');
 expect(grid.columns).toBe('var(--editor-width) minmax(0,1fr) 0px');
 expect(panelWidth('editor',2000)).toBe(1200);expect(panelWidth('history',100)).toBe(240);
});

test('hiding the center panel returns available space to the editor without changing saved docks',async()=>{
 const {dockGrid}=await import('../src/panel-layout.js');const docks={navigator:'right',inspector:'top',editor:'bottom',history:'center'};
 const grid=dockGrid(docks,{navigator:true,inspector:false,editor:true,history:false});
 expect(grid.areas).toBe('". . ." ". writing navigator" ". . ."');expect(grid.rows).toBe('0px minmax(0,1fr) 0px');expect(docks.editor).toBe('bottom');
});
