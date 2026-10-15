# Story Query v1

The local read capability is `query_story_workspace_version({ input })`. The Desktop wrapper is `queryStoryWorkspaceVersion(input)`; portable request/result validators are exported by `@komyaku/story-graph`. Neither API accepts proposed prose, Graph bytes, operations or caller-supplied author metadata.

```js
const answer = await queryStoryWorkspaceVersion({
  workspaceId,
  versionId, // immutable composite Version, never a Branch or "latest"
  query: {
    type: 'state-at',
    pathId,
    nodeId,
    entityId: characterId,
    key: 'knowledge',
    phase: 'before'
  }
});
// Only meaningful for the explicit knowledge-array convention:
const knows = answer.result.exists
  && Array.isArray(answer.result.value)
  && answer.result.value.includes(factId);
```

Other query selectors:

```js
{ type: 'consistency', pathIds: [routeA, routeB] }
{ type: 'compare-paths', oursPathId: routeA, theirsPathId: routeB }
{ type: 'impact', nodeIds: [changedScene] }
```

All requests and nested selectors reject unknown fields. IDs are normalized lowercase UUIDs with versions 1–8 and variants 8–b. `phase` is required; property keys contain 1–200 UTF-16 units. Path and seed arrays are nonempty and reject duplicates. Route comparison requires two different Paths that diverge.

Every response contains exactly:

```text
workspaceId, versionId, snapshotHash, evaluatorVersion,
graphSchemaVersion, query, result
```

`snapshotHash` is SHA-256 of the exact stored composite UTF-8 JSON, not reserialized client data. `evaluatorVersion` is `story-query/1`; `graphSchemaVersion` is `1`. The complete selector is echoed so clients can reject responses for the wrong Path/phase/property/seeds. New evaluation semantics require a new evaluator version.

## Result contracts

- `state-at`: `{ exists, value?, evidence: { initial: { exists, value? }, effects: [{ nodeId, effectIndex }] } }`. `value` is present exactly when `exists` is true. An explicit JSON null is a present value. Effects are ordered as executed through the selected phase; each index identifies an effect in the immutable Graph. This is declared state, not a claim that the route's preconditions all pass. Call consistency separately when needed.
- `consistency`: `{ consistent, issues }`. Each issue has `code: "story_precondition_failed"`, `severity: "conflict"`, `pathId`, `pathIndex`, `nodeId`, `conditionIndex`, `entityId`, `key`, `operator`, optional `expected` and optional `actual`. Existence operators omit `expected`; missing properties omit `actual`. Conditions run before the Node's effects. Effects still execute when a condition fails so later declared-state diagnostics remain reproducible.
- `compare-paths`: `{ sharedPrefixNodeIds, sharedSuffixNodeIds, oursNodeIds, theirsNodeIds, conflicts, issues, mergeable }`. Conflicts contain `entityId`, `key`, optional `base`, `ours`, `theirs`; missing properties are omitted. Shared prefix establishes the base; divergent changes are compared before the shared suffix. Full-route issues include the suffix. `mergeable` means this declared-state check found no conflict/issue; adoption still requires review and final composite validation.
- `impact`: `{ impacts: [{ nodeId, viaNodeId, reason, edgeId }] }`. Seeds are excluded from impacts. Each affected Node appears once with its first breadth-first witness; traversal respects stored edge order, then state dependencies. `edgeId` is null only for `state-dependency`. `requires`, `reference` and `resolves` propagate in reverse; `contradicts` propagates both ways; remaining supported edges propagate forward. A property writer reaches every declared precondition reader conservatively, including readers outside a named Path. Semantic cycles terminate.

## Budgets and failures

| Resource | Limit |
| --- | --- |
| Stored snapshot | 24 MiB; checked by SQL before transfer to Rust |
| Requested consistency Paths | 32 |
| Impact seeds | 100 |
| Items per issue/conflict/impact/effect-evidence list | 1,000 |
| Serialized complete result | 1 MiB |
| Native calls in flight | 2 per process |
| Evaluation budget | 1,000,000 charged steps and 64 MiB cumulative value/copy accounting |

The evaluation budget is a conservative logical work bound, not a benchmark or an exact process-RSS guarantee. Full Document/Graph validation has its own schema/depth/resource limits. On `story_query_budget_exceeded` or `story_query_result_limit`, no partial success, `consistent: true` or `mergeable: true` is returned. The caller can split a multi-Path consistency request or choose a narrower point query. No pagination or truncation is implied for impact closure or route comparison.

`story_query_busy` is retryable after a bounded caller delay. `missing_story_version` covers missing or differently scoped Versions without falling back to current state. A corrupt exact hash fails with `story_version_hash_mismatch`; malformed composites fail existing native validation. Native storage/evaluation failures propagate, and browser fallback is refused. The Desktop adapter rejects malformed provenance/results as `invalid_story_query_result`.

No cross-request cache, public HTTP endpoint, authenticated Agent session, automatic AI extraction or merge write is part of v1. See [ADR-079](../adr/ADR-079-version-bound-agent-queries.md) for the future derived-cache key and adoption boundary.

## 日本語 / 简体中文

Version・ルート・場面を指定して宣言済みの状態を問い合わせます。結果には保存内容のハッシュと根拠が付きます。上限超過はエラーであり、途中までの結果を完全な回答として返しません。

指定版本、路线和场景来查询已声明的状态。结果包含快照哈希及依据。超过限制会返回错误，不会把部分结果作为完整答案。
