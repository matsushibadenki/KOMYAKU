# KOMYAKU Support App 設計仕様書

## 1. 概要

### 1.1 製品名

**KOMYAKU Support App**

KOMYAKU Support Appは、KOMYAKUの文書・知識・履歴管理機能をOS上のあらゆる文書へ拡張するための、Tauri 2 + Rustベースのクロスプラットフォーム・デスクトップアプリケーションである。

単なるKOMYAKUクライアントではなく、

**Document Hub / Document Inspector / Version Manager / Knowledge Connector**

として設計する。

主な役割は次の4つ。

1. ローカル文書とKOMYAKUを接続する
2. 文書の意味構造を解析する
3. 文書・構造・関係性の履歴を保存する
4. ローカルファイルとKOMYAKU Knowledge Graphを橋渡しする

---

# 2. 基本思想

従来のファイル管理は、

```text
report.pdf
report2.pdf
report_final.pdf
report_final2.pdf
```

のように「ファイル」を管理する。

Gitは、

```text
File
 ↓
Line
 ↓
Character
```

の変更を管理する。

KOMYAKUではさらに上位の、

```text
Document
 ↓
Structure
 ↓
Meaning
 ↓
Relationship
 ↓
History
```

を管理する。

したがってKOMYAKU Support Appの中心概念は、

> 「ファイルを保存する」のではなく「文書がどのような構造を持ち、どのように変化し、他の情報とどのようにつながっているかを保存する」

ことである。

---

# 3. KOMYAKUエコシステムにおける位置

```text
                     KOMYAKU
                Knowledge Platform
                        │
                        │
              ┌─────────┴─────────┐
              │                   │
              ▼                   ▼
       KOMYAKU Server       Local Environment
                                  │
                                  ▼
                       KOMYAKU Support App
                                  │
             ┌────────────────────┼────────────────────┐
             │                    │                    │
             ▼                    ▼                    ▼
           Files               Apps                Cloud
             │                    │                    │
        PDF / DOCX           Studio等             Drive等
        Markdown
        HTML
        Images
```

Support Appをローカル環境とKOMYAKUをつなぐ「橋」とする。

---

# 4. Acrobat代替Appとの関係

Acrobat代替AppとKOMYAKU Support Appは別製品とする。

ただし内部エンジンを共有する。

```text
              Shared Rust Workspace
                       │
                Document Core
                       │
          ┌────────────┴────────────┐
          │                         │
     Acrobat App             KOMYAKU Support
          │                         │
      PDF操作                 文書構造管理
```

Acrobat Appは、

```text
PDF → 編集
```

を中心とする。

KOMYAKU Support Appは、

```text
Document → Structure → Knowledge
```

を中心とする。

---

# 5. 技術スタック

## 5.1 基本構成

```text
Tauri 2
│
├── Frontend
│   ├── React
│   ├── JavaScript
│   ├── HTML
│   └── CSS
│
└── Rust Core
    ├── Document Core
    ├── Parser
    ├── Structure Engine
    ├── Version Engine
    ├── Search Engine
    ├── Sync Engine
    └── KOMYAKU Connector
```

TypeScriptを必須としない。

---

# 6. 対応OS

第一段階：

```text
macOS
Windows
Linux
```

第二段階：

```text
iOS
Android
```

Document CoreはOS非依存とする。

OS固有処理は、

```text
platform/
├── macos
├── windows
├── linux
├── ios
└── android
```

へ隔離する。

---

# 7. Rust Workspace

推奨構成：

```text
komyaku/
│
├── crates/
│   │
│   ├── document-core/
│   ├── document-model/
│   ├── document-parser/
│   ├── document-graph/
│   ├── structure-engine/
│   ├── version-engine/
│   ├── diff-engine/
│   ├── merge-engine/
│   ├── search-engine/
│   ├── asset-engine/
│   ├── metadata-engine/
│   ├── sync-engine/
│   ├── komyaku-protocol/
│   ├── komyaku-client/
│   └── platform/
│
├── apps/
│   ├── pdf/
│   ├── support/
│   └── studio/
│
└── packages/
    └── shared-ui/
```

Acrobat代替AppとDocument Studioも同じWorkspaceを利用可能とする。

---

# 8. Document Core

システム全体で最も重要なコンポーネント。

PDF、Markdown、HTMLなどを直接アプリ内部の中心データとしない。

すべて、

```text
External Format
       ↓
Document Core
       ↓
Internal Document Model
```

へ変換する。

---

# 9. Internal Document Model

基本構造：

```text
Document
│
├── Metadata
│
├── Structure
│
├── Content
│
├── Assets
│
├── Relations
│
└── History
```

Documentは永続的なUUIDを持つ。

```text
document_id
```

ファイル名や保存場所が変更されてもDocument IDは変更しない。

---

# 10. Node Model

文書内部をNodeとして表現する。

