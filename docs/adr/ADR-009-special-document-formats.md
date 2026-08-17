# ADR-009: 特殊文書形式の保存と表示

- Status: Accepted
- Date: 2026-08-13

## Context

KOMYAKUでは通常の構造化文章に加え、LaTeX、PDF、MermaidチャートなどをVersion履歴の一部として扱う必要がある。これらは、編集可能なソース、生成物、バイナリ文書という異なる性質を持つ。

## Decision

- LaTeXとMermaidは、ユーザーが入力したソースをCanonical Snapshotへ保存する。
- レンダリング済みHTML、SVG、画像、PDFは再生成可能な派生ArtifactまたはCacheとして扱う。
- PDF原本と生成PDFはObject Storageへ保存し、Document JSONでは`asset_id`で参照する。
- 生成物には、生成元Version、Renderer／Compiler Version、設定、Content Hashを関連付ける。
- LaTeX、Mermaid、PDFはそれぞれ専用の安全なRenderer／Viewer境界を持つ。
- LaTeXやMermaidの任意コード、危険なHTML、外部ファイルアクセスを実行しない。
- DiffはLaTeX／MermaidではソースDiff、PDFではMetadata・Hash・生成元関係を基本とする。

## Consequences

原文を失わず再レンダリングでき、Versionの再現性を保てる。一方で、安全なレンダリング環境、Renderer Version管理、Artifact Cache管理が必要になる。
