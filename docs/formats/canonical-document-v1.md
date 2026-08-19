# KOMYAKU Canonical Document Schema v1

- Status: Implemented internal format
- Schema identifier: `https://komyaku.example/schemas/document/v1`
- Schema version: `1`
- Reference implementation: `packages/document-schema`

This document specifies the versioned JSON boundary used for editable KOMYAKU documents. It is independent of ProseMirror JSON and of the future open `.komyaku` archive container. A `.komyaku` archive may contain Canonical Documents, Assets, and Version Graph data, but it will have its own format version and specification.

## Compatibility contract

- A reader must validate `schemaId` and `schemaVersion` before interpreting content.
- A reader must reject unknown node types and future versions. It must not silently discard them.
- Writers must preserve authored strings exactly. Unicode normalization is forbidden at this boundary.
- Every semantic content node has a stable UUID. Editing a node keeps its ID; inserting a new semantic node creates a new ID.
- Compatible application metadata belongs in `metadata`. Namespaced extensions belong in `extensions`, for example `org.example.research`.
- Rendered HTML, SVG, thumbnails, and PDFs are derived artifacts. They never replace canonical source or immutable original Assets.
- Binary data is referenced by Asset UUID and is not embedded as Base64 in Document JSON.

## Document envelope

```json
{
  "schemaId": "https://komyaku.example/schemas/document/v1",
  "schemaVersion": 1,
  "id": "0198...",
  "type": "document",
  "attrs": {
    "language": "ja",
    "direction": "auto",
    "writingMode": "horizontal-tb"
  },
  "metadata": {},
  "extensions": {},
  "content": []
}
```

`content` must contain at least one block. `language` uses a BCP 47-style language tag or `und`. Direction is `auto`, `ltr`, or `rtl`; writing mode is `horizontal-tb`, `vertical-rl`, or `vertical-lr`.

## Common semantic-node fields

All semantic nodes contain:

| Field | Meaning |
|---|---|
| `id` | Stable UUID identity across Document Versions |
| `schemaVersion` | Node schema version; `1` in this specification |
| `type` | Discriminant from the node registry below |
| `metadata` | Compatible application metadata |
| `extensions` | Namespaced extension data |
| `renderArtifacts` | Optional derived Asset references |
| `provenance` | Optional creator, time, source node, and source-version references |

Plain `text` and `hard_break` nodes do not have stable IDs. They are inline values inside a stable parent. `math_inline` is semantic and does have a stable ID.

## Node registry

| Category | Node types | Canonical data |
|---|---|---|
| Text structure | `paragraph`, `heading`, `blockquote` | Inline or nested block content |
| Lists | `bullet_list`, `ordered_list`, `list_item` | Nested list and block content |
| Tables | `table`, `table_row`, `table_cell` | Structural children and cell span/header attributes |
| Source content | `code_block`, `math_inline`, `math_block`, `diagram` | Authored code, LaTeX, Mermaid, or SVG source |
| Assets | `image`, `file` | Asset UUID, media type, accessibility and display metadata |
| Layout | `horizontal_rule`, `hard_break` | Structural marker |
| Inline text | `text` | Exact string plus marks |

Text marks are `bold`, `italic`, `underline`, `strike`, `code`, and `link`. Link schemes are restricted to HTTP, HTTPS, mail, document-relative paths, and fragments. Rendering must still sanitize output and must not treat stored source as trusted HTML.

`diagram.sourceType` is `mermaid` or `svg`. `math_inline` and `math_block` preserve LaTeX source. `image` and `file` refer to Assets; a generated preview belongs in `renderArtifacts` with its media type, role, renderer identity, and optional source hash.

## Structural invariants and limits

- Node IDs, including the Document ID, are unique within a Document.
- `list_item` appears only below `bullet_list` or `ordered_list`.
- `table_row` appears only below `table`; `table_cell` appears only below `table_row`.
- Default validation limits are 100,000 semantic/inline nodes, depth 64, 500,000 JSON values, and 10 MiB of string code units.
- Cyclic JavaScript objects are rejected before schema validation.

Importers may set stricter limits. Relaxing limits at a trust boundary requires an explicit resource review.

## Migration and editor boundary

The current migration accepts the pre-v1 KOMYAKU ProseMirror foundation shape and creates stable IDs without changing authored text, LaTeX, or Mermaid source. A future schema must add an explicit step such as `v1 -> v2`; existing stored snapshots remain immutable.

`packages/editor-core` maps this format to the current ProseMirror schema. The adapter preserves stable IDs, document metadata, extensions, Assets, provenance, and render-artifact references. If Canonical data cannot be represented by the editor, conversion fails explicitly instead of silently losing it.

## 日本語要約

Canonical Document v1は、KOMYAKUの編集可能な文書を保存する構造化JSONです。ProseMirror固有JSONや`.komyaku` Archiveとは分離されています。入力したUnicode文字列、LaTeX、Mermaid、SVGソースをそのまま保持し、画像・PDF等はAsset IDで参照します。未知Nodeや将来Versionを黙って破棄せず、安定Node IDによってVersion間の系譜を追跡します。

## 简体中文摘要

Canonical Document v1 是 KOMYAKU 用于保存可编辑文档的结构化 JSON 边界，与 ProseMirror JSON 和未来的 `.komyaku` 归档容器相互独立。它原样保留 Unicode 文本、LaTeX、Mermaid 与 SVG 源码，并通过 Asset ID 引用图像和 PDF。读取器不得静默丢弃未知节点或未来版本；稳定的节点 ID 用于追踪跨版本演变。
