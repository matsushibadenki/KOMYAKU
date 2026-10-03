import { parseStoryGraph, StoryGraphError } from "./schema.js";

function clone(value) { return structuredClone(value); }
function equal(left, right) { return JSON.stringify(left) === JSON.stringify(right); }

function createState(graph) {
  return new Map(graph.entities.map((entity) => [entity.id, clone(entity.initialState)]));
}

function matches(actual, condition) {
  const exists = actual !== undefined;
  switch (condition.operator) {
    case "exists": return exists;
    case "not-exists": return !exists;
    case "equals": return equal(actual, condition.value);
    case "not-equals": return !equal(actual, condition.value);
    case "contains": return Array.isArray(actual) && actual.some((value) => equal(value, condition.value));
    case "not-contains": return !Array.isArray(actual) || !actual.some((value) => equal(value, condition.value));
    default: return false;
  }
}

function applyEffect(record, effect) {
  if (effect.operation === "unset") delete record[effect.key];
  else if (effect.operation === "set") record[effect.key] = clone(effect.value);
  else {
    const values = Array.isArray(record[effect.key]) ? [...record[effect.key]] : [];
    if (effect.operation === "add" && !values.some((value) => equal(value, effect.value))) {
      values.push(clone(effect.value));
    } else if (effect.operation === "remove") {
      record[effect.key] = values.filter((value) => !equal(value, effect.value));
      return;
    }
    record[effect.key] = values;
  }
}

function snapshotState(state) {
  return Object.freeze(Object.fromEntries([...state].map(([id, value]) => [id, clone(value)])));
}

function evaluateNodes(graph, nodeIds, initialState = createState(graph)) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const state = new Map([...initialState].map(([id, value]) => [id, clone(value)]));
  const issues = [];
  const steps = [];
  for (const [index, nodeId] of nodeIds.entries()) {
    const node = byId.get(nodeId);
    const before = snapshotState(state);
    for (const condition of node.preconditions) {
      const actual = state.get(condition.entityId)?.[condition.key];
      if (!matches(actual, condition)) issues.push(Object.freeze({
        code: "story_precondition_failed", severity: "conflict", pathIndex: index,
        nodeId, entityId: condition.entityId, key: condition.key,
        operator: condition.operator, expected: clone(condition.value), actual: clone(actual)
      }));
    }
    for (const effect of node.effects) applyEffect(state.get(effect.entityId), effect);
    steps.push(Object.freeze({ nodeId, before, after: snapshotState(state) }));
  }
  return Object.freeze({ state, issues: Object.freeze(issues), steps: Object.freeze(steps) });
}

export function evaluateStoryPath(input, pathId) {
  const graph = parseStoryGraph(input);
  const path = graph.paths.find(({ id }) => id === pathId);
  if (!path) throw new StoryGraphError("missing_story_path");
  const result = evaluateNodes(graph, path.nodeIds);
  const issues = Object.freeze(result.issues.map((issue) => Object.freeze({ ...issue, pathId })));
  return Object.freeze({ graphId: graph.id, pathId, issues,
    steps: result.steps, finalState: snapshotState(result.state) });
}

export function readStoryState(input, { pathId, nodeId, entityId, key, phase = "before" }) {
  if (!["before", "after"].includes(phase)) throw new StoryGraphError("invalid_story_state_phase");
  const evaluation = evaluateStoryPath(input, pathId);
  const step = evaluation.steps.find((candidate) => candidate.nodeId === nodeId);
  if (!step) throw new StoryGraphError("story_node_not_in_path");
  if (!Object.hasOwn(step[phase], entityId)) throw new StoryGraphError("missing_story_entity_reference");
  return clone(step[phase][entityId][key]);
}

export function characterKnowsFact(input, { pathId, nodeId, characterId, factId, phase = "before" }) {
  const knowledge = readStoryState(input, { pathId, nodeId, entityId: characterId,
    key: "knowledge", phase });
  return Array.isArray(knowledge) && knowledge.includes(factId);
}

function commonPrefixLength(left, right) {
  let index = 0;
  while (index < left.length && index < right.length && left[index] === right[index]) index += 1;
  return index;
}

function commonSuffixLength(left, right, prefixLength) {
  let length = 0;
  while (length < left.length - prefixLength && length < right.length - prefixLength
    && left[left.length - length - 1] === right[right.length - length - 1]) length += 1;
  return length;
}

function changedKeys(before, after) {
  const changed = new Map();
  for (const entityId of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const left = before[entityId] ?? {};
    const right = after[entityId] ?? {};
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      if (!equal(left[key], right[key])) changed.set(`${entityId}\u0000${key}`,
        { entityId, key, before: clone(left[key]), after: clone(right[key]) });
    }
  }
  return changed;
}