```text
Document
│
├── Section
│
│   ├── Heading
│   ├── Paragraph
│   ├── Figure
│   └── Equation
│
├── Section
│
└── References
```

Node基本情報：

```text
Node
├── id
├── type
├── parent
├── children
├── content
├── attributes
├── relations
├── provenance
└── history
```

---

# 11. Node Type

初期実装：

```text
Document
Section
Heading
Paragraph
TextRun
List
ListItem
Quote
Code
Table
TableRow
TableCell
Figure
Image
Vector
Equation
Footnote
Reference
Link
Annotation
Comment
Attachment
```

将来的にはユーザー定義Node Typeを許可する。

---

# 12. Universal Document Graph

Treeだけでは表現できない関係をGraphで保持する。

例えば、

```text
Section A
   │
   ├── contains → Paragraph B
   │
   └── refers_to → Figure C
                        │
                        └── derived_from → Dataset D
```

文書を、

```text
Tree + Graph
```

として扱う。

---

# 13. Relation Model

Relationも第一級オブジェクトとして扱う。

```text
Relation
├── id
├── source
├── target
├── type
├── confidence
├── provenance
├── created_at
└── metadata
```

Relation Type例：

```text
contains
references
cites
supports
contradicts
extends
derived_from
explains
defines
depends_on
supersedes
related_to
```

Relation Typeも拡張可能とする。

---

# 14. Provenance

KOMYAKUにとって非常に重要。

すべての情報について、

> 「どこから来た情報なのか」

を追跡可能にする。

例えば、

```text
Paragraph
   │
   └── provenance
          │
          ├── source: paper.pdf
          ├── page: 14
          ├── coordinates
          ├── imported_at
          └── parser_version
```

AIが生成した情報なら、

```text
source_type: ai
model
timestamp
input_reference
confidence
```

を保存できる構造にする。

---

# 15. ファイルインポート

初期対応：

```text
PDF
TXT
Markdown
HTML
JSON
CSV
SVG
Images
```

第二段階：

```text
DOCX
XLSX
PPTX
EPUB
ODT
RTF
```

将来的には、

```text
CAD
LaTeX
Jupyter Notebook
source code
audio
video
```

まで拡張可能とする。

---

# 16. Import Pipeline

```text
File
 ↓
Format Detection
 ↓
Parser
 ↓
Raw Document
 ↓
Layout Analysis
 ↓
Structure Analysis
 ↓
Semantic Analysis
 ↓
Document Model
 ↓
Document Graph
 ↓
Index
```

各段階を独立させる。

---

# 17. PDF Import

Acrobat代替AppのDocument Coreを利用する。

```text
PDF
 ↓
PDF Engine
 ↓
Text / Image / Vector / Coordinates
 ↓
Layout Reconstruction
 ↓
Reading Order
 ↓
Semantic Structure
 ↓
Document Model
```

これにより単純なPDFテキスト抽出より高品質な構造復元を行う。

---

# 18. Structure Engine

Structure Engineは、

```text
Heading
Paragraph
List
Table
Figure
Caption
Equation
Reference
```

などを判定する。

最初からAI依存にはしない。

```text
Rules
+
Layout Analysis
+
Statistics
+
Optional AI
```

のハイブリッド方式とする。

---

# 19. AIを交換可能にする

AI処理をDocument Coreへ埋め込まない。

```text
Structure Engine
      │
      ▼
AI Provider Interface
      │
 ┌────┼────┐
 │    │    │
Local API Cloud
```

例：

```text
Ollama
llama.cpp
MLX
vLLM
OpenAI互換API
Gemini
Claude
```

などを交換可能とする。

KOMYAKU本体が特定AI企業へ依存しない構造を維持する。

---

# 20. AIの役割

AIは主に、

```text
structure suggestion
relation suggestion
classification
summary
entity extraction
semantic search
translation
document comparison
```

を担当する。

重要なのは、

> AIの出力そのものを真実として保存しない

こと。

例えば、

```text
RelationCandidate
```

として保存する。

```text
A
 ↓
supports?
 ↓
B

confidence = 0.72
```

のように候補として扱える。

---

# 21. Version Engine

Git的思想を文書構造へ適用する。

通常のGit：

```text
File
 ↓
Line
 ↓
Diff
```

KOMYAKU：

```text
Document
 ↓
Node
 ↓
Relation
 ↓
Structural Diff
```

---

# 22. Snapshot

文書状態を、

```text
Snapshot
```

として保存する。

```text
Snapshot
├── id
├── document_id
├── parent
├── timestamp
├── author
├── message
└── root_hash
```

---

# 23. Content Addressing

可能な限りContent Addressable Storageを採用する。

```text
Content
 ↓
Hash
 ↓
Object
```

同一データを重複保存しない。

例えば100MBのPDFを1文字変更しても、

```text
100MB
+
100MB
```

と保存しない。

変更部分だけを保存できる設計を目指す。

---

# 24. Structural Diff

