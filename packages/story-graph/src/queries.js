import { z } from 'zod';
import { StoryGraphError } from './schema.js';

export const STORY_QUERY_EVALUATOR_VERSION = 'story-query/1';
export const STORY_QUERY_LIMITS = Object.freeze({ maxPaths: 32, maxSeeds: 100, maxRecords: 1000, maxResultBytes: 1024 * 1024 });
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const key = z.string().min(1).max(200);
const ids = max => z.array(uuid).min(1).max(max).refine(v => new Set(v).size === v.length);
const querySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state-at'), pathId: uuid, nodeId: uuid, entityId: uuid, key, phase: z.enum(['before', 'after']) }).strict(),
  z.object({ type: z.literal('consistency'), pathIds: ids(32) }).strict(),
  z.object({ type: z.literal('compare-paths'), oursPathId: uuid, theirsPathId: uuid }).strict()
    .refine(q => q.oursPathId !== q.theirsPathId),
  z.object({ type: z.literal('impact'), nodeIds: ids(100) }).strict()
]);
const requestSchema = z.object({ workspaceId: uuid, versionId: uuid, query: querySchema }).strict();
const index = z.number().int().min(0).max(9999);
const slot = z.object({ exists: z.boolean(), value: z.json().optional() }).strict()
  .refine(v => v.exists === Object.hasOwn(v, 'value'));
const issue = z.object({
  code: z.literal('story_precondition_failed'), severity: z.literal('conflict'),
  pathId: uuid, pathIndex: index, nodeId: uuid, conditionIndex: z.number().int().min(0).max(99),
  entityId: uuid, key, operator: z.enum(['equals', 'not-equals', 'contains', 'not-contains', 'exists', 'not-exists']),
  expected: z.json().optional(), actual: z.json().optional()
}).strict().refine(v => !['exists', 'not-exists'].includes(v.operator) === Object.hasOwn(v, 'expected'));
const issues = z.array(issue).max(1000);
const resultSchemas = {
  'state-at': z.object({ exists: z.boolean(), value: z.json().optional(), evidence: z.object({
    initial: slot, effects: z.array(z.object({ nodeId: uuid, effectIndex: z.number().int().min(0).max(99) }).strict()).max(1000)
  }).strict() }).strict().refine(v => v.exists === Object.hasOwn(v, 'value')),
  consistency: z.object({ consistent: z.boolean(), issues }).strict().refine(v => v.consistent === (v.issues.length === 0)),
  'compare-paths': z.object({
    sharedPrefixNodeIds: z.array(uuid).max(10000), sharedSuffixNodeIds: z.array(uuid).max(10000),
    oursNodeIds: z.array(uuid).max(10000), theirsNodeIds: z.array(uuid).max(10000),
    conflicts: z.array(z.object({ entityId: uuid, key, base: z.json().optional(), ours: z.json().optional(), theirs: z.json().optional() }).strict()).max(1000),
    issues, mergeable: z.boolean()
  }).strict().refine(v => v.mergeable === (v.conflicts.length === 0 && v.issues.length === 0)),
  impact: z.object({ impacts: z.array(z.object({ nodeId: uuid, viaNodeId: uuid,
    reason: z.enum(['sequence', 'alternative', 'merge', 'reference', 'causes', 'requires', 'foreshadows', 'resolves', 'contradicts', 'supports', 'explains', 'character-state', 'timeline', 'state-dependency']),
    edgeId: uuid.nullable()
  }).strict().refine(v => (v.reason === 'state-dependency') === (v.edgeId === null))).max(1000) }).strict()
};
const envelopeSchema = z.object({
  workspaceId: uuid, versionId: uuid, snapshotHash: z.string().regex(/^[0-9a-f]{64}$/),
  evaluatorVersion: z.literal(STORY_QUERY_EVALUATOR_VERSION), graphSchemaVersion: z.literal(1),
  query: querySchema, result: z.unknown()
}).strict();

export function parseStoryQueryRequest(input) {
  const result = requestSchema.safeParse(input);
  if (!result.success) throw new StoryGraphError('invalid_story_query');
  return result.data;
}

export function parseStoryQueryResult(input, request) {
  const expected = parseStoryQueryRequest(request);
  try {
    if (new TextEncoder().encode(JSON.stringify(input)).length > STORY_QUERY_LIMITS.maxResultBytes) throw new Error();
    const result = envelopeSchema.parse(input);
    // Parsing puts fields in a stable order; comparison includes the complete
    // query, not merely the Version, so responses cannot cross paths or phases.
    if (result.workspaceId !== expected.workspaceId || result.versionId !== expected.versionId
      || JSON.stringify(result.query) !== JSON.stringify(expected.query)) throw new Error();
    result.result = resultSchemas[expected.query.type].parse(result.result);
    const q = expected.query;
    if (q.type === 'consistency' || q.type === 'compare-paths') {
      const paths = q.pathIds ?? [q.oursPathId, q.theirsPathId];
      if (result.result.issues.some(issue => !paths.includes(issue.pathId))) throw new Error();
    }
    if (q.type === 'impact') {
      const seen = new Set(q.nodeIds);
      for (const impact of result.result.impacts) {
        if (seen.has(impact.nodeId) || !seen.has(impact.viaNodeId)) throw new Error();
        seen.add(impact.nodeId);
      }
    }
    return result;
  } catch {
    throw new StoryGraphError('invalid_story_query_result');
  }
}
