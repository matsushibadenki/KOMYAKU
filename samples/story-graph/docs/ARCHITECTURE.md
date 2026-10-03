# Story Graph implementation boundaries

## 独立アプリと共有エンジン

Story GraphはKOMYAKUを利用するサンプル製品とする。Canvas、画面操作、表示用Projectionは本ディレクトリ内に置く。2026-09-26の方針変更により、Agentと複数UIが共有するCanonical schema、Path評価、決定的整合性判定は `packages/story-graph/` に置く。サンプル固有の状態を共有パッケージへ逆流させない。

アプリの配置（2026-10-02）：

```text
samples/story-graph/
  src/              操作画面、Canonical adapter、3言語
  src-tauri/        共有Host、Command、保存、人物Definition、compile
  vendor/unge/      Document／Engine／Interaction／wgpu
  test/             schema adapter・読み順・3言語テスト
  docs/             契約・進捗・検証記録
```

## 正本と復元単位

- 本文の正本はCanonical Document。Story Nodeは本文を複製せず、Document IDと安定Node IDを参照する。
- Story Node ID、Canonical Node ID、Version IDは別の識別子とする。
- Story Pathは作品内の読み順、Version Branchは編集の履歴。Canvas上でも名称と操作を分ける。
- 読み順のFlowにはDAG制約を適用し、意味関係の循環を同じ制約で拒否しない。
- 保存・復元の単位は本文、Graph、Path、lineage、必要なAssetの整合した集合とする。Graphだけ新しく本文だけ古い状態を許さない。

既存の単一Canonical DocumentのVersion/ArchiveがGraph全体を保持できるとは仮定しない。共有エンジンはDocument＋Graphの決定的なStory Workspace Snapshotを定義したが、native永続化とArchive契約は未実装である。`.komyaku` v1/v2を完全Graphバックアップと呼ばない。

## Compileと編集の整合性

MVPは明示したStory Pathの順序を読み、参照本文からLinear Documentを生成する。分岐点でルートが未選択、参照切れ、循環、重複参照がある場合の規則を先に定義し、暗黙に本文を省略しない。

Canvasの座標移動はレイアウト操作とし、読み順の変更は接続・Path編集として明示する。通常エディタは選択ノードの参照本文を編集する。Compile結果の編集をGraphへ逆変換する機能はMVPに含めない。

Split/Mergeは本文・Graph参照・Path・lineageをまとめて更新し、元の状態を復元可能にする。Graph操作Undoと本文Undoは対象を明示し、Version履歴を削除しない。

## 提供画像に基づく画面方針

基準画像は `docs/images/Story-Graphイメージ.png`。明るい紙面色、細い境界線、青い選択表示、控えめな影を基調とする。

- 左：プロジェクト、文書、グラフ、人物、資料などのナビゲーション。
- 中央：方眼Canvas、起承転結と別展開のコンパクトなノード、接続点、Zoom、Mini Map。
- 右：選択Sceneの本文エディタ。本文・メモ・履歴を切り替える。
- 上：作品名、保存状態、Undo/Redo、Version、プレビュー、書き出し。
- 下：ノード追加・分岐・結合・Group。AI欄はAIフェーズで実装する。

上部にファイル／編集／挿入／表示／ウインドウのメニュー、下部にステータスバーを配置する。画面全体を固定し、項目一覧・本文・人物相関を各パネル内でスクロールする。ユーザー指定によりサイドバーと本文の外側の左右余白は0とする。本文パネルの内側には上下20px・左右24px（狭幅では16px）のpaddingを確保する。狭幅ではナビゲーションと本文を縦に配置し、意味のまとまりを保つ改行を確認する。画像中の挿絵は方向性の参考であり、配布用素材は別途準備する。

## AIと性能

AIはMVP後。送信対象Nodeと文脈を表示し、提案を人間が採用して初めて新しいVersionにする。意味関係・AI Workflow・読み順は別レイヤーとして扱う。

1,000／5,000／10,000 Nodeを段階的に測定する。Viewport外の仮想化、Focus、Semantic Zoomを設計に含めるが、測定前に快適性を達成済みとしない。


## 初期実装での明示的な差分

現在の正本はRustのUNGE Engineが所有するDocumentです。Sceneごとに唯一のCanonical Documentをproperty内に置く暫定形式で、参照IDを持つ共有Canonical Story Workspace v1への移行は未完了です。UI用一覧は本文を含まず、本文は選択ノードだけをinspectします。GPUフレームのreadbackやJavaScriptへの転送はありません。

人間の編集はRegistry＋ホストValidatorを通したCommandへ変換し、expected revisionを照合します。ネイティブポインター操作も同じEngineのCommand／Undoを使います。共有意味ルール、Version、lineageはまだ接続しません。

本編／別展開はSceneのpathとorderで明示し、compileは順序の一意性とFlow接続を検査します。人間関係は人物→関係←人物とし、関係の向きと種類はRelationの属性に保持します。FlowのDAG制約を緩める拡張はしません。

各ウインドウのWebViewが持つのは入力中の短いdraftと描画用の一覧です。保存状態・本文正本・グラフ・履歴・GPUはRustで共有します。ネイティブwgpuは現行UNGEの別Window方式を使用し、WebView内部にSVG／Canvasの代替Graphを作りません。本文パネルは別WebViewとして分離／戻せますが、任意パネルのドラッグドッキングとGPUの同一Window合成は未実装です。

## 文章の所属構造