通常の文字Diffに加えて、

```text
Node Added
Node Removed
Node Modified
Node Moved
Relation Added
Relation Removed
Relation Modified
Asset Replaced
Metadata Changed
```

を検出する。

表示例：

```text
Section 4.2
Renamed

"Architecture"
      ↓
"System Architecture"


Figure 12
Moved

Section 4.2
      ↓
Section 4.3


Paragraph #839
Modified
```

---

# 25. Semantic Diff

将来的には、

```text
Text Diff
Structural Diff
Semantic Diff
```

の3段階にする。

Semantic Diff例：

```text
Previous:

X increases Y.

Current:

X does not significantly affect Y.
```

文字列差分以上に、

```text
Conclusion changed
```

と認識できる。

ただしSemantic Diffは推論結果であるため、確定データと区別する。

---

# 26. Branch

Gitと同様に、

```text
main
proposal-a
proposal-b
translation-en
review
```

などのBranchを作れるようにする。

ただしUIではGit用語を強制しない。

一般ユーザーには、

```text
Version
Variation
Draft
```

として見せてもよい。

---

# 27. Merge

Document GraphレベルでMergeする。

例えば、

```text
Base
 │
 ├── A: Section 2編集
 │
 └── B: Figure 5編集
```

なら自動Merge可能。

同じNodeを編集していればConflictとして表示する。

---

# 28. Time Machine

重要機能の一つ。

文書の状態を時間軸で閲覧する。

```text
2026
│
├── Jan
│
├── Mar
│
├── May
│
└── Aug
```

スライダーを動かすことで文書状態を遡れる。

さらに、

```text
Text
Structure
Relations
Assets
```

それぞれの変化を確認できる。

---

# 29. File Watcher

指定フォルダを監視する。

```text
~/Documents
~/Research
~/Projects
```

変更されたファイルを検出。

Rust側で、

```text
File Watcher
 ↓
Change Detector
 ↓
Document Resolver
 ↓
Version Engine
```

へ渡す。

---

# 30. Document Identity

ファイルパスだけで文書を識別しない。

例えば、

```text
report.pdf
```

を、

```text
Desktop/report.pdf
```

から、

```text
Documents/Project/report-final.pdf
```

へ移動しても同じDocumentとして認識する。

判定には、

```text
Document UUID
Content Hash
Metadata
File Identity
Similarity
```

などを組み合わせる。

---

# 31. Duplicate Detection

同じ文書のコピーを検出する。

```text
report.pdf
report-copy.pdf
report-final.pdf
```

について、

```text
Exact Duplicate
Near Duplicate
Derived Document
Independent Document
```

を判定する。

---

# 32. Local Search Engine

全文検索だけではなく、

```text
Filename
Metadata
Full Text
Structure
Relation
Semantic
History
```

を検索対象とする。

---

# 33. Search Query

例えば、

```text
"quantum"
```

だけでなく、

```text
type:equation
```

```text
author:Smith
```

```text
modified:2026-08
```

```text
relation:cites
```

```text
changed:conclusion
```

などを扱えるようにする。

---

# 34. Semantic Search

Embeddingを利用可能とするが、必須にはしない。

```text
Search
│
├── Lexical
├── Structural
├── Metadata
└── Semantic
```

複数検索結果をRank Fusionする。

---

# 35. Local First

基本原則：

> ローカルデータはローカルだけでも完全に利用できる。

```text
Local File
 ↓
Support App
 ↓
Local Database
```

KOMYAKU Serverへの接続がなくても、

```text
Import
Search
Version
Diff
Graph
```

を利用可能とする。

---

# 36. Local Database

第一候補：

```text
SQLite
```

用途：

```text
Document metadata
Node index
Relations
Version metadata
Search index
Sync state
```

巨大AssetはDBへ直接格納せずObject Storeへ置く。

---

# 37. Local Object Store

例：

```text
~/.komyaku/
│
├── database/
│
├── objects/
│   ├── 00/
│   ├── 01/
│   └── ...
│
├── index/
├── cache/
├── thumbnails/
└── config/
```

ObjectはHashベースで管理する。

---

# 38. Workspace

KOMYAKUでは文書をWorkspace単位で管理できる。

```text
Workspace
│
├── Documents
├── Assets
├── Graph
├── History
├── Members
└── Settings
```

例：

```text
Research
Company
Personal
Project A
```

---

# 39. KOMYAKU Server Sync

同期は、

```text
Local
 ↕
KOMYAKU Server
```

の双方向。

ファイル同期だけではない。

同期対象：

```text
Document
Node
Relation
Asset
Version
Comment
Metadata
Permission
```

---

# 40. Sync Protocol

独自の、

```text
KOMYAKU Sync Protocol
```

を定義する。

基本単位をObjectとする。

```text
Client
 ↓
Have:
A
B
C

Server
 ↓
Need:
D
E
```

のように必要なObjectだけ転
