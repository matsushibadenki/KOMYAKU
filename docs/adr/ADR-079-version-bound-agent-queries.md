# ADR-079 — Version-bound Agent queries and disposable derived indexes

Status: Accepted — 2026-10-15

## Context

An Agent should not need the complete manuscript or all history to answer a structural question. The native composite Version store already retains immutable Document + Graph + Path snapshots; current-state reads alone do not give a stable basis for Agent reasoning. A response that silently follows a moving Branch or working revision can mix different routes or invalidate an earlier decision.

Anthropic's [Scion design](https://www.anthropic.com/engineering/redesigning-source-control), published 2026-10-13, provides a useful reference for API access without a working copy and for separating authoritative records from derived indexes. Its always-online, distributed-monorepo assumptions are not KOMYAKU's deployment requirements.

## Decision

Keep local Rust/SQLite authority, immutable composite snapshots, atomic adoption and offline operation. Add a read-only `query_story_workspace_version` command and an editor-independent request/result contract in `@komyaku/story-graph`. The Desktop transport invokes Rust; it does not evaluate authoritative answers in a WebView. No new service, database, authentication provider or cloud dependency is introduced.

Every request names an exact Workspace and immutable Version plus a bounded query. There is no `latest`, implicit current Branch or fallback to mutable state. Rust reads one scoped Version row, verifies the exact stored SHA-256 and validates the composite Document/Graph/reference contract. Returned provenance includes the Workspace, Version, exact Snapshot hash, Graph schema version, evaluator version and complete query. Asset bytes are not required for structural queries; this read is not proof of attachment integrity or recoverable archive completeness.

The first implemented query set is:

| Query | Scope and meaning |
| --- | --- |
| `state-at` | One Entity property before or after one Node on one named Path. Return presence separately from JSON null, the initial property and ordered Node/effect-index witnesses. `knowledge` is queried through the same property mechanism. |
| `consistency` | Deterministic precondition failures across explicitly requested Paths, with Path/Node/condition-index witnesses. A successful result covers those Paths only. |
| `compare-paths` | Divergent property conflicts plus complete-route precondition failures, including the shared suffix. This is advisory compatibility, not an approved Version merge or proof that combined prose is correct. |
| `impact` | Conservative reachability from changed Nodes through flow/semantic relations and declared state dependencies. First-witness BFS explains each affected Node. Reachability does not assert an actual contradiction. |

The query cannot write Graph facts, generate a Version, move a Branch or create an operation receipt. AI-extracted facts remain review material until accepted through the application policy boundary. The existing main-window SQL capability is unchanged, so this command is not a sandbox for untrusted Agents. Authenticated external Agent transport and proposal adoption remain separate N3S integration work.

## Truth and derived data

Authoritative data consists of accepted Canonical Document/Graph declarations, immutable composite Versions, parent relationships and transactional Branch/selection/receipt records. Query results and lookup indexes are derived, rebuildable data.

The implementation builds request-local Node/Path lookups and impact adjacency/reader indexes. It evaluates a point property without cloning every Entity at every scene. State dependencies are expanded on demand, once per Entity/property, instead of materializing every writer-reader pair. Native computation runs off the async executor, with bounded concurrent calls and cumulative work/copy budgets. No partial success is returned when a limit is exceeded.

Persistent or cross-request derived caches are deliberately not implemented before profiling. A future cache must be disposable, bounded and keyed by Workspace + exact Snapshot hash + Graph schema version + evaluator/rule version + complete query (including Paths, phase and seed order). A Version ID alone, a Branch name or a Node ID alone is insufficient. Bind the response Version separately when multiple Versions share identical Snapshot bytes. Cache eviction must never delete authoritative data or affect archive recovery.

Object property order has no effect on JSON state equality; missing and null remain different. Conflict ordering uses Unicode scalar order, not the machine's locale. JavaScript reference evaluation and Rust share a conformance corpus for these rules.

## Delivery and later optimization

The read-only query block is brought forward within N3S because immutable native capture and restore already exist and this API does not depend on unfinished merge/import writes. This does not mark N3S complete or replace its public-Alpha gates.

1. Complete this native query contract and automated cross-runtime/restart verification.
2. Connect reviewed composite Merge, native Archive v3 recovery and the real IPC/editor/Agent workflow. Bind every adoption proposal to its base Version and revision/head/selection guards; retain the single atomic adoption transaction and exact retry receipts. The bounded local session, ordinary editor review panel and durable review recovery are implemented; see [the session contract](../formats/story-agent-session-v1.md). Composite history controls, provider/external transports and Archive integration remain open.
3. Profile representative manuscripts and concurrent Agent queries. Add reusable derived indexes, batching or structural sharing only where measurements justify them. Any storage optimization must reconstruct exact composite snapshots and preserve Archive v3 compatibility.

Meaningful Story Paths and Version Branches remain distinct product concepts. No reduction of named routes, always-online requirement, distributed database migration or delta-only history rewrite is adopted from Scion.

## 日本語

保存済みVersionに固定した問い合わせをRustで実行し、本文全体をWebViewやAgentへ渡さず、必要な結果と根拠を返します。正式な本文・Graph・履歴と、再計算できる索引・回答を分離します。影響範囲は矛盾の断定ではなく、ルート比較はMergeの承認ではありません。ローカル動作と承認時の原子的保存を維持します。

## 简体中文

查询绑定到已保存的不可变版本，由 Rust 执行，仅返回所需结果及依据，无须向 WebView 或 Agent 传输完整正文。正式文档、图谱和历史与可重建的索引、查询结果分离。影响范围不等于已确认的矛盾，路线比较也不等于批准合并。保留离线运行及采纳变更时的原子保存。
