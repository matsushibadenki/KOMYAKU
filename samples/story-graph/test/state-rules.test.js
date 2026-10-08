import {test,expect} from 'bun:test';
import {parseStoryWorkspace,evaluateStoryPath,readStoryState} from '../../../packages/story-graph/src/index.js';
import fixture from './fixtures/state-v1.json';
test('generic Rust state agrees with shared engine, including explicit null and alternative paths',()=>{
 const {graph}=parseStoryWorkspace(fixture.workspace);
 for(const path of fixture.report.paths){const actual=evaluateStoryPath(graph,path.path);expect(actual.issues.length).toBe(path.state.issues.length);for(const [entity,state]of Object.entries(path.state.finalState))expect(actual.finalState[entity]).toEqual(state);}
 for(const assertion of fixture.report.declarations.assertions)expect(readStoryState(graph,{pathId:assertion.path,nodeId:assertion.scene,entityId:assertion.entity,key:assertion.key,phase:assertion.phase})).toEqual(assertion.value);
});
