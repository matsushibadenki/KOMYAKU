# KOMYAKU — 多言語ドキュメント・バージョン管理プラットフォーム 設計仕様書

## 0. 文書情報

プロジェクト名：**KOMYAKU / 稿脈**

文書目的：Codexおよび開発者が、本仕様を基準としてKOMYAKUのMVPを設計・実装できる状態にする。

プロダクト定義：

> KOMYAKUは、文章の完成状態だけではなく、文章がどのように生まれ、変更され、分岐し、採用・却下されたかという「稿脈」を保存・可視化する、多言語対応ドキュメント・バージョン管理プラットフォームである。

中心概念：

**Document Evolution Graph**

GitのCommit / Branch / DAGという優れた考え方を文書制作向けに再設計し、Gitそのものをユーザーに操作させない。

---

# 1. プロダクト原則

KOMYAKUは以下の原則を最優先する。

### 1.1 文書を失わない

入力中、保存中、同期中、サーバー障害時、誤操作時のいずれにおいても、可能な限りユーザーの文章を失わない設計とする。

### 1.2 過去を書き換えない

確定したVersionはImmutableとする。

Versionを変更するのではなく、必ず新しいVersionを生成する。

```text
V1 → V2 → V3
```

V2を編集した場合もV2を書き換えず、

```text
V1 → V2 → V3
      \
       V4
```

とする。

### 1.3 履歴そのものを第一級データとする

履歴はバックアップ機能ではない。

Document、Version、Version間の関係、変更理由、Branch、時刻、作者などをKOMYAKUの中心データとして扱う。

### 1.4 GitをUIに露出しない

内部思想として、

- Commit
- Branch
- DAG
- Merge
- Snapshot
- Content Hash

を参考にする。

ただしUIでは、

- Version → 版
- Branch → 別案
- Commit → 版を保存
- Checkout → この版を見る
- Revert → この版から復元
- Merge → 案を統合

など、人間の文章制作に即した表現を使用する。

### 1.5 ローカルファースト

ネットワーク障害が発生していても文章を書き続けられること。

クラウドとの通信成功を「入力保存」の前提条件にしない。

### 1.6 Internationalization First

多言語対応は後付け機能ではなく、データモデルの基礎要件とする。

UI言語と、ユーザーが文書内で使用する言語は完全に分離する。

---

# 2. 対応プラットフォーム

Tauri 2をアプリケーション基盤として使用する。

Tauri 2はWebフロントエンドとRust側ロジックを組み合わせ、macOS / Windows / Linux / iOS / Androidを対象にできる。

対象：

```text
Web
macOS
Windows
Linux
iOS
Android
```

MVP優先順位：

```text
1. Web
2. macOS
3. Windows
4. Linux
5. iOS
6. Android
```

ただしコード構造は初期段階から全プラットフォーム対応可能な状態とする。

---

# 3. 技術スタック

## 3.1 Frontend

```text
Tauri 2
React
Vite
JavaScript
CSS
```

TypeScriptは必須としない。

UI：

```text
React
CSS Variables
CSS logical properties
Intl APIs
i18next
```

i18nextはfallback languageを含む言語解決モデルを持つため、初期3言語から将来の言語追加へ拡張しやすい。

---

# 4. Backend

```text
Bun
Hono
PostgreSQL
S3-compatible Object Storage
```

HonoはBunを正式に実行環境としてサポートしている。

BunにはPostgreSQLを含むSQLデータベース用APIが存在する。

構成：

```text
Client
   │
   │ HTTPS
   ▼
Bun
   │
   └ Hono
       │
       ├ Auth API
       ├ Workspace API
       ├ Project API
       ├ Document API
       ├ Version API
       ├ Branch API
       ├ Diff API
       ├ Sync API
       ├ Search API
       ├ Export API
       └ Audit API
```

---

# 5. 全体アーキテクチャ

```text
┌────────────────────────────────────┐
│             Tauri 2                │
│                                    │
│ React + Vite                       │
│ ├ Editor                           │
│ ├ Version Graph                    │
│ ├ Diff Viewer                      │
│ ├ Document Browser                 │
│ ├ Search                           │
│ └ Settings                         │
│                                    │
│ Local Layer                        │
│ ├ SQLite                           │
│ ├ Draft Cache                      │
│ ├ Recovery Snapshots               │
│ └ Sync Queue                       │
└──────────────────┬─────────────────┘
                   │
                HTTPS
                   │
┌──────────────────▼─────────────────┐
│             Bun + Hono             │
│                                    │
│ Application Services               │
│ ├ Auth Service                     │
│ ├ Document Service                 │
│ ├ Version Engine                   │
│ ├ Diff Engine                      │
│ ├ Sync Engine                      │
│ ├ Permission Engine                │
│ └ Export Engine                    │
└───────────┬───────────┬────────────┘
            │           │
            ▼           ▼
      PostgreSQL    Object Storage
            │           │
            │           ├ Snapshots
            │           ├ Assets
            │           └ Backup
            │
            ▼
       Audit / DAG

Optional interoperability
            │
            ▼
           Git
       GitHub Export
       Git Import
       Git Sync
```

## 5.1 Deployment Evolution

初期は単一Server Processで運用する。

```text
Client
  ↓
Single Bun / Hono Server
  ├ PostgreSQL
  └ S3-compatible Object Storage
```

ただしApplicationは初期からStateless APIとDurable Worker境界へ分離可能なModular Monolithとする。

規模拡大時：

```text
Client
  ↓
Load Balancer
  ├ API Replica A ─┐
  ├ API Replica B ─┼── PostgreSQL / Shared Cache
  └ API Replica C ─┘            │
                                ├── Object Storage
Durable Queue / Outbox          │
  ├ Worker: snapshot ───────────┤
  ├ Worker: diff ───────────────┤
  ├ Worker: export ─────────────┤
  └ Worker: search ─────────────┘
```

初期の単一Serverと将来のReplicaが同じApplication Service、Domain Service、Repository Interfaceを利用する。分散化のためにDomain Logicを書き直さない構造を目標とする。

---

# 6. Gitの位置付け

GitをKOMYAKUの主データベースにしない。

KOMYAKU内部では独自Version DAGを実装する。

Gitは将来的な、

```text
Import
Export
Backup
GitHub Sync
Interoperability
```

用途に限定する。

抽象インターフェイス：

```text
VersionEngine

createVersion()
createBranch()
getVersion()
getHistory()
getAncestors()
getDescendants()
compareVersions()
restoreVersion()
mergeVersions()
```

将来的には、

```text
VersionStore
├ PostgreSQLVersionStore
└ GitVersionStore
```

のように交換可能な設計とする。

---

# 7. データ階層

基本階層：

```text
User
  ↓
Workspace
  ↓
Project
  ↓
Document
  ↓
Branch
  ↓
Version
```

個人ユーザーであってもPersonal Workspaceを自動生成する。

これにより企業対応を後から追加してもデータモデルを変更しない。

---

# 8. Version DAG

VersionはNodeとして扱う。

Version間の親子関係をEdgeとして扱う。

```text
V1
 ↓
V2
 ↓
V3 ─────────→ V3-A
 ↓               ↓
V4              V3-B
 ↓
V5
```

MergeされたVersionは複数のParentを持てる。

```text
V5 ────┐
       ├── V7
V6 ────┘
```

そのため、

```text
version_parents
```

を独立テーブルとする。

Versionテーブル内に単一の`parent_id`だけを持たせてはならない。

---

# 9. PostgreSQL基本スキーマ

最低限以下のEntityを作成する。

```text
users
user_sessions

workspaces
workspace_members

projects

documents
document_members

document_shares
document_share_links

branches

versions
version_parents

recovery_snapshots

assets

permissions
audit_logs

user_preferences

plans
plan_entitlements
billing_customers
subscriptions
workspace_usage
usage_ledger
archive_policies

idempotency_keys
outbox_events
jobs
job_attempts

conversations
conversation_messages
conversation_edges
conversation_imports
ai_provider_connections
ai_handoffs
```

将来的に、

```text
comments
reviews
merge_requests
semantic_changes
ai_operations
document_entities
```

を追加可能とする。

---

# 10. users

概念フィールド：

```text
id
email
display_name

interface_locale
timezone

created_at
updated_at
deleted_at
```

`interface_locale`は固定Enumにしてはならない。

BCP 47 language tagを文字列として保持する。

例：

```text
ja
ja-JP

en
en-US
en-GB

zh-Hans
zh-Hans-CN

ar
he
hi
th
```

---

# 11. UI Internationalization

初期UI対応言語：

```text
ja
en
zh-Hans
```

つまり、

- 日本語
- English
- 简体中文

とする。

コード上にUI文字列を直接記述してはならない。

禁止：

```text
<button>保存</button>
```

UIは必ずTranslation Keyを通す。

概念例：

```text
t("document.save")
t("version.restore")
t("branch.create")
```

Translation Resource：

```text
locales/
├ ja/
│  ├ common.json
│  ├ editor.json
│  └ version.json
│
├ en/
│  ├ common.json
│  ├ editor.json
│  └ version.json
│
└ zh-Hans/
   ├ common.json
   ├ editor.json
   └ version.json
```

