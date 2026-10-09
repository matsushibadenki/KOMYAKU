import {test,expect} from 'bun:test';
import {parseStoryGraph} from '../src/schema.js';
import corpus from './fixtures/native-conformance.json';
// Normalized lowercase UUID inputs. External normalization and native-only
// resource ceilings are separate contracts, not implied by this corpus.
for (const {name,valid,graph,canonicalNodeIds} of corpus) {
  test(`shared/native normalized Graph: ${name}`,()=>{
    let accepted=true;
    try {parseStoryGraph(graph,{canonicalNodeIds:new Set(canonicalNodeIds)});} catch {accepted=false;}
    expect(accepted).toBe(valid);
  });
}
