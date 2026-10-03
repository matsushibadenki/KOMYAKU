import { z } from "zod";
import { parseCanonicalDocument } from "@komyaku/document-schema";

export const STORY_GRAPH_SCHEMA_ID = "https://komyaku.example/schemas/story-graph/v1";
export const STORY_GRAPH_SCHEMA_VERSION = 1;
export const STORY_WORKSPACE_SCHEMA_ID = "https://komyaku.example/schemas/story-workspace/v1";
export const STORY_GRAPH_LIMITS = Object.freeze({
  maxNodes: 10_000, maxEdges: 50_000, maxPaths: 1_000, maxEntities: 10_000,
  maxPathNodes: 10_000, maxDocumentRefsPerNode: 100, maxStateRulesPerNode: 100
});

const uuid = z.string().uuid();
const slug = z.string().min(1).max(100).regex(/^[a-z][a-z0-9-]*$/);
const jsonValue = z.json();
const extensions = z.record(z.string().min(1).max(200), jsonValue).default({});
const stateValue = jsonValue;

const entitySchema = z.object({
  id: uuid,
  type: z.enum(["character", "location", "object", "event", "fact", "relationship", "rule"]),
  name: z.string().min(1).max(500),
  initialState: z.record(z.string().min(1).max(200), stateValue).default({}),
  metadata: z.record(z.string(), jsonValue).default({}),
  extensions
}).strict();

const stateConditionSchema = z.object({
  entityId: uuid,
  key: z.string().min(1).max(200),
  operator: z.enum(["equals", "not-equals", "contains", "not-contains", "exists", "not-exists"]),
  value: stateValue.optional()
}).strict().superRefine((condition, context) => {
  const needsValue = !["exists", "not-exists"].includes(condition.operator);
  if (needsValue !== Object.hasOwn(condition, "value")) {
    context.addIssue({ code: "custom", path: ["value"], message: "Condition value does not match its operator" });
  }
});

const stateEffectSchema = z.object({
  entityId: uuid,
  key: z.string().min(1).max(200),
  operation: z.enum(["set", "unset", "add", "remove"]),
  value: stateValue.optional()
}).strict().superRefine((effect, context) => {
  if ((effect.operation !== "unset") !== Object.hasOwn(effect, "value")) {
    context.addIssue({ code: "custom", path: ["value"], message: "Effect value does not match its operation" });
  }
});

const storyNodeSchema = z.object({
  id: uuid,
  kind: z.enum(["content", "structure", "logic", "reference", "state"]),
  subtype: slug,
  title: z.string().min(1).max(1_000),
  documentRefs: z.array(z.object({ nodeId: uuid }).strict()).default([]),
  preconditions: z.array(stateConditionSchema).default([]),
  effects: z.array(stateEffectSchema).default([]),
  metadata: z.record(z.string(), jsonValue).default({}),
  position: z.object({ x: z.number().finite(), y: z.number().finite() }).strict().default({ x: 0, y: 0 }),
  extensions
}).strict();

export const STORY_EDGE_TYPES = Object.freeze([
  "sequence", "alternative", "merge", "reference", "causes", "requires",
  "foreshadows", "resolves", "contradicts", "supports", "explains",
  "character-state", "timeline"
]);
export const STORY_FLOW_EDGE_TYPES = Object.freeze(["sequence", "alternative", "merge"]);

const storyEdgeSchema = z.object({
  id: uuid, from: uuid, to: uuid, type: z.enum(STORY_EDGE_TYPES),
  label: z.string().max(500).nullable().default(null), extensions
}).strict();

const storyPathSchema = z.object({
  id: uuid, name: z.string().min(1).max(500), nodeIds: z.array(uuid).min(1), extensions
}).strict();

const graphSchema = z.object({
  schemaId: z.literal(STORY_GRAPH_SCHEMA_ID),
  schemaVersion: z.literal(STORY_GRAPH_SCHEMA_VERSION),
  id: uuid,
  documentId: uuid,
  entities: z.array(entitySchema).default([]),
  nodes: z.array(storyNodeSchema),
  edges: z.array(storyEdgeSchema),
  paths: z.array(storyPathSchema).default([]),
  metadata: z.record(z.string(), jsonValue).default({}),
  extensions
}).strict();

export class StoryGraphError extends Error {
  constructor(code, message = code, options) {
    super(message, options);
    this.name = "StoryGraphError";
    this.code = code;
  }
}

function fail(code) { throw new StoryGraphError(code); }
function unique(values, code) {
  const set = new Set(values);
  if (set.size !== values.length) fail(code);
  return set;
}