言語を追加するとき、

```text
locales/fr/
locales/de/
locales/ko/
locales/ar/
```

を追加するだけで基本UIを拡張できる構造にする。

---

# 12. LocaleとLanguageを混同しない

以下は別データとして扱う。

```text
interface_locale
document_language
content_language
spellcheck_language
writing_direction
writing_mode
```

例：

日本人ユーザーが英語小説を書く場合：

```text
interface_locale = ja
document_language = en
```

英語UIを使用してアラビア語文書を書く場合：

```text
interface_locale = en
document_language = ar
direction = rtl
```

---

# 13. 本文言語の基本方針

KOMYAKUは「サポート言語一覧」をハードコードしない。

文書言語には任意のBCP 47形式タグを設定可能とする。

例：

```text
ja
en
zh-Hans
zh-Hant
ko

ar
he
fa

hi
bn
ta
te

th
vi

ru
uk

el

fr
de
es

haw
mi

sa
la
```

存在しないタグやユーザー独自タグについても、保存自体を妨げない設計を検討する。

---

# 14. 「全言語対応」の定義

KOMYAKUでは「全言語」を、

> Unicodeで表現可能であり、OSまたは利用環境に入力・表示手段が存在するテキストを、KOMYAKU側が不必要に拒否・破壊・Latin文字前提処理しないこと

と定義する。

世界にはUnicode化されていない文字、未符号化文字、私用文字、歴史的表記なども存在し得るため、「地球上に存在するあらゆる言語を100%表示できる」と保証してはならない。

一方、KOMYAKU自身には特定言語Whitelistを持たせない。

---

# 15. Unicode

全システムの基本文字エンコーディング：

```text
UTF-8
```

PostgreSQL Database EncodingもUTF8とする。

PostgreSQLはUTF8を含むmultibyte character encodingを扱える。

HTTP：

```text
application/json; charset=utf-8
text/plain; charset=utf-8
text/html; charset=utf-8
```

Exportも原則UTF-8とする。

---

# 16. Unicode Normalization

ユーザーの原文を保存時に無条件でNFKCなどへ変換してはならない。

原稿そのもの：

```text
original_content
```

は可能な限り入力された文字列を保持する。

検索・比較用には別途Normalization Viewを生成してよい。

推奨：

```text
Storage:
exact authored Unicode content

Search projection:
NFC

Identifier/search special projection:
必要に応じて別途生成
```

UnicodeではNFC/NFD/NFKC/NFKDというNormalization Formが定義される。

特にNFKCは互換文字を統合するため、本文原稿を無条件NFKC変換しない。

---

# 17. Grapheme Cluster

KOMYAKUでは、

```text
JavaScript string.length
```

を「文字数」として扱ってはならない。

ユーザーが認識する1文字とUnicode code point、UTF-16 code unitは一致しない場合がある。

Unicode Text Segmentationではgrapheme cluster、word、sentenceの境界が定義されている。

ブラウザ環境では可能な限り、

```text
Intl.Segmenter
```

を使用する。

`Intl.Segmenter`はlocale-sensitiveなgrapheme / word / sentence segmentationを提供する。

Diff、文字数、カーソル単位などではgrapheme clusterを意識する。

---

# 18. 多言語Diff Engine

Diff Engineを「行単位Git Diff」のみに依存させてはならない。

最低限：

```text
Paragraph Diff
Sentence Diff
Word Diff
Grapheme Diff
```

のレイヤーを持てる設計とする。

日本語、中国語、タイ語などではスペース区切りを単語境界とみなしてはならない。

概念：

```text
Document
 ↓
Block segmentation
 ↓
Sentence segmentation
 ↓
Word segmentation
 ↓
Grapheme segmentation
 ↓
Diff
```

Segmenterが利用できない場合はgrapheme-safe fallbackを設ける。

---

# 19. Bidirectional Text

LTRだけを前提としない。

対応方向：

```text
ltr
rtl
auto
```

Unicode Bidirectional Algorithmを尊重する。

HTMLレンダリングでは必要に応じて、

```text
lang
dir
```

属性を使用する。

W3CもRTL文書では基底方向を`dir="rtl"`等で指定する方法を示している。

CSSでは、

```text
margin-inline
padding-inline
inset-inline
border-inline
```

などlogical propertiesを優先し、

```text
margin-left
margin-right
```

依存を極力避ける。

RTL UIでも破綻しないレイアウトを目標とする。

---

# 20. Mixed Direction

一つの文書や段落内で、

```text
Arabic + English
Hebrew + numbers
Japanese + English
```

が混在することを前提とする。

例：

```text
هذا مثال React 19 للتوضيح.
```

BiDi制御文字を不用意に削除・再配置しない。

Diff表示についてもLogical OrderとVisual Orderを混同しない。

---

# 21. 縦書き

MVPでは編集機能として必須にしない。

しかしデータモデルでは最初から、

```text
writing_mode
```

を持てるようにする。

想定：

```text
horizontal-tb
vertical-rl
vertical-lr
```

日本語組版では縦書きと横書きで文字、行、ページ進行方向などが異なる。

将来、

```text
writing-mode: vertical-rl
```

を利用した縦書きViewer / Editorへ拡張できる構造とする。

---

# 22. Ruby / Annotation

日本語：

```text
漢字
ふりがな
```

中国語：

```text
汉字
拼音
```

などのannotationを後付けできるDocument Schemaを採用する。

本文中にHTML文字列を直接埋め込む方式は避ける。

概念：

```text
text node
└ annotations
   └ ruby
      ├ base
      └ reading
```

---

# 23. Editor Document Model

文書本文を単なる巨大HTML文字列として保存しない。

内部Canonical Document Formatは構造化JSONとする。

推奨Editor Core：

**ProseMirror系Document Model**

ProseMirrorはSchemaによってdocument modelのnodeとmarkを定義する構造を持つ。

Canonical例：

```text
Document
├ paragraph
│ ├ text
│ └ text
├ heading
├ blockquote
├ list
└ paragraph
```

ただしProseMirror固有JSONを永続フォーマットに直接固定しすぎない。

KOMYAKU独自のDocument Schema Versionを持つ。

```text
schema_version
```

をすべてのVersion Snapshotへ保存する。

Canonical Document Schema v1とProseMirror変換境界は実装済みである。正確なField、Node Registry、互換性規則、制限値は`docs/formats/canonical-document-v1.md`を正本とする。ProseMirror JSONは編集用Projectionであり、永続形式の正本ではない。

---

# 24. Document Schema Versioning

Editor Schemaは将来変更される。

したがって、

```text
schema_version = 1
```

を各snapshotに保存する。

Schema変更時：

```text
v1 document
 ↓
migration
 ↓
v2 document
```

とする。

過去Versionそのものは破壊しない。

必要に応じてViewer側でmigrationしたrepresentationを生成する。

Migrationは未知Nodeや将来Versionを黙って破棄しない。表現できない情報がある場合は明示的に失敗し、変換成功を装ったData Lossを防ぐ。

---

# 25. 文書基本Node

MVP：

```text
document

paragraph
heading
text

blockquote

bullet_list
ordered_list
list_item

hard_break
horizontal_rule
```

Mark：

```text
bold
italic
underline
strike
code
link
```

Language metadata：

```text
lang
dir
```

をblockまたはinline rangeへ設定可能な拡張余地を持つ。

## 25.1 特殊文書・埋め込みコンテンツ

KOMYAKUは通常の文章に加え、技術文書や学術文書で使われる特殊コンテンツを扱えるようにする。

MVPで扱う形式：

```text
LaTeX source document
LaTeX math block / inline math
Mermaid diagram block
PDF attachment / viewer
```

LaTeXとMermaidは、生成済みHTMLや画像だけでなく、ユーザーが入力したソースをCanonical Snapshotへ保存する。

概念Node：

```text
code_block
math_inline
math_block
mermaid_block
attachment
pdf_embed
```

レンダリング結果は再生成可能な派生データとして扱い、Versionの原本にしない。

```text
authored source
 ↓
sanitized renderer
 ↓
preview artifact / cache
```

LaTeX文書全体を扱う場合は、原文、関連Asset、コンパイル設定、生成PDFを関連付ける。生成PDFは原文と同一視せず、どのVersionから生成されたかを記録する。

MermaidのソースおよびLaTeX由来の出力を信頼済みHTMLとして直接実行してはならない。外部リンク、HTML label、script、危険なURI、コンパイラのファイルアクセス等を制限し、sandboxまたは分離されたWorkerでレンダリングする。

PDFは本文JSONへBase64埋め込みせずObject Storageへ保存する。MVPでは閲覧、ダウンロード、Versionへの関連付けを優先し、PDF内部の直接編集は対象外とする。

Diffは形式に応じて分離する。

```text
LaTeX / Mermaid source: grapheme-safe source diff
Structured text: paragraph / word / grapheme diff
PDF binary: metadata / file hash / generated-source relation
```

## 25.2 First-class Content Node

文章以外を一律の添付ファイルとして扱わず、対応する形式はCanonical Document Schemaの第一級Nodeとして扱う。

