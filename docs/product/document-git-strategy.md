# 文章版Gitとしての評価と実行方針

更新日: 2026-09-05。実装を確認した上での製品・アーキテクチャ評価。市場調査、独立したセキュリティ監査、実機操作による不具合再現を完了したという意味ではない。

## 判断

**可能性はある。ただし現状は「文章版Gitの製品」ではなく、文書と添付を安全に扱う基盤である。技術スタックは維持し、開発順序を中核体験へ変更する。**

価値の仮説は「長い文章を大胆に書き直せる。別案を比較し、必要な部分を採用でき、いつでも理由と過去へ戻れる」。最初の対象は、仕様書・技術文書・研究ノートなどを繰り返し改稿する個人と、小規模な非同期レビューである。これは検証対象の仮説であり、需要や課金意向を実証済みとはしない。

Gitのコマンドを隠すだけでは不十分。利用者が段落の変更を理解し、案を失わず判断できることが製品価値になる。小説全般、研究投稿、CAD、AI会話管理、組織の記録保管を同時に完成させようとしない。

## 実装から分かったこと

| 領域 | 根拠 | 評価と対応 |
| --- | --- | --- |
| 永続文書モデル | `packages/document-schema/src/schema.js`、`packages/editor-core/src/canonical-adapter.js` | Canonical、安定Node ID、原文と表示の分離は再利用する。全面書き直しは不要 |
| 編集状態と確定版の分離 | `packages/editor-core/src/collaborative-working-state.js` | Yjsを作業状態に限定する方針は適切。収束は版履歴や意味的な統合の代用にならない |
| ローカル復旧 | `apps/desktop/src/services/local-database.js`、`apps/desktop/src-tauri/src/lib.rs` | 単調revisionとSQLite transactionは有効。ただしdraftは上書き型で、過去の確定版の保全とは別 |
| Version Engine | `packages/version-engine/src/index.js` | status定数のみ。Commit、Branch、Restore、Mergeは未実装 |
| Diff / Sync | `packages/diff-engine/src/index.js`、`packages/sync-core/src/index.js` | grapheme分割と競合方針の定数のみ。比較、同期プロトコル、競合解決の完成を示さない |
| データベース | `apps/desktop/src-tauri/migrations/0001_local_foundation.sql`、`database/migrations/` | snapshot/queueの土台や版ID用の列はあるが、Document Version DAGとBranchの実動作はない |
| 持ち出し | `docs/formats/komyaku-archive-format.md`、`packages/archive-core/src/index.js` | v1は単一CanonicalとAssets。Graph/Branch/Mergeは明示的に対象外。履歴バックアップと呼ばない |
| エクスポート導線 | `apps/desktop/src/App.jsx` の `exportDocument` | 現在の書き出し操作はCloud接続が必要。アカウント不要のlocal exportを最優先範囲へ入れる |
| 主画面 | `apps/desktop/src/App.jsx` | 2レプリカの共同編集実験が主導線。通常の単一編集画面と履歴・案の操作へ移行する |
| 保全と運用 | Asset、Archive、Outbox、Idempotencyの各service/repository | 投資は活かす。ただし追加の周辺機能より中核操作の完成を優先する |

### 先に閉じる保存上の懸念

以下はコード経路からの指摘であり、今回実機で再現した結果ではない。N0で回帰テストと実機確認を行う。

- `renameLocalDocument` はDB改名後に一覧だけ更新する。native側はCanonical titleとrevisionを進めるが、編集中のYjsと`localRevision`は更新しない。次の保存がstaleで失敗する経路がある。改名を編集セッションの保存手順に統合する。
- `openLocalDocument`、archive import、copy importはreplicaを切り替える際、保留中の450ms autosaveと保存queueの完了を待つ共通手順を持たない。保存直前の変更が落ちる可能性を検証する。IME変換中は確定を待ち、保存成功前に切り替えない。
- `createCheckpoint` は保存失敗後の`persistenceBlocked`状態で、永続化を行わずcheckpointをreadyにできる。メモリ上のcheckpointと永続保存済み表示を分離し、保存再試行の出口を用意する。
- exportは保持中の`checkpoint.document`を読むため、編集中の最新状態と一致する保証がない。選択版を書き出すか、保存完了したdraftを書き出すかを明示する。

## 維持する構造と変更する境界

```text
単一編集画面
  → 編集セッション（文書・案ごとの保存queue、IME、dirty、期待revision）
  → Application Service（保存、版を残す、別案、比較、復元、採用）
  → Version / Diffの純粋なドメイン処理
  → SQLite transaction + immutable snapshot + Asset参照
  → 任意のCloud同期・非同期レビュー（後段）
```

