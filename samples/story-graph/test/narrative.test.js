import {test,expect} from 'bun:test';
import {parseStoryWorkspace,evaluateStoryPath,characterKnowsFact} from '../../../packages/story-graph/src/index.js';
import fixture from './fixtures/narrative-v1.json';
test('Rust knowledge evaluation agrees with shared story engine across alternate paths',()=>{
 const {graph}=parseStoryWorkspace(fixture.workspace);
 const {events,tests}=fixture.report.declarations;
 for(const expected of fixture.report.paths){
  const actual=evaluateStoryPath(graph,expected.path);
  expect(actual.issues.length).toBe(expected.issues.filter(issue=>issue.code==='knowledge_missing').length);
  for(const [character,knowledge] of Object.entries(expected.finalKnowledge))expect(actual.finalState[character].knowledge).toEqual(knowledge);
 }
 for(const assertion of tests)expect(characterKnowsFact(graph,{pathId:assertion.path,nodeId:assertion.scene,characterId:assertion.character,factId:assertion.fact,phase:assertion.phase})).toBe(assertion.expected);
 const first=events.find(e=>e.operation==='learn');
 for(const path of graph.paths.filter(p=>p.nodeIds.includes(first.scene))) {
  expect(characterKnowsFact(graph,{pathId:path.id,nodeId:first.scene,characterId:first.character,factId:first.fact,phase:'before'})).toBe(false);
  expect(characterKnowsFact(graph,{pathId:path.id,nodeId:first.scene,characterId:first.character,factId:first.fact,phase:'after'})).toBe(true);
 }
});