```text
Document
├ Text / Heading / List
├ Table
├ Math / LaTeX
├ Code
├ Diagram / Basic SVG / Mermaid
├ Image / Illustration
└ Generic File / PDF / Design Asset
```

各Blockは少なくとも、安定した`id`、`type`、`schema_version`、`metadata`を持つ。画像と図には`alt_text`と`caption`を設定可能にし、表示言語はDocumentまたはBlockの`lang`で管理する。

コンテンツは次の責務を分離する。

```text
Content Node
├ canonical source / data
├ render representation reference
├ asset references
├ metadata / accessibility
└ version lineage
```

Preview、生成SVG、生成PDF等は再生成可能な表現であり、原文または編集可能なCanonical Dataを置き換えない。

## 25.3 Document VersionとNode履歴

MVPではImmutable Document SnapshotをVersionの正本とする。各Nodeの安定IDをVersion間で維持し、そのIDと内容HashからNode単位の系譜を導出する。

```text
Document V18                  Document V19
├ Paragraph A (stable ID)  →  ├ Paragraph A (unchanged)
├ Equation B  (stable ID)  →  ├ Equation B  (changed)
└ Figure C    (stable ID)  →  └ Figure C    (unchanged)
```

Node revision番号やNode履歴Tableは、検索や性能のためのProjectionとして将来追加できる。ただし、それらだけを復元の正本にはしない。これによりAtomic Snapshot、Offline編集、Schema Migrationを単純に保ちながら、「Figure 3が追加・変更されたVersion」を追跡できる。

Versionには変更内容を表す`change_kinds`を付与できるようにする。

```text
TEXT
MATH
DIAGRAM
IMAGE
TABLE
CODE
ASSET
STRUCTURE
```

Graph表示は色だけに依存せず、Label、Icon、Shapeを併用する。

## 25.4 Content-type Diff

Diffは共通DispatcherからNode形式別Engineへ振り分ける。

```text
Diff Dispatcher
├ Text Diff
├ Math Source / Semantic Diff
├ Diagram Node / Edge Diff
├ Image Side-by-side / Overlay Diff
├ Table Diff
├ Code Diff
└ Binary Asset Metadata Diff
```

MVPではText、LaTeX/Mermaid source、CodeをGrapheme-safeに比較し、Binary Assetは追加・置換・削除・Media Type・Size・Hashの変化を示す。Math semantic Diff、Diagram構造Diff、Image visual Diffは後続Stageで追加する。

---

# 26. MVPで扱わない高度な組版

MVP対象外：

```text
本格DTP
多段組
ページ組版
脚注自動組版
高度な数式組版
EPUB完全互換
Word完全互換
縦書き編集
複雑なruby
warichu
専門出版組版
```

ただしCanonical Schemaが後から拡張可能であること。

---

# 27. Local First Architecture

入力：

```text
Keyboard / IME
 ↓
Editor Memory
 ↓
Local Draft
 ↓
Local SQLite
 ↓
Sync Queue
 ↓
Cloud
```

サーバー接続失敗で文章入力を止めない。

Local DBに最低限：

```text
local_documents
local_drafts
local_snapshots
sync_queue
sync_state
```

を持つ。

---

# 28. IME

日本語、中国語、韓国語などのIME compositionを正しく扱う。

`compositionstart`

↓

`compositionupdate`

↓

`compositionend`

の途中状態を通常の確定Versionとして保存しない。

IME変換途中にDiffやAutosave処理がDOMを書き換えてcompositionを壊さないようにする。

---

# 29. Auto Save

3種類を分離する。

### Draft State

非常に短い間隔。

ローカル中心。

### Recovery Snapshot

数秒〜数十秒単位。

クラッシュ復旧目的。

### Named Version

Version Graphに表示する意味のある版。

概念：

```text
typing
 ↓
Draft
 ↓
Recovery
 ↓
Named Version
```

---

# 30. Version Graph

KOMYAKUの中心UI。

VS Code Git Graphに近い、

```text
●
│
●
│\
│ ●
│ │
● │
│/
●
```

形式を採用する。

ただしコード開発者向け情報ではなく、文書向け情報を表示する。

例：

```text
● 第8稿
│ 主人公と父親の会話を修正
│ 15:42
│
├──● 結末A
│
● 第9稿
│
└──● 編集案
```

---

# 31. Version Graph Node

Version Nodeに表示可能な情報：

```text
Version title

Author
Created time

Branch
Change summary

Added graphemes
Removed graphemes

Milestone status
Publication status
```

MVPでは：

```text
title
time
branch
author
```

程度から開始する。

---

# 32. Graph操作

MVP：

```text
Select Version
Compare
Restore
Create Alternative
Rename Version
Add Note
```

将来：

```text
Merge
Review
Semantic History
Filter
Search Graph
AI analysis
```

---

# 33. Branch

内部：

```text
branch
```

UI：

```text
別案
```

BranchはVersionを複製するものではない。

Branchは、

```text
head_version_id
```

を保持するlightweight referenceとする。

---

# 34. Version Snapshot

Version作成時には完全なDocument Snapshotを復元可能な形で保存する。

最低メタデータ：

```text
version_id

document_id
branch_id

schema_version

created_at
created_by

title
note

content_hash
graph_hash
```

---

# 35. Content Hash

Version contentに対してcryptographic hashを生成する。

推奨：

```text
SHA-256
```

目的：

```text
corruption detection
integrity verification
deduplication assistance
export verification
```

Hashは認証そのものではない。

---

# 36. Graph Hash

Version自身のcontent hashとparent hash群からgraph hashを生成できる構造を設ける。

概念：

```text
graph_hash =
hash(
    schema_version
    content_hash
    sorted(parent_graph_hashes)
    immutable_metadata
)
```

これによりVersion Graphの改ざん・破損検出能力を向上させる。

MVPでGraph HashをUI表示する必要はない。

---

# 37. Snapshot Storage

PostgreSQLのみを唯一の本文保存場所としない。

推奨：

```text
PostgreSQL
    metadata

Object Storage
    immutable snapshots
```

PostgreSQL：

```text
version graph
metadata
permissions
audit
indexes
```

Object Storage：

```text
document snapshots
attachments
exports
```

---

# 38. Object Storage

S3 compatible APIを前提とする。

Object key例：

```text
workspaces/{workspaceId}/documents/{documentId}/versions/{versionId}.json
```

Object名に文書タイトルを使用しない。

ユーザー入力をStorage Pathへ直接使用しない。

---

# 39. Backup

最低3層：

```text
Primary Database
 ↓
PITR / Database Backup

Object Storage
 ↓
Object Versioning

Independent Backup
 ↓
Separate retention
```

バックアップを取るだけではなく、

```text
Restore Test
```

を定期実施する。

---

# 40. Disaster Recovery

定期的に自動復元試験を実施可能な設計とする。

例：

```text
Random Backup Sample
 ↓
Restore
 ↓
Hash Verification
 ↓
Version DAG Reconstruction
 ↓
Document Rendering
 ↓
Success / Alert
```

---

# 41. Export

ユーザーのデータをKOMYAKUにロックインしない。

必須Export：

```text
Plain Text
Markdown
JSON
KOMYAKU Archive
```

将来：

```text
DOCX
PDF
EPUB
Git Repository
```

Conversationを扱う場合は、Provider非依存JSON、Markdown、Plain TextをExport可能にする。Importした原本も、権利とProvider規約の範囲で再取得可能にする。

---

# 42. KOMYAKU Archive

独自Archive例：

```text
novel.komyaku
```

実体は標準的なArchive形式を使用する。

`.komyaku`は公開されたOpen Formatとし、KOMYAKU本体だけが読み書きできる非公開形式にしない。最初の実装と同時に、少なくとも次を`docs/formats/komyaku-archive-format.md`へ公開する。

```text
format identifier / media type
container and compression rules
directory layout and path safety rules
manifest and graph schemas
canonical document schema references
asset hashing and integrity verification
required and optional fields
extension and unknown-field handling
format versioning and compatibility policy
security limits
deterministic conformance fixtures
```

仕様書は実装Codeから推測しなければならない状態にせず、JSON Schema等の機械可読Schemaと、最小Archive・分岐・Merge・Asset・未知拡張を含むTest Fixtureを併記する。第三者実装がKOMYAKU Serverへ接続せずArchiveを検査・復元できることを受け入れ条件とする。

内部：

```text
manifest.json

documents/
    document.json

versions/
    {version-id}.json

graph/
    graph.json

assets/
```

KOMYAKUサービスが存在しなくなっても、ユーザーがVersion Historyを復元できる構造を目標とする。

---

# 43. Authentication

MVP：

```text
Email
Password
Session
Email verification
Password reset
```

設計段階から将来：

```text
Passkey
OAuth
MFA
OIDC
SAML
SCIM
```

を追加可能にする。

Passwordを独自暗号方式で実装しない。

---

# 44. Session Management

Sessionをユーザー単位で管理する。

将来UI：

```text
Current device

MacBook
iPhone
Chrome Windows
```

操作：

```text
Revoke session
Logout all devices
```

---

# 45. Workspace

全Userは少なくとも一つのWorkspaceに属する。

個人登録時：