`story.block` が大枠、`story.sequence` が中枠、`story.scene` が小枠。シーケンスの `parent` はブロックID、シーンの `parent` はシーケンスIDを保持する。Rust Validatorが所属先の存在と階層を検証し、階層飛びや循環を拒否する。所属は物語ルートの `previous/next` 接続と独立する。本文はシーンのCanonical Documentのみが所有する。ブロックとシーケンスは見出しだけを編集できるフォルダであり、本文を所有・複製しない。旧版のメモは保存データに保持するが、編集コマンドは受け付けない。

従来の親IDがないシーンは、起動時にブロックとシーケンスを補って移行する。本文IDやルート接続は変更しない。新規シーンにはシーケンス、シーケンスにはブロックが必須。子項目がある枠は削除を拒否し、先に子項目を移動または削除する。所属変更は共通のUndo／Redo履歴とsnapshotに保存する。新規サンプルは一つのブロックとシーケンスに既存シーンを収める。

ドラッグ＆ドロップは `move_outline` 命令で処理し、同じ種類の項目の前後、または直上の親フォルダ内だけを許可する。ルートにはブロックだけを置く。`outlineOrder` は兄弟の構造順で、物語ルートの `order`・接続とは別に保持する。親変更と兄弟の順序更新は一つのBatchとしてUndo／Redo・snapshot保存する。

## 新規作品ウインドウ

「新規」は作品ライブラリの `workspaces/<UUID>/` に空の三階層Documentと現在の環境設定を保存し、同じ実行ファイルを別のRustホストとして起動する。各ホストがEngine・Document・Renderer・保存先・Undo履歴を所有する。UIは同じWebViewを使用し、親作品を閉じても新しい作品のプロセスは継続する。初期本文は空、人物・関係ノードは未作成。タイトルは「無題の作品」と表示する。新規作品ではグラフウインドウを初期非表示とし、本文ウインドウを前面にする。

「開く…」はライブラリ直下の既定作品と `workspaces/<UUID>/` の保存済み作品を列挙する。Rustのblocking workerでsnapshot・schema・階層・ドメイン制約を検証し、UIへはID・作品名・更新日時・開いている状態のみ返す。UIから任意のファイルパスは受け付けない。保存ファイルのシンボリックリンク、ライブラリ外へ解決される作品ディレクトリ、破損・未対応形式を拒否し、一覧表示では保存データを変更しない。現在の作品・他のプロセスで開いている作品は一覧からの重複起動を無効化する。

各Rustホストは `.workspace.lock` のOS排他ロックを起動時からプロセス終了まで保持し、snapshotを読む／移行する／保存する前に確保する。分離WebViewは同じホストを利用するため新しいロックを取得しない。ロックファイルが残ってもOSロックは終了時に解放される。複数作品は独立したEngine・履歴・保存先を保持する。

ライブラリは通常アプリデータ直下。検証時は `STORY_GRAPH_LIBRARY_DIR`、未指定なら `STORY_GRAPH_DATA_DIR` を起点とする。子ホストへライブラリの起点を引き継ぐため、作品の内部で「新規」を実行してもライブラリが多重に入れ子にならない。外部snapshotの取り込みと完全Archive importは未実装。

## snapshotバックアップの復元

ファイル→「バックアップから復元…」は現在の作品ディレクトリの `backup-<UUID>.story.json` を列挙する。Rust workerで保存形式・schema・階層・ドメイン制約を検証し、作品名・更新日時・シーン数・項目数・読み込み状態だけをUIへ返す。選択したバックアップは復元時にも再検証する。UIから任意のパスは受け付けず、ファイルのシンボリックリンクや不正なIDを拒否する。

復元はライブラリの `workspaces/<新UUID>/` に独立したsnapshotを保存し、別Rustホストで開く。Graph・Canonical Document・本文NodeのIDを保持し、元の作品とバックアップは変更しない。復元作品のタイトルは指定した名前へ変更し、環境設定は現在の設定を引き継ぐ。バックアップにUndo／Version履歴や外部Assetを含む完全Archiveがあるとは扱わない。ウインドウの起動に失敗しても復元snapshotは保存済み一覧から開ける。バックアップの作成・一覧検証・復元はblocking workerで実行する。

## 大容量本文の編集経路

WebViewの正本はRustが所有するcanonical documentの投影です。通常の入力は段落IDとUTF-16の開始／終了位置・挿入文字だけを送ります。Rustはサロゲートペアの途中を拒否し、復元したcanonicalを検証してから、該当段落／セルのcontentへの`SetNestedProperty`を適用します。Undoはその部分の旧contentを保持します。構造変更（セリフ挿入等）は全canonicalの更新を使います。

JSは変更箇所の祖先だけをコピーし、文字数を差分で更新します。保存後に入力DOMを再生成しないことで、入力欄のフォーカスとIMEの継続を保ちます。大きなシーンではIntersectionObserverとCSS content-visibilityを併用し、画面近くのブロックだけtextareaの高さ・役者名の幅を計測します。長い段落は8,192 UTF-16単位付近の改行で表示を分割し、データ上の段落境界は変更しません。

Tauriの編集コマンドはblocking workerへ処理を移します。Rustの正本・履歴は共有Engineにあり、リビジョン検査から保存まで共通gateで直列化します。GPUのフレームデータは従来どおりRust側に保持します。

本文上限はシーンの平文6 MiB、canonical JSON 16 MiB、20,000ブロック、保存workspace 128 MiBです。大きな正本は選択時だけ取得し、毎フレーム転送しません。現時点では全文DOM生成・Rust側の全文検証とsnapshot・全体JSON保存が残ります。完全なDOM仮想化や巨大な改行なし段落の高速編集は未実装です。表示を分割した段落の選択・コピーは各入力欄内に限られます。
