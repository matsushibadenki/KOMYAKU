import { test, expect } from 'bun:test';
import { createHash } from 'node:crypto';
import { evaluateStoryPath, readStoryState, compareStoryPathMerge, traceStoryImpact,
  parseStoryQueryRequest, parseStoryQueryResult, STORY_QUERY_EVALUATOR_VERSION } from '../src/index.js';
import base from './fixtures/query-workspace.json';
import cases from './fixtures/query-conformance.json';
const id = n => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const request = query => ({ workspaceId: base.graph.id, versionId: id(200), query });
function issues(graph, pathId) {
  return evaluateStoryPath(graph, pathId).issues;
}
// Corpus changes use JSON pointers relative to the shared immutable fixture.
function fixture(entry) {
  const workspace = structuredClone(base);
  for (const change of entry.changes ?? []) {
    const keys = change.pointer.slice(1).split('/').map(k => k.replaceAll('~1', '/').replaceAll('~0', '~'));
    const parent = keys.slice(0, -1).reduce((v, key) => v[key], workspace);
    if (change.remove) delete parent[keys.at(-1)];
    else parent[keys.at(-1)] = structuredClone(change.value);
  }
  return workspace;
}
function reference(graph, query) {
  switch (query.type) {
    case 'state-at': {
      const value = readStoryState(graph, query);
      const entity = graph.entities.find(e => e.id === query.entityId);
      const path = graph.paths.find(p => p.id === query.pathId);
      const initial = entity.initialState ?? {};
      const effects = path.nodeIds.slice(0, path.nodeIds.indexOf(query.nodeId) + (query.phase === 'after' ? 1 : 0))
        .flatMap(nodeId => graph.nodes.find(n => n.id === nodeId).effects.flatMap((effect, effectIndex) =>
          effect.entityId === query.entityId && effect.key === query.key ? [{ nodeId, effectIndex }] : []));
      return { exists: value !== undefined, ...(value !== undefined ? { value } : {}), evidence: {
        initial: { exists: Object.hasOwn(initial, query.key), ...(Object.hasOwn(initial, query.key) ? { value: initial[query.key] } : {}) }, effects
      } };
    }
    case 'consistency': {
      const results = query.pathIds.flatMap(pathId => issues(graph, pathId));
      return { consistent: results.length === 0, issues: results };
    }
    case 'compare-paths': {
      const { oursPathId, theirsPathId, ...result } = compareStoryPathMerge(graph, query.oursPathId, query.theirsPathId);
      return { ...result, issues: [...issues(graph, oursPathId), ...issues(graph, theirsPathId)] };
    }
    case 'impact': return { impacts: traceStoryImpact(graph, query).impacts };
  }
}
for (const entry of cases) {
  test(`native/query shared evaluation: ${entry.name}`, () => {
    const workspace = fixture(entry);
    const result = JSON.parse(JSON.stringify(reference(workspace.graph, entry.query)));
    expect(result).toEqual(entry.expected);
    const envelope = { ...request(entry.query), snapshotHash: createHash('sha256').update(JSON.stringify(workspace)).digest('hex'),
      evaluatorVersion: STORY_QUERY_EVALUATOR_VERSION, graphSchemaVersion: 1, result };
    expect(parseStoryQueryResult(envelope, request(entry.query))).toEqual(envelope);
  });
}

test('query requests require immutable identity, bounded targets and exact fields', () => {
  const valid = request(cases[0].query);
  for (const input of [
    { ...valid, versionId: 'latest' }, { ...valid, snapshotJson: '{}' },
    { ...valid, query: { ...valid.query, phase: 'current' } },
    { ...valid, query: { ...valid.query, key: '' } },
    request({ type: 'impact', nodeIds: [id(20), id(20)] }),
    request({ type: 'impact', nodeIds: Array.from({ length: 101 }, (_, n) => id(n + 500)) }),
    request({ type: 'consistency', pathIds: [] }),
    request({ type: 'compare-paths', oursPathId: id(40), theirsPathId: id(40) })
  ]) expect(() => parseStoryQueryRequest(input)).toThrow('invalid_story_query');
  const detached = parseStoryQueryRequest(valid);
  detached.query.key = 'changed';
  expect(valid.query.key).toBe('knowledge');
});

test('results cannot cross versions, queries, evaluator versions or declared scopes', () => {
  const entry = cases.find(c => c.name === 'consistency-all-routes');
  const input = request(entry.query);
  const result = { ...input, snapshotHash: 'a'.repeat(64), evaluatorVersion: STORY_QUERY_EVALUATOR_VERSION,
    graphSchemaVersion: 1, result: entry.expected };
  for (const bad of [
    { ...result, versionId: id(999) }, { ...result, workspaceId: id(999) },
    { ...result, evaluatorVersion: 'story-query/2' }, { ...result, graphSchemaVersion: 2 },
    { ...result, snapshotHash: 'x'.repeat(64) }, { ...result, snapshotJson: '{}' },
    { ...result, query: { type: 'consistency', pathIds: [id(40)] } },
    { ...result, result: { ...result.result, consistent: true } },
    { ...result, result: { ...result.result, issues: [{ ...entry.expected.issues[0], pathId: id(999) }] } }
  ]) expect(() => parseStoryQueryResult(bad, input)).toThrow('invalid_story_query_result');
});

test('missing differs from null, and oversized or incomplete witness graphs are refused', () => {
  const entry = cases[0], input = request(entry.query);
  const response = result => ({ ...input, snapshotHash: 'a'.repeat(64), evaluatorVersion: STORY_QUERY_EVALUATOR_VERSION, graphSchemaVersion: 1, result });
  expect(() => parseStoryQueryResult(response({ ...entry.expected, exists: false }), input)).toThrow();
  expect(() => parseStoryQueryResult(response({ ...entry.expected, value: 'x'.repeat(1024 * 1024) }), input)).toThrow();
  const impact = cases.find(c => c.name === 'impact-forward-and-reverse');
  const impactInput = request(impact.query);
  const bad = { ...response(impact.expected), query: impact.query };
  for (const impacts of [[{ ...impact.expected.impacts[0], viaNodeId: id(999) }],
    [impact.expected.impacts[0], impact.expected.impacts[0]],
    [{ ...impact.expected.impacts[0], reason: 'state-dependency' }]]) {
    expect(() => parseStoryQueryResult({ ...bad, result: { impacts } }, impactInput)).toThrow();
  }
});