```text
User
 ↓
Personal Workspace
```

を自動作成する。

---

# 46. Permission Model

内部モデル：

```text
Owner
Admin
Editor
Reviewer
Viewer
```

MVP UIでは主にOwnerのみ使用してよい。

しかしDatabase Schemaを単一所有者前提にしてはならない。

## 46.1 Document Visibility

Documentは次の公開範囲を持つ。

```text
private
restricted
unlisted
public
```

新規Documentの既定値は必ず`private`とする。

各公開範囲の意味：

```text
private
    OwnerおよびWorkspace内で明示的な権限を持つUserのみ

restricted
    Documentへ明示的に許可されたUserのみ

unlisted
    有効な秘密共有URLを知っているUserのみ

public
    認証なしで誰でも閲覧可能
```

`private`と`restricted`は認証およびPermission Modelに基づきBackendでアクセスを検証する。`unlisted`はURL内の推測困難な秘密Tokenを検証する。`public`は認証なしで公開用Viewerから閲覧可能とする。

どの公開範囲でも、編集、版の作成、復元、共有設定の変更は権限を持つ認証済みUserに限定する。MVPの共有権限は閲覧専用から開始し、編集共有と混同しない。

公開対象は原則としてDocumentの明示的に指定された公開Versionとする。作業中Draft、Recovery Snapshot、非公開Branch、過去Version、Audit Log、作者の非公開情報を自動公開してはならない。

概念フィールド：

```text
visibility = private | restricted | unlisted | public
published_version_id
public_slug
published_at
published_by

ai_training_policy = deny | allow
```

許可Userは`document_shares`で管理する。

```text
document_id
user_id
role = viewer
created_at
created_by
revoked_at
```

秘密共有URLは`document_share_links`で管理する。

```text
id
document_id
token_hash
published_version_id
expires_at
max_uses
use_count
created_at
created_by
revoked_at
```

生の共有Tokenは作成時に一度だけ返し、DatabaseにはTokenのHashを保存する。共有URLは複数発行可能とし、リンクごとに失効、有効期限、任意の利用回数制限を設定できる構造にする。

`restricted`の許可Userを解除した場合と、秘密共有URLを失効した場合は、新規アクセスを即時拒否する。秘密共有URLをApplication Log、Analytics、Referer、検索Indexへ記録・送信しない。

`public_slug`は推測困難で一意な値とし、Document titleや連番IDをそのまま使用しない。公開から非公開への変更は即時に新規アクセスを拒否し、CDNやViewer Cacheを無効化できる設計にする。

Version履歴やVersion Graphを公開するかは本文公開とは別のPolicyとして扱う。MVPでは公開Versionの閲覧のみを既定とし、履歴全体は公開しない。

---

# 47. Audit Log

重要操作をAudit Logへ記録する。

```text
actor
action
resource_type
resource_id

timestamp

ip metadata
device metadata
```

例：

```text
DOCUMENT_CREATED
VERSION_CREATED
VERSION_RESTORED
BRANCH_CREATED
DOCUMENT_DELETED
DOCUMENT_EXPORTED
DOCUMENT_PUBLISHED
DOCUMENT_UNPUBLISHED
PUBLIC_VERSION_CHANGED
DOCUMENT_SHARE_GRANTED
DOCUMENT_SHARE_REVOKED
SHARE_LINK_CREATED
SHARE_LINK_REVOKED
CONVERSATION_IMPORTED
CONVERSATION_EXPORTED
AI_CONNECTION_CREATED
AI_CONNECTION_REVOKED
AI_HANDOFF_PREVIEWED
AI_HANDOFF_SENT
AI_HANDOFF_CANCELED
LOGIN
LOGOUT
```

Audit Log自体を通常ユーザー操作で編集できないようにする。

---

# 48. Soft Delete

重要データは即時物理削除しない。

```text
active
 ↓
trashed
 ↓
retention
 ↓
purged
```

Document削除：

まずTrashへ移動する。

Versionについても参照整合性を保つ。

---

# 49. Security Boundary

Workspace境界を必ずBackendで検証する。

FrontendのUI非表示をPermission enforcementとして扱ってはならない。

すべてのAPIで：

```text
Authenticated User
       ↓
Workspace Membership
       ↓
Resource Permission
       ↓
Operation
```

を検証する。

公開Viewer APIは、Documentが`public`であり要求対象が`published_version_id`と一致することをBackendで検証して、認証なしの読み取りを許可する。

限定共有Viewer APIは、`restricted`では認証済みUserの`document_shares`を検証し、`unlisted`では秘密TokenのHash、有効期限、失効状態、利用回数を検証する。Token検証前にDocumentやVersionの存在を示す情報を返してはならない。

非公開Document、Draft、Recovery Snapshot、非公開Version、Assetの存在を、検索結果、連番、エラー差、Object Storage URL、ログ、キャッシュから推測できないようにする。

---

# 50. API設計

Base：

```text
/api/v1/
```

例：

```text
POST   /auth/login
POST   /auth/logout

GET    /workspaces
GET    /projects

GET    /documents
POST   /documents

GET    /documents/:id

GET    /documents/:id/versions
POST   /documents/:id/versions

GET    /versions/:id

GET    /documents/:id/branches
POST   /documents/:id/branches

POST   /versions/:id/restore

POST   /diff

POST   /sync

PATCH  /documents/:id/visibility
PUT    /documents/:id/publication
DELETE /documents/:id/publication

GET    /documents/:id/shares
POST   /documents/:id/shares
DELETE /documents/:id/shares/:userId

GET    /documents/:id/share-links
POST   /documents/:id/share-links
DELETE /documents/:id/share-links/:shareLinkId

GET    /public/documents/:publicSlug
GET    /shared/documents/:shareToken

POST   /conversation-imports
GET    /conversation-imports/:id
GET    /conversations/:id
GET    /conversations/:id/graph
POST   /conversations/:id/exports

GET    /ai-connections
POST   /ai-connections
DELETE /ai-connections/:id

POST   /conversations/:id/handoffs/preview
POST   /conversations/:id/handoffs
GET    /ai-handoffs/:id
POST   /ai-handoffs/:id/cancel

GET    /health/live
GET    /health/ready
```

---

# 51. API Versioning

APIの破壊的変更に備える。

```text
/api/v1
/api/v2
```

とする。

Document Schema VersionとAPI Versionは別物。

---

# 52. ID

外部公開EntityのIDには連番integerを使用しない。

推奨：

```text
UUIDv7
```

または同等のsortable unique identifier。

DB内部最適化のため別surrogate keyを使用する余地は残す。

---

# 53. Time

Database内timestamp：

```text
UTC
```

ユーザー表示：

```text
user timezone
```

APIではISO 8601互換形式を使用。

UI表示は`Intl.DateTimeFormat`等のlocale-aware APIを使用する。

---

# 54. 数値・日時・複数形

翻訳JSONに、

```text
"3 versions"
```

のような組み立て文字列を直接作らない。

Locale-aware formattingを使用する。

対象：

```text
Date
Time
Number
Plural
Relative Time
List
```

UI言語追加時にもコード変更を最小化する。

---

# 55. Search

MVP：

```text
document title
current document body
```

将来：

```text
all versions
deleted text
version notes
semantic search
```

へ拡張する。

検索処理でLatin alphabet前提のtokenizationをしない。

---

# 56. Search Normalization

検索Index用文字列と原文を分離する。

```text
Original
 ↓
Search Projection
 ↓
Index
```

Search Projectionの変更によってOriginal Documentを変更してはならない。

---

# 57. Document Metadata

基本：

```text
id
workspace_id
project_id

title

default_language
default_direction
default_writing_mode

content_kind
visibility
published_version_id
public_slug
published_at
published_by

created_by
created_at
updated_at

current_branch_id
current_version_id
```

`content_kind`は少なくとも次へ拡張できる文字列とする。

```text
structured_document
latex_document
conversation
```

---

# 58. 文書内複数言語

Documentにはdefault languageを持たせる。

しかしblock単位・inline単位でoverride可能なSchemaにする。

例：

```text
Document: ja

Paragraph 1: ja
Paragraph 2: en
Paragraph 3:
    ja
    inline Arabic: ar / rtl
```

これにより翻訳文、語学教材、学術文書なども扱える。

---

# 59. Attachments

MVPでは画像とPDFを扱う。

AttachmentはDocument JSONへBase64埋め込みしない。

Object Storageへ保存し、

```text
asset_id
```

で参照する。

Attachment metadataには最低限、`media_type`、`byte_size`、`content_hash`、`storage_key`、`created_by`を持たせる。PDFの公開可否はDocumentの公開設定だけで暗黙に決めず、公開Versionから参照され、かつ公開可能と判定されたAssetだけを短時間URLまたは認証済み配信APIで提供する。

大容量AssetはContent Hashによる重複排除を行う。同じAssetを複数Versionから参照してもObjectを複製せず、Document SnapshotにはAsset参照を保存する。Workspace UUIDとSHA-256から決まるObject Key、条件付きImmutable Write、PostgreSQLの部分Unique Indexによる基盤は実装済みである。