export function compareStoryPathMerge(input, oursPathId, theirsPathId) {
  const graph = parseStoryGraph(input);
  const ours = graph.paths.find(({ id }) => id === oursPathId);
  const theirs = graph.paths.find(({ id }) => id === theirsPathId);
  if (!ours || !theirs || ours.id === theirs.id) throw new StoryGraphError("invalid_story_path_comparison");
  const prefixLength = commonPrefixLength(ours.nodeIds, theirs.nodeIds);
  if (prefixLength === ours.nodeIds.length && prefixLength === theirs.nodeIds.length) {
    throw new StoryGraphError("story_paths_do_not_diverge");
  }
  const suffixLength = commonSuffixLength(ours.nodeIds, theirs.nodeIds, prefixLength);
  const base = evaluateNodes(graph, ours.nodeIds.slice(0, prefixLength));
  const baseState = snapshotState(base.state);
  const oursBranch = ours.nodeIds.slice(prefixLength, ours.nodeIds.length - suffixLength || undefined);
  const theirsBranch = theirs.nodeIds.slice(prefixLength, theirs.nodeIds.length - suffixLength || undefined);
  const oursResult = evaluateNodes(graph, oursBranch, base.state);
  const theirsResult = evaluateNodes(graph, theirsBranch, base.state);
  const oursChanges = changedKeys(baseState, snapshotState(oursResult.state));
  const theirsChanges = changedKeys(baseState, snapshotState(theirsResult.state));
  const conflicts = [];
  for (const [identity, oursChange] of oursChanges) {
    const theirsChange = theirsChanges.get(identity);
    if (theirsChange && !equal(oursChange.after, theirsChange.after)) conflicts.push(Object.freeze({
      entityId: oursChange.entityId, key: oursChange.key, base: oursChange.before,
      ours: oursChange.after, theirs: theirsChange.after
    }));
  }
  conflicts.sort((left, right) => left.entityId.localeCompare(right.entityId) || left.key.localeCompare(right.key));
  // Evaluate each complete route as written as well as the divergent state.
  // Preconditions on the shared suffix can succeed on one route and fail on the other.
  const issues = Object.freeze([
    ...evaluateStoryPath(graph, ours.id).issues,
    ...evaluateStoryPath(graph, theirs.id).issues
  ]);
  return Object.freeze({ oursPathId, theirsPathId,
    sharedPrefixNodeIds: Object.freeze(ours.nodeIds.slice(0, prefixLength)),
    sharedSuffixNodeIds: Object.freeze(suffixLength ? ours.nodeIds.slice(-suffixLength) : []),
    oursNodeIds: Object.freeze(oursBranch), theirsNodeIds: Object.freeze(theirsBranch),
    conflicts: Object.freeze(conflicts), issues,
    mergeable: conflicts.length === 0 && issues.length === 0 });
}

export function checkStoryGraphConsistency(input) {
  const graph = parseStoryGraph(input);
  const pathResults = graph.paths.map((path) => evaluateStoryPath(graph, path.id));
  const covered = new Set(graph.paths.flatMap(({ nodeIds }) => nodeIds));
  const issues = pathResults.flatMap((result) => result.issues);
  const warnings = graph.nodes.filter(({ id }) => !covered.has(id)).map(({ id }) => Object.freeze({
    code: "story_node_outside_all_paths", severity: "warning", nodeId: id
  }));
  return Object.freeze({ graphId: graph.id, pathCount: graph.paths.length,
    issues: Object.freeze(issues), warnings: Object.freeze(warnings),
    consistent: issues.length === 0 });
}

const FORWARD_IMPACT_EDGES = new Set([
  "sequence", "alternative", "merge", "causes", "foreshadows", "supports",
  "explains", "character-state", "timeline"
]);
const REVERSE_IMPACT_EDGES = new Set(["requires", "reference", "resolves"]);

export function traceStoryImpact(input, { nodeIds }) {
  const graph = parseStoryGraph(input);
  if (!Array.isArray(nodeIds) || nodeIds.length < 1 || nodeIds.length > graph.nodes.length) {
    throw new StoryGraphError("invalid_story_impact_request");
  }
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const seeds = new Set(nodeIds);
  if (seeds.size !== nodeIds.length || nodeIds.some((id) => !nodes.has(id))) {
    throw new StoryGraphError("invalid_story_impact_request");
  }
  const adjacency = new Map(graph.nodes.map(({ id }) => [id, []]));
  const connect = (from, to, reason, edgeId = null) => {
    adjacency.get(from).push(Object.freeze({ to, reason, edgeId }));
  };
  for (const edge of graph.edges) {
    if (FORWARD_IMPACT_EDGES.has(edge.type)) connect(edge.from, edge.to, edge.type, edge.id);
    if (REVERSE_IMPACT_EDGES.has(edge.type)) connect(edge.to, edge.from, edge.type, edge.id);
    if (edge.type === "contradicts") {
      connect(edge.from, edge.to, edge.type, edge.id);
      connect(edge.to, edge.from, edge.type, edge.id);
    }
  }
  const readers = new Map();
  for (const node of graph.nodes) {
    for (const condition of node.preconditions) {
      const key = `${condition.entityId}\u0000${condition.key}`;
      if (!readers.has(key)) readers.set(key, []);
      readers.get(key).push(node.id);
    }
  }
  for (const node of graph.nodes) {
    for (const effect of node.effects) {
      for (const readerId of readers.get(`${effect.entityId}\u0000${effect.key}`) ?? []) {
        if (readerId !== node.id) connect(node.id, readerId, "state-dependency");
      }
    }
  }
  const pending = [...nodeIds];
  const visited = new Set(nodeIds);
  const impacts = [];
  while (pending.length) {
    const source = pending.shift();
    for (const link of adjacency.get(source)) {
      if (visited.has(link.to)) continue;
      visited.add(link.to);
      pending.push(link.to);
      impacts.push(Object.freeze({ nodeId: link.to, viaNodeId: source,
        reason: link.reason, edgeId: link.edgeId }));
    }
  }
  return Object.freeze({ graphId: graph.id, sourceNodeIds: Object.freeze([...nodeIds]),
    impacts: Object.freeze(impacts) });
}