React/Vite/Tauri、ProseMirror/Yjs、Canonical Schema、SQLite、Bun/Hono、PostgreSQL、S3互換保管を維持する。新しい状態管理ライブラリ、Gitバックエンド、マイクロサービスへの変更は前提にしない。`App.jsx`から保存と文書切替のライフサイクルを分離するのはN0に必要な範囲に限定する。

### 永続化の契約

- Working Draftは可変。Recovery Snapshotは事故復旧用。Named Versionは不変。3種類をUI・API・保存ポリシーで区別し、450ms autosaveを毎回Versionにしない。
- 最初は完全なCanonical Snapshotを確定版の正本にする。差分チェーン、圧縮、Node revision projectionは計測後。重複排除はSnapshot/Assetのbyte hashで行っても、同一本文の別の意思決定を同一Versionへ潰さない。
- VersionにはID、document ID、schema version、snapshot hash、順序付きparent IDs、作者のローカル識別子、作成時刻、作成理由を持たせる。最初の版のみ親0、通常は親1、MVPの統合は親2。親の存在、同一文書、重複、循環を検証する。時刻やUUIDの順序だけで因果関係を決めない。
- Hash対象のJSON encodingを仕様とfixtureで固定する。キー順は決定的に扱い、本文Unicodeは正規化しない。Hashは完全性確認であり作者の署名ではない。
- BranchはID、名前、head Version IDを持つ可変参照。更新はexpected headによるcompare-and-swap。Draftはdocument/branchに属し、切替時に別案の未保存内容を上書きしない。
- SQLiteではVersion、parent edges、Branch head、Version単位のAsset参照、操作のidempotency結果を一つのtransactionで保存する。保存途中の終了と再試行でも二重Versionやheadだけの更新を作らない。
- 復元は現在headを親とする新Versionを作り、選択した過去版を`restoredFromVersionId`として記録する。選択元を因果上の親へ勝手に追加せず、未来の版を削除しない。
- 初回導入時は既存draftから初版を生成する。過去の履歴を捏造せず、既存snapshotは由来を示して取り込むか独立の復旧データとして保持する。既存SQL migrationを変更せず追加する。
- 確定版から参照されるAssetは現draftから外れても保護する。現行のdraft参照数やv1 export証拠だけで、履歴のAssetを削除可能にしてはならない。Version参照と履歴export証拠への対応前にGCを拡張しない。

### 比較と統合の契約

最初は段落・Node単位の追加、削除、移動、本文変更、書式変更を表示し、本文内はgraphemeを壊さない比較を行う。数式とMermaidは原文比較、画像とFileはAsset hash/metadata比較を使う。安定IDが失われたimportでは類似度を補助表示に留め、同じNodeと断定しない。意味的diffやAIによる変更理由は正本にしない。

統合はbase/ours/theirsによる3-way方式。同じNodeの両側変更、削除対編集、移動、順序、mark/metadataの競合を明示する。baseが複数ある複雑なDAGではMVPは自動統合せず案内付きで停止する。利用者が選択または手修正した結果をCanonical検証・差分確認し、2親Versionとして確定する。自動的な「意味が正しい統合」は約束しない。

### 持ち出しと同期の契約

ローカルのv1単一文書exportに加え、2026-09-12に別majorのHistory Archive v2契約、reader/writer、Desktop全履歴exportを実装した。v1 readerで新形式を読めるとは主張せず、既存v1の読込を維持する。v2は全Versionの元Snapshot bytes、ordered parents、Branch heads、到達可能な全Assetsを閉じた集合として検証し、生成後にもreaderで再検証してからdownloadする。空のアプリ環境へ原子的に戻し、再起動後に全bytesと関係を比較する経路は引き続き公開Alphaの条件とする。本文だけのTXT/Markdownは、書式やAssetsの損失を説明した派生exportとする。

同期はローカル中核の検証後。Version送信とhead更新は別契約にし、expected head不一致時に双方の案を残す。Cloudの文書Asset checkpoint APIを本文やVersionの同期と呼ばない。リアルタイム共同編集と確定版の作成権限も別に設計する。

## 利用者に見せる言葉

| 操作 | 日本語 | English | 简体中文 |
| --- | --- | --- | --- |
| commit | 版を残す | Save version | 保存版本 |
| branch | 別案を作る | Create alternative | 创建备选方案 |
| diff | 変更を比べる | Compare changes | 比较修改 |
| restore | この版から復元する | Restore from this version | 从此版本恢复 |
| merge | 案を統合する | Merge alternatives | 合并方案 |