重複排除の境界は当初Workspace内とし、Hash一致をAccess権限として扱わない。異なるTenantに同一Contentが存在する事実を推測できるResponse、Timing、APIを提供しない。Asset削除は参照数、Trash、Retention Policy、公開Version、法的保持を確認してから行う。参照解除ではObjectを即時削除せず`released_at`を記録し、物理削除は隔離・Retention Jobへ委ねる。Original、Preview、Generated Artifactには派生関係と生成元Versionを記録する。実装と運用境界は`docs/architecture/content-addressed-assets.md`を参照する。

Asset Lifecycle基盤は`active -> quarantined -> purging -> deleted`を明示し、参照ゼロAssetとObject Storage上の孤立Objectを即時削除しない。Workspace Prefixの走査はPage単位に制限し、未知Objectは永続的な隔離記録へ登録する。削除WorkerはPostgreSQLで候補をClaimした後、Workspace Prefix、SHA-256 Key、Hashを再検証して正確なObjectだけを削除する。同時Asset登録はWorkspaceとHash単位のTransaction Lockで直列化し、削除中の再登録はFail Closedとして再試行させる。全操作はOperator identityと理由を必須とし、本文やProvider Errorを含まないAudit Summaryを残す。

Content-addressed Assetは`pending -> inspecting -> accepted | rejected | error`のLease付きInspection状態を持つ。Baseline Policyは最大64KiBのRange ReadでPNG、JPEG、GIF、WebP、PDFのSignatureを宣言Media Typeと照合し、Text / JSONは全体を検査できる場合だけ受理する。SVG、未知Binary、不完全な大容量Textは、安全なRendererまたは外部Malware Scannerが接続されるまでFail Closedとする。この判定をAntivirus証明とは呼ばない。

Private / restricted Workspace向けDownloadは、Verified Userの有効Membership、`active` Lifecycle、`accepted` Inspectionを同一Database Queryで検証してから、既定60秒のSigned URLを発行する。Object Storage Responseは`attachment`、`application/octet-stream`、`private, no-store`へ固定し、API ResponseへStorage KeyやContent Hashを含めない。未認可、未検査、拒否、隔離、削除、存在しないAssetは同じNot Available Responseとする。Public / unlisted公開とInline Previewは別のPublication / Isolated Renderer Policyで実装する。

---

# 60. Diff Storage

DiffをVersionの唯一の保存形式にしない。

Canonical VersionはSnapshot。

Diffは、

```text
computed artifact
cache
```

として扱う。

Versionを復元するために全Diffを順番に適用しなければならない設計を避ける。

---

# 61. Recovery Snapshot

Recovery SnapshotとNamed Versionを別テーブルまたは明確に別種別として扱う。

Recovery：

```text
short-lived
automatic
high frequency
```

Named Version：

```text
immutable
long-term
graph-visible
user meaningful
```

---

# 62. Sync

同期単位：

```text
document_id
base_version_id
local_revision
```

Network切断中の編集を許可する。

MVPでは複数端末で同時編集された場合に完全自動Mergeを要求しない。

競合時：

```text
Device A Version
Device B Version
```

としてBranchを自動生成してもよい。

文章を消すより分岐させることを優先する。

---

# 63. Conflict Philosophy

KOMYAKUでは、

> Conflict is a branch, not data loss.

を基本原則とする。

競合が解消できない場合：

```text
Main
 ├ Device A changes
 └ Device B changes
```

として両方を保存する。

---

# 64. MVP UI

最低限4画面。

### Library

```text
Workspace
Project
Documents
```

### Editor

```text
Document
Editor
LaTeX / Mermaid source blocks
PDF attachment / viewer
Save Version
Visibility / Publish control
```

### Version Graph

```text
Graph
Version metadata
```

### Diff Viewer

```text
Old
New
Changes
```

---

# 65. Desktop基本レイアウト

```text
┌──────────┬───────────────┬──────────────┐
│ Library  │ Version Graph │ Editor       │
│          │               │              │
│ Projects │ ●             │ Document     │
│ Docs     │ │             │              │
│          │ ●             │ Text...      │
│          │ │\            │              │
│          │ │ ●           │              │
│          │ ● │           │              │
│          │ │/            │              │
│          │ ●             │              │
└──────────┴───────────────┴──────────────┘
```

GraphをKOMYAKUの視覚的アイデンティティとする。

---

# 66. Responsive

Mobileでは3ペインをそのまま縮小しない。

```text
Library
 ↓
Document
 ↓
Editor
 ↓
History
```

のNavigationに変換する。

---

# 67. Accessibility

最低限：

```text
Keyboard navigation
Semantic HTML
ARIA where necessary
Focus visibility
Screen reader labels
Reduced motion
High contrast compatibility
```

Graph情報を色だけで表現しない。

Node shape、line、labelなども併用する。

---

# 68. UI方向

スペーシー、SF的、過剰なGlass UIにはしない。

文書制作を邪魔しない落ち着いたインターフェイスとする。

中心は文章。

Graphは機能的な可視化とする。

---

# 69. MVP必須機能

実装する：

```text
User registration

Login
Logout

Personal Workspace

Project

Document create
Document edit

Local autosave

Cloud sync

Named Version create

Immutable Version

Version DAG

Version Graph

Alternative branch create

Version compare

Grapheme-safe Diff

Restore from version

Trash

Backup

Basic Export

LaTeX source
Mermaid source and preview
PDF attachment and viewer

Private document by default
Public document viewer
Publish / Unpublish
Restricted user sharing
Unlisted secret-link sharing
Share revocation

AI training opt-out enabled by default

UI:
ja
en
zh-Hans
```

## 69.1 Product Modeと料金思想

KOMYAKUの料金思想：

> **書くことと履歴を残すことは無料。クラウド、共同作業、高度解析に課金する。**

広告モデルは採用しない。文書への集中、機密性、Privacyを損なうため、本文内容を広告Targetingへ利用しない。

製品を次の2つの基本Modeに分ける。

```text
KOMYAKU Local
    無料
    Account不要
    Cloud接続不要
    Device容量の範囲で無制限

KOMYAKU Cloud
    Accountあり
    Free / Personal / Pro / Team / Enterprise
    Cloud Storageと高度機能をPlanごとに提供
```

KOMYAKU Localでは、少なくとも以下を恒久的な無料Coreとして扱う。

```text
Local Document
Local SQLite
Local Version History
Version Graph
Basic Diff
Alternative Branch
Restore
Basic Export
```

Local Coreを利用するために、定期的なLicense Server接続やCloud Account Loginを要求してはならない。

## 69.2 Plan設計

初期のPlan仮説：

```text
Free Cloud
    個人利用
    Cloud Storage 1GB
    複数端末同期
    基本Version Graph / Diff / Branch / Restore
    Web Access
    基本Export

Personal
    月額500〜900円程度を検証
    Cloud Storage 50GB
    長期履歴検索
    高度Diff
    小規模なAI補助枠
    高度Export

Pro
    月額1,000〜2,000円程度を検証
    Cloud Storage 200GB
    大規模Document / 大量Version向け性能枠
    高度検索
    Git連携
    DOCX / EPUB / PDF
    強化Backup

Team
    1 Userあたり月額1,500〜3,000円程度を検証
    Shared Workspace
    Collaboration
    Review
    Permission Management
    Audit Log
    UserまたはWorkspace単位のStorage

Enterprise
    個別契約
    SSO / SAML / SCIM
    Data Retention Policy
    Compliance Audit
    Dedicated Backup
    SLA
```

上記価格は市場調査、原価測定、税、決済手数料、地域別価格を反映する前の設計仮説であり、確定価格ではない。金額をDomain LogicへHard-codeしない。

## 69.3 Quota Philosophy

Version数を主な課金制限にしない。Version HistoryはKOMYAKUの中心価値であり、無料Userにも基本Version Graph、Diff、Branch、Restoreを提供する。

主なQuotaはCloud Storage容量とする。

```text
Billable Storage
    compressed immutable snapshots
    attachments
    retained generated artifacts
    trash during retention

Not separately billed
    internal database indexes
    ordinary replication overhead
    standard service backup copies
```

利用量はUserへ説明可能で再計算可能にする。Snapshot、Asset、Export等の内訳を表示し、内部都合のBackup複製数でQuotaが増減しないようにする。

Storage上限へ到達しても、Local編集とLocal Version作成を継続可能にする。Cloud側では新規UploadとSyncを保留できるが、既存Documentの閲覧、Export、Downloadを妨げない。

Plan Downgrade、支払い失敗、Quota超過だけを理由に、VersionやDocumentを即時削除してはならない。Grace Period、複数回通知、Export期間を設け、削除は別の明示的Retention Policyに従う。

## 69.4 Entitlement Architecture

UIへPlan名の条件分岐を散在させない。

禁止：

```text
if plan == "pro"
```

推奨：

```text
entitlements.can("history.advanced_search")
entitlements.limit("storage.cloud_bytes")
entitlements.limit("ai.monthly_credits")
```

概念的なEntitlement Key：

