# ADR-077: Document History First Delivery

## Status

Accepted — 2026-09-05

Supersedes delivery priority, not the format/security contracts, of the Stage 3/4 roadmap and ADR-075/076. Those feature designs remain valid later work.

## Context

The repository has substantial Canonical, Asset, recovery, Archive, and Cloud infrastructure, while Version Engine is a status constant, Diff only segments graphemes, and Sync only declares a conflict policy. The main UI is a two-replica workbench. Archive v1 explicitly excludes history. More supporting features would not establish the core document-versioning product.

## Decision

Follow N0–N4 in `../ROADMAP.md` and the contracts in `../product/document-git-strategy.md`:

1. Close edit-session persistence, rename, switch, and export consistency gaps.
2. Implement local immutable snapshots, Version DAG, branch-head compare-and-swap, restore-as-new-version, and history Asset retention.
3. Deliver one-editor authoring, explicit saved versions, alternatives, and readable structural/grapheme comparison.
4. Add reviewed 3-way merge and independently restorable local history Archives before public local Alpha.
5. Validate repeated use before Cloud history sync and asynchronous review; real-time collaboration and new specialized formats follow later.

Keep React/Tauri, ProseMirror/Yjs, Canonical Schema, SQLite, Bun/Hono, PostgreSQL, and S3. Preserve Cloud launch gates without making them prerequisites for local implementation. Keep external normal-VPS Workers isolated from Managed PostgreSQL behind HTTPS or queue interfaces. Do not rewrite existing migrations or redefine Archive v1 to silently include incompatible history fields.

## Consequences

Completed foundation work remains available and maintained. Math Palette, recognition, academic export, AI expansion, media, billing, and scaling are deferred. The core is measured by end-to-end preservation and use, not number of completed infrastructure tasks. No new runtime implementation is claimed by this decision.

## 日本語

技術基盤は維持し、文書保存の整合性、版・別案・比較・復元、確認付き統合、ローカル履歴持ち出しを先に完成させる。周辺機能とCloud拡張は利用検証後に進める。

## 简体中文

保留技术基础，优先完成可靠保存、版本与备选方案、比较与恢复、人工确认合并，以及本地历史导出。扩展功能和Cloud在使用验证后推进。