function validateFlowDag(nodes, edges) {
  const outgoing = new Map(nodes.map(({ id }) => [id, []]));
  const indegree = new Map(nodes.map(({ id }) => [id, 0]));
  for (const edge of edges) {
    if (!STORY_FLOW_EDGE_TYPES.includes(edge.type)) continue;
    outgoing.get(edge.from).push(edge.to);
    indegree.set(edge.to, indegree.get(edge.to) + 1);
  }
  const pending = [...indegree].filter(([, count]) => count === 0).map(([id]) => id);
  let visited = 0;
  while (pending.length) {
    const id = pending.pop();
    visited += 1;
    for (const next of outgoing.get(id)) {
      const count = indegree.get(next) - 1;
      indegree.set(next, count);
      if (count === 0) pending.push(next);
    }
  }
  if (visited !== nodes.length) fail("cyclic_story_flow");
}

function validateGraph(graph, canonicalNodeIds, limits) {
  if (graph.nodes.length > limits.maxNodes || graph.edges.length > limits.maxEdges
    || graph.paths.length > limits.maxPaths || graph.entities.length > limits.maxEntities) {
    fail("story_graph_limit_exceeded");
  }
  const nodeIds = unique(graph.nodes.map(({ id }) => id), "duplicate_story_node_id");
  const entityIds = unique(graph.entities.map(({ id }) => id), "duplicate_story_entity_id");
  unique(graph.edges.map(({ id }) => id), "duplicate_story_edge_id");
  unique(graph.paths.map(({ id }) => id), "duplicate_story_path_id");
  const edgeKeys = [];
  for (const node of graph.nodes) {
    if (node.documentRefs.length > limits.maxDocumentRefsPerNode
      || node.preconditions.length > limits.maxStateRulesPerNode
      || node.effects.length > limits.maxStateRulesPerNode) fail("story_node_limit_exceeded");
    unique(node.documentRefs.map(({ nodeId }) => nodeId), "duplicate_story_document_reference");
    if (canonicalNodeIds && node.documentRefs.some(({ nodeId }) => !canonicalNodeIds.has(nodeId))) {
      fail("missing_canonical_node_reference");
    }
    for (const rule of [...node.preconditions, ...node.effects]) {
      if (!entityIds.has(rule.entityId)) fail("missing_story_entity_reference");
    }
  }
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) fail("missing_story_edge_node");
    if (edge.from === edge.to) fail("self_story_edge");
    edgeKeys.push(`${edge.from}\u0000${edge.to}\u0000${edge.type}`);
  }
  unique(edgeKeys, "duplicate_story_edge");
  validateFlowDag(graph.nodes, graph.edges);
  const flow = new Set(graph.edges.filter(({ type }) => STORY_FLOW_EDGE_TYPES.includes(type))
    .map(({ from, to }) => `${from}\u0000${to}`));
  for (const path of graph.paths) {
    if (path.nodeIds.length > limits.maxPathNodes) fail("story_path_limit_exceeded");
    unique(path.nodeIds, "duplicate_story_path_node");
    if (path.nodeIds.some((id) => !nodeIds.has(id))) fail("missing_story_path_node");
    for (let index = 1; index < path.nodeIds.length; index += 1) {
      if (!flow.has(`${path.nodeIds[index - 1]}\u0000${path.nodeIds[index]}`)) {
        fail("disconnected_story_path");
      }
    }
  }
  return graph;
}

export function parseStoryGraph(input, {
  canonicalNodeIds = null,
  limits = STORY_GRAPH_LIMITS
} = {}) {
  const graph = graphSchema.parse(input);
  const references = canonicalNodeIds === null ? null
    : canonicalNodeIds instanceof Set ? canonicalNodeIds : new Set(canonicalNodeIds);
  return validateGraph(graph, references, { ...STORY_GRAPH_LIMITS, ...limits });
}

function collectCanonicalNodeIds(document) {
  const ids = new Set();
  const pending = [...document.content];
  while (pending.length) {
    const node = pending.pop();
    if (node.id) ids.add(node.id);
    pending.push(...(node.content ?? []).filter((child) => child?.id));
    pending.push(...(node.caption ?? []).filter((child) => child?.id));
  }
  return ids;
}

export function parseStoryWorkspace(input) {
  if (!input || input.schemaId !== STORY_WORKSPACE_SCHEMA_ID || input.schemaVersion !== 1) {
    fail("invalid_story_workspace");
  }
  const document = parseCanonicalDocument(input.document);
  const graph = parseStoryGraph(input.graph, { canonicalNodeIds: collectCanonicalNodeIds(document) });
  if (graph.documentId !== document.id) fail("story_workspace_document_mismatch");
  return Object.freeze({ schemaId: STORY_WORKSPACE_SCHEMA_ID, schemaVersion: 1, document, graph });
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value !== null && typeof value === "object") return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, nested]) => [key, stableValue(nested)]));
  return value;
}

export function encodeStoryWorkspaceSnapshot(input, { maxBytes = 24 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) fail("invalid_story_workspace_limit");
  const workspace = parseStoryWorkspace(input);
  const json = JSON.stringify(stableValue(workspace));
  const bytes = new TextEncoder().encode(json);
  if (bytes.byteLength > maxBytes) fail("story_workspace_too_large");
  return Object.freeze({ workspace, json, bytes });
}