```text
cloud.sync
cloud.web_access
storage.cloud_bytes
history.advanced_search
diff.semantic
ai.monthly_credits
conversation.import
conversation.export
ai.handoff
ai.connection.personal
ai.connection.workspace
export.docx
export.epub
export.pdf
git.sync
collaboration.seats
review.workflow
audit.read
enterprise.sso
archive.long_term
api.monthly_operations
```

BackendをCloud Entitlementの最終Authorityとする。Frontend非表示だけで課金機能を保護しない。一方、Local CoreはCloud Entitlement Serviceから独立させる。

Plan、価格、通貨、税、Campaign、Subscription State、Entitlement、Usageを分離する。Payment Provider固有IDはAdapter境界へ隔離し、KOMYAKUのDomain Modelを特定Providerへ固定しない。

## 69.5 Metered Servicesと追加収益

実コストの大きい機能はPlanのStorageとは別のMeterを持てる。

```text
AI API usage
Email delivery
Large export rendering
API operations
Long-term Archive
Dedicated backup
Excess bandwidth
```

AI機能の課金同意とAI学習への利用同意は別である。無料・有料を問わず、Privacy、AI学習拒否、基本Export、データ取得手段をPaywallの内側へ置かない。

Long-term Archiveは追加Optionとして設計する。

```text
Standard Backup
    通常のService復旧目的

Long-term Archive
    長期Retention
    定期Integrity Check

Immutable Archive
    Retention Lock
    独立Copy
    Restore証跡
```

将来のDeveloper向けAPIは、KOMYAKUをVersion History Infrastructure as a Serviceとして提供できる構造にする。API UsageはOperation数、転送量、Storage量を個別にMeter可能にする。

---

# 70. MVPから外すもの

実装しない：

```text
AI writing
Semantic Diff
AI history search

Realtime collaboration

Comments
Reviews

Complex RBAC UI

Merge UI

SSO
SAML
SCIM

EPUB

Advanced DOCX

Professional PDF typesetting

Vertical writing editor

Full publishing platform

Social network

Plugin ecosystem

Marketplace
```

---

# 71. ただし将来対応を妨げてはならないもの

データ構造上は以下を想定する。

```text
Collaboration
AI
Semantic metadata

Publishing
Enterprise

Vertical writing

Ruby

Advanced math typesetting

Comments

Review

Merge

Translation workflow

Audio/video attachment

Conversation Archive
Provider-independent AI handoff
Local model connection
```

---

# 72. Phase 2

MVP後：

```text
Semantic Diff

AI change summary

Graph search

Version filtering

Document-wide search

Vertical Japanese viewer

Ruby

DOCX Import/Export

Git Export

Conversation log import
Canonical Conversation viewer
```

---

# 73. Phase 3

```text
Collaboration

Comments

Review

Merge

Publisher workflow

Advanced permissions

Audit UI
```

---

# 74. Phase 4

```text
Enterprise

SSO
SAML
SCIM

Compliance features

Organization management

API

GitHub integration

AI semantic history

Multi-provider AI handoff
Conversation branch comparison
```

---

# 75. AI将来構想

AIは文章生成よりもVersion History理解を優先する。

例：

```text
「主人公の職業を変更したのはいつ？」

「削除した伏線を探して」

「この2つのBranchの違いを説明して」

「第3稿から主人公の性格はどう変化した？」

「以前却下した案の中から、この問題を解決できるものを探して」
```

Version GraphそのものをAI Contextとして利用する。

## 75.1 Conversation Archive

ChatGPT、Claude、Gemini等からUser自身が取得した会話LogをImportし、KOMYAKU内で検索、閲覧、Version管理、分岐、Exportできるようにする。

会話は単なるText Documentではなく、構造化されたConversationとして扱う。

```text
Conversation
├ Message: system
├ Message: user
├ Message: assistant
├ Message: tool
└ Message: attachment reference
```

Provider固有Exportの原本はImmutable Import Artifactとして保持し、解析後のCanonical Conversationとは分離する。

```text
Raw Export
 ↓ content hash
Immutable Import Artifact
 ↓ versioned parser
Canonical Conversation
```

Canonical Messageの概念Field：

```text
id
conversation_id
source_provider
source_message_id
role
author_label
content_parts
created_at
edited_at
parent_message_ids
model_metadata
tool_metadata
attachment_ids
import_provenance
```

`role`をUser / Assistantの2種類へ固定しない。System、Developer、Tool、Function、Unknown等を損失なく保持できる文字列とする。未知のProvider Fieldを捨てず、Provider-specific MetadataとしてRound Trip可能にする。

一つの会話にBranchがあることを前提とし、Message間の関係を単一の配列位置だけで表現しない。`conversation_edges`でParent / Childを表し、Conversation Graphとして保存する。

Import ParserはProviderとExport Schema VersionごとのAdapterに分ける。

```text
ConversationImporter
├ OpenAI Export Adapter
├ Anthropic Export Adapter
├ Google Export Adapter
├ Generic JSON Adapter
├ Markdown Adapter
└ Plain Text Adapter
```

ProviderのExport形式は将来変化し得るため、Parser Version、Import日時、Source Hash、Warningを記録する。解析できないFieldやMessageがあってもImport全体を黙って欠落させず、原本を保持してPartial ImportとしてUserへ示す。

## 75.2 AI Handoff and Continuation

保存したConversationの任意地点を選択し、対応するAI ProviderまたはLocal ModelへContextとして送信して会話を続けられるようにする。

```text
Select conversation point
 ↓
Select messages / branch / attachments
 ↓
Review redaction and token estimate
 ↓
Select AI connection and model
 ↓ explicit confirmation
Create immutable handoff snapshot
 ↓
Send through provider adapter
 ↓
Store response as a new conversation branch
```

「任意のAI」は次に限定する。

```text
Official API
User-configured compatible API endpoint
Local model adapter
Approved connector
```

任意のConsumer向けWeb UIへCredentialを流用して自動Login・自動投稿する方式をCore機能にしない。

Provider Adapter：

```text
AiProviderAdapter
├ listModels()
├ estimateContext()
├ validateCapabilities()
├ createContinuation()
├ streamContinuation()
└ cancelContinuation()
```

ProviderごとにRole、Tool Call、Image、PDF、最大Context、Streaming、Citation等のCapabilityが異なる。送信前にLossy Conversionを検出し、欠落・変換内容をUserへ表示する。

Context Windowへ収まらない場合、元Logを変更せず、次から選択できるようにする。

```text
Recent messages only
User-selected messages
Deterministic truncation
User-approved summary
```

AI生成Summaryを原本と同一視せず、生成Provider、Model、Prompt Version、対象Message ID、生成日時を持つ派生Artifactとする。

Handoff Snapshotには、実際に送信したMessage ID、変換後PayloadのHash、Provider、Model、送信設定、同意時刻、Response IDを記録する。ただしAPI Key、秘密Token、本文そのものを通常Logへ出さない。

応答は既存会話を上書きせず、新しいBranchとして保存する。同じ会話地点を複数AIへ送った場合も各応答をSibling Branchとして比較可能にする。

## 75.3 Conversation Security and Consent

Import Fileと会話本文は信頼できないInputとして扱う。会話内に含まれる命令文をKOMYAKUのSystem Instructionとして実行してはならない。

外部AIへ送信する前に最低限：

```text
送信Provider / Model
送信するMessage範囲
Attachment
推定Context量 / Cost
Provider側のRetention条件へのLink
AI学習利用設定との関係
秘密情報検出Warning
```

を表示してUserの明示確認を得る。

Email、API Key、Access Token、Password候補等の秘密情報を検出して警告し、Userが送信前にMaskまたは除外できるようにする。自動検出は完全ではないことも明示する。

Provider API CredentialはOS KeychainまたはServer-side Secret Storeへ暗号化して保存し、Database本文、Client Log、Export Archiveへ含めない。Workspace共有Credentialと個人Credentialを分離し、失効・Rotation・最終利用日時を管理する。

Import元Conversationに第三者の個人情報、機密情報、著作物が含まれる可能性がある。Userが保存・送信する権限を持つことを確認できる導線を設ける。

AI Handoffへの同意はAI学習許可を意味しない。`ai_training_policy=deny`でも、Userが特定の一回の推論送信を明示承認できるようにし、その同意範囲を当該Handoffに限定する。

---

# 76. Semantic Version Metadata

将来的にVersionへ、

```text
people
places
dates
relationships
plot changes
tone changes
terminology changes
```

などを保存可能にする。

ただしMVPのVersion SchemaをAI依存にしない。

---

# 77. Git interoperability

将来的なGit Export：

```text
KOMYAKU Version
      ↓
Git Commit

KOMYAKU Branch
      ↓
Git Branch
```

KOMYAKUのVersion DAGとGit Graphの意味対応を維持する。

ただしGitの内部制約をKOMYAKU DB Schemaへそのままコピーしない。

---

# 78. Repository構成

推奨Monorepo：

```text
komyaku/
│
├ apps/
│  ├ desktop/
│  └ server/
│
├ packages/
│  ├ editor-core/
│  ├ document-schema/
│  ├ version-engine/
│  ├ diff-engine/
│  ├ sync-core/
│  ├ i18n/
│  ├ api-client/
│  └ shared/
│
├ database/
│  ├ migrations/
│  └ seeds/
│
├ locales/
│  ├ ja/
│  ├ en/
│  └ zh-Hans/
│
├ docs/
│  ├ architecture/
│  ├ schema/
│  └ adr/
│
└ README.md
```