最初の画面は文書一覧、単一エディター、履歴一覧と案の切替、変更比較で構成する。2026-09-12に、保存版の親関係を線、別案を色付きlane、現在位置と各Branch headをラベルで示す補助グラフを履歴一覧へ追加した。実際の行位置を測って翻訳文の折返しと追加読込へ追従し、SVGを読めなくても同じ操作ができるsemantic listを正本の導線にする。巨大なDAGを理解しないと文章を書けない画面にしない。新規文書、保存状態、失敗からの再試行、undo/redo、キーボード操作を完了条件に含める。英語・日本語・简体中文、狭い画面、意味の自然な改行を確認する。

## 検証と継続判断

実行順は`docs/ROADMAP.md`のN0 → N1 → N2 → N3 → N4。予定日や実装済み件数より、再現可能な利用シナリオの完了で判断する。

N2後に対象者5名を目安に、アカウントなしで「新規作成→版A→改稿して版B→別案→比較→復元→再起動」を操作してもらう。暫定継続条件は4/5名が助けなしで完了し、保存データ欠損が0件であること。N3では同じ評価に競合の手動採用と履歴Archiveの空環境復元を追加する。

その後2週間の試用で、履歴を実際に見返した回数、別案の作成と採用、復元による救済、継続利用の理由を本人同意の下で確認する。本文を収集しない。課金意向はCloud backup/共有レビューの具体的な場面で聞き、5名の結果を市場規模へ外挿しない。比較が理解できなければDiff/UIを優先し、案が使われなければ版の保存・復元へ絞る。反復利用が確認できるまで課金実装やメディア形式を増やさない。

性能の最初の計測用fixtureは10万grapheme、1,000版、20案。Version保存、履歴取得、再起動、メモリ、Archiveサイズを端末条件付きで記録する。2026-09-12にApple M4のdebug fixture向け予算を、Version保存p95 25 ms、履歴先頭100件p95 10 ms、再接続と先頭page 25 ms、全10 page取得100 ms、SQLite 128 MiB以下へ固定した。Packaged Editing QA appは別の5回計測で、可視window到達p95 3秒、3秒安定後のprocess-family RSS p95 512 MiB以下へ固定した。超過時は描画数、遅延取得、Snapshot保持方式の順に調べる。

## Cloudと周辺計画

Cloudを公開する際の負荷・バックアップ復元・独立セキュリティレビューのgateは維持する。ただしローカル試作の着手条件にはしない。ADR-074のXServer Cloud App VPS + Managed PostgreSQL + S3を維持し、NFSは共有POSIX領域が必要になった時だけ採用する。AI/バッチは独立通常VPS WorkerからHTTPS APIまたはジョブキューでCloudへ接続し、Managed DBへ直接接続しない。今回料金や提供仕様を再調査していないため、契約前に公式仕様を再確認する。

Math Palette、手書き数式、論文投稿export、追加AI Provider、CAD/動画、商用課金、リアルタイム共同編集の製品化は後段へ移す。既存実装の保全・回帰修正は継続する。

## 今回の確認範囲

README、設計仕様、roadmap、主要ADR/architecture/format資料、package境界、Desktop保存/一覧/編集の連携、Rust transactionとmigration、Serverのservice/repository構成、テストを確認した。全ファイルの全分岐を監査したものではない。

2026-09-05にBun 1.4.0で`bun test`を実行し、312 pass / 25 skip / 0 fail（90 files、337 tests）。スキップされたDB統合テスト、ブラウザE2E、native Rustテスト、各OSの実機QAは今回実行していない。新しいVersion/Diff機能の完成を既存テスト成功から推論しない。

## English summary

KOMYAKU has a credible technical foundation for document version control, but its Version, Diff, and Sync engines are not implemented beyond stubs/basic segmentation. Keep the stack and prioritize durable editing, local versions/alternatives/restore, readable comparison, reviewed merge, and offline history export/recovery. Validate repeated use before expanding Cloud, AI, math, media, or billing. Existing test results are foundation evidence, not proof of the product hypothesis.

## 简体中文摘要

KOMYAKU具备文章版本管理的技术基础，但Version、Diff和Sync核心仍主要是占位实现。保留现有技术栈，优先完成可靠保存、本地版本与备选方案、恢复、可读差异、人工确认合并，以及离线完整历史导出和恢复。在验证持续使用需求之前，推迟Cloud、AI、数学输入、媒体和计费扩展。现有测试通过不等于产品价值已经得到验证。