---

# 79. Tauri構成

```text
apps/desktop/
│
├ src/
│  ├ app/
│  ├ components/
│  ├ editor/
│  ├ graph/
│  ├ diff/
│  ├ library/
│  ├ hooks/
│  ├ services/
│  └ i18n/
│
├ src-tauri/
│  ├ src/
│  │  ├ commands/
│  │  ├ local_db/
│  │  ├ filesystem/
│  │  ├ sync/
│  │  └ security/
│  └ tauri.conf.json
│
└ vite.config.js
```

TauriではWeb frontendとRust側application logicを分離できる。

---

# 80. Server構成

```text
apps/server/
│
├ src/
│  ├ index.js
│  │
│  ├ routes/
│  │  ├ auth.js
│  │  ├ documents.js
│  │  ├ versions.js
│  │  ├ branches.js
│  │  └ sync.js
│  │
│  ├ services/
│  │  ├ auth/
│  │  ├ document/
│  │  ├ version/
│  │  ├ diff/
│  │  ├ storage/
│  │  └ sync/
│  │
│  ├ middleware/
│  ├ repositories/
│  ├ security/
│  └ config/
│
└ package.json
```

---

# 81. Domain Layerを分離する

Route handler内へVersion処理を直接実装しない。

禁止：

```text
HTTP Route
 ↓
SQL
 ↓
Version creation
```

推奨：

```text
Route
 ↓
Application Service
 ↓
Domain Service
 ↓
Repository
 ↓
Database
```

Version EngineをHonoから独立させる。

## 81.1 Modular Monolithと分散境界

初期はServiceをNetwork分割せず、単一Deployableの内部Moduleとして構成する。

```text
API Process
├ Auth Module
├ Document Module
├ Version Module
├ Sync Module
├ Billing Module
├ Job Dispatcher
└ Repository Adapters
```

Module間は明示的なApplication ServiceまたはDomain Eventを通す。他ModuleのTableへRoute Handlerから直接SQLを発行しない。

API Processに永続状態を保持しない。

禁止：

```text
Process MemoryだけにSessionを保存
Process MemoryだけにJob Queueを保存
Local FilesystemをSnapshotの正本にする
単一Process Lockだけで排他制御
Replica固有Cacheを唯一の真実にする
```

初期ServerでもSession、Idempotency、Job、Rate Limit、Lease等の永続性が必要な状態はPostgreSQL等の共有Storeへ保存する。Memory Cacheは消失可能な補助に限定する。

## 81.2 Durable JobとTransactional Outbox

Snapshot検証、Diff生成、Export、Search Index、Email、Usage集計、Backup検証等はJobとして非同期化できる境界を持つ。

初期：

```text
PostgreSQL Transactional Outbox
 ↓
Single Process Worker
```

将来：

```text
Outbox Relay
 ↓
Managed Queue / Message Broker
 ↓
Multiple Worker Replicas
```

Queue製品固有APIをDomain Serviceへ露出しない。`JobQueue`、`EventPublisher`、`JobHandler`等のInterfaceを通す。

Jobはat-least-once deliveryを前提とし、HandlerをIdempotentにする。Job/Eventには次を持たせる。

```text
id
type
schema_version
partition_key
idempotency_key
payload_reference
created_at
available_at
attempt_count
lease_owner
lease_expires_at
completed_at
```

Document本文やSnapshot全体をQueue Messageへ直接埋め込まず、認可可能なResource IDまたはObject Storage参照を使用する。

## 81.3 PartitioningとOrdering

順序保証が必要な処理は原則として`document_id`をPartition Keyにする。Workspace集計は`workspace_id`を使用する。

全SystemにGlobal Orderingを要求しない。Document内のVersion順序はVersion DAG、Parent Edge、expected branch headで検証する。

将来Database PartitioningまたはShardingを導入する場合も、Workspace境界とDocument境界を跨ぐTransactionを最小化する。

## 81.4 Health CheckとGraceful Operation

Serverは次を分離する。

```text
/health/live
    Processが応答可能

/health/ready
    新規Requestを受け付け可能
    必須Dependencyへ接続可能
```

Shutdown時は先にReadinessをFalseにし、新規Trafficを止め、処理中Requestと取得済みJob Leaseを安全に終了または返却する。

Migrationは複数VersionのServerが一時共存できるExpand / Migrate / Contract方式を使用する。Deployと同時に古いColumnを削除しない。

---

# 82. Version作成Transaction

Named Version作成時：

```text
Validate Permission
 ↓
Validate Document
 ↓
Serialize canonical snapshot
 ↓
Calculate content hash
 ↓
Write immutable object
 ↓
Create Version row
 ↓
Create parent edges
 ↓
Update branch head
 ↓
Audit log
 ↓
Transactional outbox
 ↓
Commit transaction
```

途中失敗で半端なVersionを公開しない。

---

# 83. Storage Failure

Object Storageへのsnapshot保存が失敗した場合、

Version metadataだけを確定しない。

Transactional OutboxまたはPending Stateを利用できる設計を検討する。

Versionは、

```text
pending
ready
failed
```

等の内部状態を持てる。

UIに表示するVersionは原則`ready`のみ。

---

# 84. Concurrency

Branch head更新には競合検出を入れる。

例：

Client：

```text
expected_head = V10
```

Server：

```text
current_head = V11
```

なら無条件上書きしない。

新Branch生成またはConflict responseにする。

---

# 85. Database Constraints

Application logicだけに頼らない。

最低限：

```text
FOREIGN KEY
UNIQUE
NOT NULL
CHECK
```

を適切に使用する。

Workspace境界等はRepository Layerでも検証する。

---

# 86. テスト戦略

最低限：

```text
Unit Test
Integration Test
Database Test
Version DAG Test
Unicode Test
Diff Test
Sync Test
Recovery Test
E2E Test
```

---

# 87. Unicode Test Corpus

最低限以下をテストする。

```text
Japanese
English
Simplified Chinese
Traditional Chinese
Korean

Arabic
Hebrew
Persian

Hindi / Devanagari
Bengali
Tamil

Thai

Vietnamese

Cyrillic
Greek

Emoji

Combining characters

Variation selectors

ZWJ emoji

Mixed RTL/LTR
```

---

# 88. 特に壊してはいけない文字列

テストには以下の種類を必ず含める。

```text
é

e + combining acute

👨‍👩‍👧‍👦

🇯🇵

漢字

العربية

עברית

हिन्दी

ภาษาไทย
```

目視だけでなく、

```text
UTF-8 round trip
hash
snapshot
restore
diff
```

まで検証する。

---

# 89. Round Trip Test

重要テスト：

```text
Input
 ↓
Local save
 ↓
API
 ↓
PostgreSQL/Object Storage
 ↓
Reload
 ↓
Export
 ↓
Import
 ↓
Compare
```

最初の文字列と最後の文字列が意図せず変化していないことを確認する。

---

# 90. Version Property Test

任意Version Vについて：

```text
restore(V)
```

した結果が、V作成時snapshotと一致すること。

任意Graphについて：

```text
parents(V)
```

が失われないこと。

Branchを削除してもVersionが参照条件に従って保全されること。

---

# 91. Performance初期目標

MVPで想定する通常文書：

```text
1 document:
数百KB〜数MB

versions:
数百〜数千
```

Graph全件をDOM nodeとして一度に描画する設計を避ける。

必要になればVirtualizationを導入する。

---

# 92. 巨大文書

長期的に：

```text
novel
research notebook
manual
corporate documentation
```

など数十年使われる可能性を考える。

「Documentは常に小さい」と仮定しない。

Document segmentation / chapter structureを後から導入できるID設計とする。

---

# 93. 観測性

Server：

```text
structured logs
request ID
trace ID

latency
error rate

database latency
storage latency

sync failure
version failure
instance ID
deployment mode
queue depth
job lag
job retry / dead letter
```

を観測可能にする。

本文そのものを通常application logへ出力してはならない。

---

# 94. Privacy

本文、Version、Diffはユーザーの機密情報になり得る。

原則：

```text
Do not log document content.
Do not log passwords.
Do not expose raw snapshots through predictable URLs.
```

Object Storageへのアクセスは認証済みAPIまたは短時間signed accessを通す。

## 94.1 AI Training and Crawler Policy

KOMYAKUは、ユーザーがDocumentを外部AIの学習用途へ提供しない意思を明示できるようにする。

```text
ai_training_policy = deny | allow
default = deny
```

`deny`の場合：

```text
AI学習用Crawlerをrobots.txtで拒否
X-Robots-Tag: noai, noimageai
TDM-Reservation: 1
外部AI学習Datasetへの能動的な提供を禁止
AI Providerへ本文を送信する機能を既定で無効化
```

Crawler指示やHTTP Headerは拒否意思を機械可読にする手段であり、すべての第三者が遵守することを技術的に保証するものではない。その限界をUIと利用規約で明示する。

将来AI機能を追加する場合も、AI機能の利用同意とモデル学習への利用同意を分離する。Document本文を外部AI Providerへ送信する前に、Provider、目的、送信範囲、保存条件を示し、明示的な同意を得る。

KOMYAKU内の`ai_training_policy`は、Codex、ChatGPT、その他外部サービスのAccount-level Data Controlsを変更しない。各サービス側の学習拒否設定はUserまたはOrganization Administratorが別途管理する。

---

# 95. MVP成功条件

ユーザーが次の操作を迷わず行えること。

```text
文章を書く
 ↓
版を保存
 ↓
さらに書き直す
 ↓
別案を作る
 ↓
Graphを見る
 ↓
過去版を選ぶ
 ↓
現在版と比較
 ↓
過去版から復元
```

さらに、

```text
アプリを強制終了
 ↓
再起動
 ↓
直前の文章が復旧
```

すること。

---

# 96. KOMYAKUの中心的Invariant

実装中、以下を絶対条件として扱う。

### Invariant 1

確定Versionは変更しない。

### Invariant 2

Versionは最低1つの完全な復元手段を持つ。

### Invariant 3

Version GraphのEdgeを勝手に変更しない。

### Invariant 4

同期競合で本文を捨てない。

### Invariant 5

UI LocaleとDocument Languageを分離する。

### Invariant 6

Latin/LTR/space-separated languageを前提としない。

### Invariant 7

JavaScript `string.length`を人間の「文字数」とみなさない。

### Invariant 8

本文を無条件Unicode compatibility normalizationしない。

### Invariant 9

Cloud接続失敗で入力を失わせない。

### Invariant 10

KOMYAKUからユーザーデータをExportできるようにする。

### Invariant 11

Local CoreはCloud Subscriptionなしで利用できる。

### Invariant 12

Quota超過やPlan Downgradeで既存のVersionを即時削除しない。

### Invariant 13

基本Version Graph、Diff、Branch、RestoreをVersion数課金で実質的に無効化しない。

### Invariant 14

Privacy、AI学習拒否、基本Exportを有料機能にしない。

### Invariant 15

API Processの再起動やReplica切替で、確定済みVersion、Session、Job、Sync Queueを失わない。

### Invariant 16

Importした会話原本をProvider変換やAI要約で上書きしない。

### Invariant 17

外部AIへ送信するMessage、Attachment、Provider、ModelをUserの確認なしに拡大・変更しない。

### Invariant 18

AIの応答は既存Conversationを上書きせず、新しいBranchとして保存する。

---

# 97. Codexへの実装指示

最初から全機能を実装しないこと。

以下の順で実装する。

## Stage 1 — Foundation

```text
Monorepo
React/Vite/Tauri
Bun/Hono
PostgreSQL

config
migration
logging
i18n

ja
en
zh-Hans

plan catalog
entitlement keys
usage meter boundary

stateless API boundary
transactional outbox
health checks
```

## Stage 2 — Identity

```text
User
Session
Personal Workspace
Project

Email Verification / Password Reset
Encrypted Notification Outbox
Durable SMTP Delivery / Reconciliation
Authentication Load Regression
Isolated PostgreSQL / SMTP Production-like Load Baseline
Internal Identity Security Review
External Security Review Package
```

Stage 2の完了は、Identity機能の実装、隔離された実PostgreSQL / SMTP経路での再現可能な負荷試験、内部Engineering Review、および外部評価者へ渡せるReview Packageの整備を意味する。これは本番公開の承認とは分離する。

本番公開前には、実際に採用するTLS / Reverse Proxy、PostgreSQL、SMTP Provider、監視、Backup構成での再試験と、独立した外部Security Review、指摘修正、再試験をProduction Launch Gateとして必須にする。内部実装者は独立監査の完了を自己宣言しない。

## Stage 3 — Document

```text
Canonical Document Schema v1
Stable Node ID

Text / Heading / List / Table
Image / Math / LaTeX / Code
Basic SVG / Mermaid / Generic File

Canonical source
Render representation
Asset reference / provenance

Workspace-scoped content-addressed Asset
Secure isolated renderer

Structured Editor
Local Draft / Cloud Save
Accessible alt text / caption
```

## Stage 4 — Document Evolution and Diff

```text
Version
Version Parents
Branch
Immutable Snapshot
Hash

Node lineage projection
Change kind

Graph rendering
Version selection
Branch visualization

Unicode segmentation
Content-type Diff dispatcher
Text / Math source / Diagram
Image / Table / Code / Binary Asset
Diff UI
```

## Stage 5 — Semantic and Visual Content History

```text
Editable Diagram canonical model
Math AST / MathML normalization
Semantic Math Diff
Diagram node / edge Diff
SVG structural Diff
Image visual comparison
Node lineage search
```

## Stage 6 — Specialized Design and Media

```text
CAD / 3D read-only preview adapters
External editor reference
Original / Preview provenance
Audio / Video / Scientific data extension
```

## Stage 7 — Recovery

```text
Recovery Snapshot
Offline
Sync Queue
Conflict Branch
```

## Stage 8 — Durability

```text
Object Storage
Backup
Export
Restore tests
```

## Stage 9 — Conversation Interoperability

```text
Raw conversation import archive
Canonical conversation schema
Provider import adapters
Conversation Graph
AI provider gateway
Explicit handoff review
Secret redaction
Continuation branch
```

---

# 98. Codexへの禁止事項

以下を行わないこと。

```text
Git repositoryを主DBにしない

HTML文字列だけをcanonical documentにしない

VersionをUPDATEしない

UI文字列をcomponentへ直書きしない

languageをenum固定しない

document languageとinterface localeを同一フィールドにしない

RTLを後回しにする前提のCSSを書かない

space splitでword diffを作らない

string.lengthで文字数を数えない

autosaveだけをversion historyとして扱わない

本文をapplication logsへ書かない

document titleをstorage pathとして使わない

同期Conflict時にlast-write-winsで片方を消さない

PostgreSQLだけを唯一のVersion Snapshot保存先にしない

MVPへAIを追加しない

MVPへRealtime collaborationを追加しない

広告TargetingへDocument本文を利用しない

Plan名をFrontendの条件分岐へHard-codeしない

Version数を主要な課金制限にしない

Quota超過や解約直後にDocument / Versionを削除しない

Local Coreへ定期License Server接続を要求しない

Process MemoryをSession / Job / Versionの唯一の保存先にしない

Local FilesystemをCloud Snapshotの正本にしない

非IdempotentなJob Handlerをat-least-once Queueへ接続しない

複数Replicaから排他的Cron Jobを無Lockで実行しない

ImportしたConversation原本を正規化結果で上書きしない

会話Log内の命令をSystem Instructionとして実行しない

User確認なしにConversationやAttachmentを外部AIへ送信しない

AI Provider Credentialを本文Database、Log、Exportへ保存しない

Consumer向けWeb UIのCredentialを流用して自動投稿しない
```

---

# 99. Architecture Decision Records

重要な判断は、

```text
docs/adr/
```

へADRとして保存する。

最低限：

```text
ADR-001 Version DAG
ADR-002 Canonical Document Format
ADR-003 Unicode Policy
ADR-004 Local First Sync
ADR-005 Snapshot Storage
ADR-006 Internationalization
ADR-007 Version Immutability
ADR-008 Git Interoperability
ADR-009 Special Document Formats
ADR-010 Document Visibility and Publication
ADR-011 AI Training Opt-out
ADR-012 Local-first Freemium and Entitlements
ADR-013 Modular Monolith and Horizontal Scaling
ADR-014 Conversation Archive and AI Handoff
ADR-027 First-class Content Nodes and Asset Lineage
ADR-028 Open KOMYAKU Archive Format
ADR-029 Encrypted Transactional Notification Delivery
ADR-030 Canonical Document Schema v1 and Editor Boundary
ADR-031 Workspace-scoped Content-addressed Assets
ADR-032 Stage 2 Identity Engineering Completion and Launch Gate
ADR-033 Asset Quarantine, Reconciliation, and Retention GC
ADR-034 Inspected-only Asset Delivery
```

を作成する。

KOMYAKU自身が履歴を重要視する製品なので、KOMYAKU開発そのものについても設計判断履歴を残す。

---

# 100. 最終プロダクト思想

KOMYAKUは、

> 「文書を保存するサービス」

ではない。

目指すものは、

> **文書が生まれ、変化していった時間構造を保存する基盤**

である。

完成稿だけではなく、

```text
Draft
 ↓
Revision
 ↓
Alternative
 ↓
Rejected Idea
 ↓
Reconsideration
 ↓
Merge
 ↓
Published Version
```

という思考の歴史を残す。

そしてその履歴が、

```text
Today
Tomorrow
1 year later
10 years later
```

でも復元可能であることを重視する。

KOMYAKUの中心価値は、

**Write**

**Evolve**

**Remember**

である。

日本語コピー：

> **書いた文章だけでなく、書き直した道のりも残す。**

設計上の最重要目標：

> **Language-independent, local-first, immutable document evolution infrastructure.**

KOMYAKUを単なる日本語執筆エディタとしてではなく、

**長期間使い続けられる、人間の文書と思考履歴の基盤**

として設計すること。
