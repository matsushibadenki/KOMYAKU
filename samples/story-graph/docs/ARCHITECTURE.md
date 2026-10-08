# Story Graph implementation boundaries

## 作品の書き出し

ファイルメニューの書き出しは、編集内容を保存した後に `export_manuscript` へ形式と表示言語だけを送ります。Rust hostのgate内で正本のsnapshotを取得し、lockを解放してから標準保存ダイアログを表示します。出力はこのsnapshotの作品全体（別展開を含む）で、ブロック→シーケンス→シーンのoutlineOrder順です。未接続の構造項目がある場合は拒否し、文章を黙って省略しません。見出し・本文・セリフを含め、メモ・人物設定・相関図は含めません。

TXTはUTF-8とタブ区切りのセリフ、Markdownは階層見出しと2列のセリフ表です。入力したMarkdown記号・HTML記号をエスケープし、セル内改行はbrへ変換します。PDFはRust workerでA4横書きに組版し、SVGの文字をsvg2pdfでフォント埋め込みのForm XObjectへ変換して複数ページに配置します。本文12pt、見出し13〜24pt、左右54ptの余白、ページ番号、罫線なしのセリフ2列を使います。システムフォントが必要で、WebViewの文章DOMやプリンタには依存しません。PDF/A適合を保証するものではありません。

PDF→台本は `script` 形式として同じRust命令・保存処理を使い、拡張子はpdf、既定ファイル名は-script.pdfです。`script_pdf.rs`がシーンの通し番号・タイトル枠と本文列を右から左へ組版します。A4縦型、左右36pt、罫線y=281pt、タイトル枠y=239〜786pt、本文開始y=307pt、明朝系12pt、列間24pt、ページ番号y=816pt。paragraphはト書きとして6文字（78pt）下げ、セリフシートは役者名＋「セリフ」として罫線直下から表示します。シーン名だけを枠へ入れ、作品・ブロック・シーケンスの見出しは台本の本文に重複出力しません。シーン名と最初の本文列の幅を確保してからページに置きます。長文の続きは次ページの右端へ流れ、長いシーン名も枠の列数を増やして保持します。標準PDFと台本PDFはフォント埋め込み・ページ生成処理を共用します。

選択した形式に合う拡張子を検査し、出力先と同じフォルダの一時ファイルに書込み・fsyncしてから置換します。キャンセル時はファイルを作らず、エラーは3言語で表示します。処理中もRust正本を変更せず、本文の全文・画像フレームをJavaScriptへ送信しません。標準PDFの縦書きや印刷設定、物語ルート単位の範囲指定は後続対応です。

台本のタイトル枠は上辺と左右辺だけを描きます。枠と本文の全角文字セルの端との空白は左右とも18pt（1.5文字）です。セリフの続きは（役者名の書記素数＋開きカッコ1文字）×13pt下げ、明示改行と改ページにも同じ開始位置を適用します。極端に長い役者名では少なくとも2文字分の本文高さを残します。`vertical_glyphs.rs`はRustのrustybuzzでTopToBottom方向にshapeし、OpenTypeのvert/vrt2と縦方向の原点を使って約物・句読点・小書き仮名をアウトライン描画します。Unicode Vertical_Orientationに従ってラテン文字を回転し、縦用字形を持たない括弧等も回転で補います。書記素ごとに字体をフォールバックし、同じ字形は出力処理内でキャッシュします。白地の下層に元のUnicode文字を持つ埋込みテキストを残し、コピー・検索を保持します。描画可能な字体がない場合は省略せずエラーにします。縦中横と高度な禁則は後続対応です。

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

## 見出しの文字サイズ設定

執筆の構造見出しは`data-outline-title`に編集対象のIDを持つinput／textareaです。まとめ執筆の中間シーケンス・各シーン、パンくずの親項目も編集可能。`titleEdits`は未保存の名前だけを保持する一時draftで、本文draftとは別に扱います。共通の保存待ち合わせでIDごとのRust property命令へ送り、受理したsnapshotと詳細を更新。保存要求後に入力したdraftは消さず追加保存し、入力位置も再描画後に復元。エラー時はdraftを維持し、Revision conflictは既存の競合解決フローを使います。画面切り替え・書き出し・Undo等は未保存の名前も確定してから進みます。読む画面には入力欄を置きません。

環境設定→アピアランスでブロック名・シーケンス名・シーン名をそれぞれ12〜48pxで指定します。既存の`titleSize`はシーン名のサイズとして引き継ぎ、`blockSize`（既定30px）と`sequenceSize`（既定25px）を追加。新しい値を持たない旧設定もRustのserde既定値で読めます。Rust Storeで範囲と有限値を検証して保存し、既存の設定イベントで共有します。本文の既定値は18px、シーン名は22px。CSS変数で執筆・読む・分離パネルの横書き／縦書きに同じサイズを反映。構造見出しとパンくずの書体は本文のフォント設定へ統一します。既に保存されたサイズは保持し、「初期設定に戻す」で新しい既定値へ戻せます。パンくずの親見出し、まとめ執筆の編集可能な枠名・中間見出し・シーン名も種類別です。読む画面はルートのシーン順を保ち、親ブロック／シーケンスが切り替わった位置に構造見出しを表示します。

## AIと性能

AIはMVP後。送信対象Nodeと文脈を表示し、提案を人間が採用して初めて新しいVersionにする。意味関係・AI Workflow・読み順は別レイヤーとして扱う。

1,000／5,000／10,000 Nodeを段階的に測定する。Viewport外の仮想化、Focus、Semantic Zoomを設計に含めるが、測定前に快適性を達成済みとしない。


## 初期実装での明示的な差分

現在の正本はRustのUNGE Engineが所有するDocumentです。Sceneごとに唯一のCanonical Documentをproperty内に置く暫定形式で、参照IDを持つ共有Canonical Story Workspace v1への移行は未完了です。UI用一覧は本文を含まず、本文は選択ノードだけをinspectします。GPUフレームのreadbackやJavaScriptへの転送はありません。

人間の編集はRegistry＋ホストValidatorを通したCommandへ変換し、expected revisionを照合します。ネイティブポインター操作も同じEngineのCommand／Undoを使います。共有意味ルール、Version、lineageはまだ接続しません。

本編／別展開はSceneのpathとorderで明示し、compileは順序の一意性とFlow接続を検査します。人間関係は人物→関係←人物とし、関係の向きと種類はRelationの属性に保持します。FlowのDAG制約を緩める拡張はしません。

各ウインドウのWebViewが持つのは入力中の短いdraftと描画用の一覧です。保存状態・本文正本・グラフ・履歴・GPUはRustで共有します。ネイティブwgpuは現行UNGEの別Window方式を使用し、WebView内部にSVG／Canvasの代替Graphを作りません。本文パネルは別WebViewとして分離／戻せますが、任意パネルのドラッグドッキングとGPUの同一Window合成は未実装です。

## 人物サムネイルと相関図

`story.character.portrait` は省略可能な正規化済みPNGのdata URL。ネイティブファイル選択から8 MiB以下のPNG/JPEG/WebPをRustで読み込み、デコードの寸法・メモリ上限を設け、向きを補正して128×128へ中央トリミングする。元ファイルへの参照に依存せずsnapshot・バックアップへ保存する。変更・削除は共通EngineのProperty CommandとUndo/Redoを使い、取り込み中に正本が変更された場合はrevision conflictで拒否する。

一覧projectionには画像本体を含めず小さな`portraitKey`のみを返す。人物一覧は作品内IDとキーを指定する`portrait` protocolで必要な画像だけ取得する。任意ファイルパスは受け付けない。グラフの画像デコードを共有Arcキャッシュで再利用し、128pxタイル256個（16 MiB）のGPUアトラスに表示対象を保持する。変更したスロットだけアップロードし、描画命令・状態以外のフレームデータをJavaScriptへ転送しない。同時に256を超える写真が可視のときは余剰カードを名前の頭文字表示へフォールバックする。

人物のアクセント色はIDから安定して選択する。関係カードと人物→関係の接続線は`kind`から同じ色を選び、意味は文字でも表示する。技術的なポート名の代わりに人物設定・関係種別を表示し、ポートのヒット領域・移動・接続・選択・Undoは既存UNGEを維持。sRGBのネイティブsurfaceで図形・文字の色を正しく線形化してコントラストを保つ。

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

JSは変更箇所の祖先だけをコピーし、文字数を差分で更新します。保存後に入力DOMを再生成しないことで、入力欄のフォーカスとIMEの継続を保ちます。大きなシーンではIntersectionObserverとCSS content-visibilityを併用し、画面近くのブロックだけtextareaの高さ・役者名の幅を計測します。長い段落は8,192 UTF-16単位付近の改行、またはIntl.Segmenterの書記素境界で表示を分割し、データ上の段落境界は変更しません。各入力欄は正本の開始位置と長さを持ち、CRLF正規化も位置変換して差分を生成します。入力が16,384単位を超えると該当段落だけ再分割し、IME中は確定まで入力DOMを保持します。

同一段落の全選択は複数入力欄を論理的にまとめます。Shift＋左右矢印（縦書きは上下矢印）による任意範囲も、正本のanchor／focus位置で保持します。コピー・切り取り・置換は表示入力欄だけでなく正本の選択範囲に適用します。macOS標準メニューからの全選択にもselectイベントで対応し、分割された入力欄の全範囲選択は段落全体として扱います。境界の矢印移動と削除は書記素単位で正本の位置を移動し、グループ執筆でもシーンごとに差分を保持します。

選択状態は書き込み前／IME開始時に記録します。IMEによる最初の置換では、編集中の入力欄を保持し、選択された他の表示単位だけを除去・短縮してcanonical offsetを更新します。IME確定後に段落を再分割します。選択範囲の一部だけを持つ非アクティブな表示単位は文字レイアウトを合わせた背景のハイライトで示し、巨大な入力欄内のカーソル位置も一時ミラーで計測して内部スクロールします。

Tauriの編集コマンドはblocking workerへ処理を移します。Rustの正本・履歴は共有Engineにあり、リビジョン検査から保存まで共通gateで直列化します。GPUのフレームデータは従来どおりRust側に保持します。

80表示単位を超える本文では、初回からtextareaを遅延生成します。`ManuscriptViewport`が各表示位置を軽量プレースホルダーで保持し、viewport＋800pxへ近づくと入力DOMを生成・計測、離れると除去します。textareaのvalueを保存し、正本UTF-16開始位置・長さはプレースホルダーで管理します。段落ごとの索引を使い、通常入力では位置情報と生成済み入力欄だけ更新し、カーソル移動では移動先だけ生成します。キャッシュから生成するときも最新の位置情報を適用し、再分割時は古い入力欄を生成せずプレースホルダーを置換します。表示上のCRLF正規化は正本を変更しません。編集中の入力とIME対象は除去しません。選択範囲は正本の位置情報で保持し、生成済み入力欄だけへ選択色を適用します。選択中も画面外の欄を除去でき、再表示時に選択色を再適用します。範囲置換／IME準備では同一段落の入力欄を一時生成し、次のフレームで画面外の不要な欄を除去します。横書きは高さ、縦書きは幅を保持し、ウインドウサイズ変更で推定／実測を更新します。

セリフシートも同じviewportで遅延生成・除去します。両セルのvalue・正本offsetとtableの手動幅を保存し、再生成・サイズ変更後も保持します。推定サイズは役者名／セリフの双方と役者名の手動幅を使います。実測サイズは従来と同じ本文フォント・行間と役者名幅の計算から取得します。IME対象の要素と幅ドラッグ対象のtableを明示的に保持し、確定・ドラッグ終了・フォーカス移動後に画面外のシートを除去します。新規シートの役者名や幅の操作へフォーカスする前に、必要なシートだけ生成・計測します。セリフセルの入力は同一セルだけを参照し、全ブロックのDOMを探索しません。

本文上限はシーンの平文6 MiB、canonical JSON 16 MiB、20,000ブロック、保存workspace 128 MiBです。大きな正本は選択時だけ取得し、毎フレーム転送しません。プレースホルダーDOM、範囲置換／IME準備時の全段落一時生成、Rust側の全文検証とsnapshot・全体JSON保存が残ります。ドラッグ／複数段落をまたぐ選択、分割境界での連続した行折返しは未実装です。セリフのセルは巨大段落分割の対象外であり、セル自体が巨大なケースの専用分割・計測は未実装です。

## ローカル版管理 — 2026-10-05

`src-tauri/src/history.rs` が作品ホストのgateの下で、Engineのdocument/revisionを取得し、期待revisionに一致する原稿だけを版として保存します。WebViewは版一覧のメタデータと変更項目の要約だけを受け取り、版のsnapshotを所有しません。自動保存は可変draft、名前を付けた版は不変snapshotです。

`versions/<UUID>/workspace.story.json` と `version.json` を一時ディレクトリに書き、fsync後にディレクトリをrenameして公開します。未公開の`.`ディレクトリは一覧に含めません。metadataにはsequence、親版ID、理由、日時、タイトル、シーン数、ノード数、snapshotのSHA-256があります。親IDで因果順序を検証し、時刻で並べ替えません。読むときはハッシュ検証した同じbytesをdeserializeし、workspace形式、Document、domainを検証します。最大512版、snapshot128MiB。履歴一覧は本文を読みません。

復元は元の版と作業原稿を残し、`Library::restore_document`で独立した作品を作り、新しいRustホストを起動します。元版への参照は`restored-version.json`へ記録し、異なる作品間の親edgeは作りません。現行の復元は「別作品として開く」であり、同一作品headの巻戻しではありません。branch/merge、リモートGit、History Archiveは未接続です。項目比較は現在原稿または指定した保存版に対する追加・変更・削除の項目名と、作品名・接続・グループ・位置変更の要約です。

UIは指定URLのGit client CSS/JSを`src/vendor/parts`へ取り込み、Compactの3rem行高・5.75remグラフ幅を保持します。親edge描画、検索、キーボード移動を再利用し、丸のhit targetは28pxのsemantic button、詳細はinline regionと`aria-expanded`で制御します。SVG高さは実測値を明示し、WebKit未対応の`light-dark()`には実色を設定します。動的HTMLのstyle属性はCSPで拒否されるため、laneの色はCSSクラスで適用し、`style-src`ポリシーを維持します。`mountHistory`のteardownでObserverを停止し、古い非同期取得を破棄します。ソースと変更点はvendor READMEへ記録しています。


## 履歴の本文内差分 — 2026-10-05

`version_detail` は任意の `compareId` を受け取り、未指定なら現在原稿、指定時はハッシュ検証した不変版を比較先にします。保存版同士の比較では作業原稿のsnapshotを複製しません。変更項目は `textAvailable` を持ち、シーンに限り本文差分を開けます。

`version_text_diff` は安定したシーンIDから双方のCanonical本文をRustで取得します。現在原稿の比較では一覧取得時の期待revisionを検査し、変更後の本文を古い比較結果へ混ぜません。本文取得後は編集gateを解放してCPU計算します。Document・Canonicalの全文はWebViewへ送らず、表示用segmentと書記素数だけを返します。シーン追加／削除では存在しない側を空文字として扱います。

`history_diff.rs` はextended grapheme（CRLF・絵文字・結合文字を含む）で分割し、共通の先頭／末尾を除いた領域だけLCS比較します。DP表は65,536セル以下、変更領域合計1,024書記素以下。それを超えると削除／追加の範囲比較へ切り替え、粗い比較であることをUIへ明示します。周辺の共通本文は各96書記素、長い変更segmentは最大先頭160＋末尾160書記素に限定し、省略数を表示します。さらに各segmentの本文を2KiB、応答全体の本文を16KiB以下に制限し、大量の結合文字で1書記素だけが巨大になる場合も、その書記素全体を省略します。元のUnicodeや改行は正規化しません。100万文字同士の置換は2segment、JSON4KiB未満ですが、Rustの書記素走査・配列・snapshot読込は本文長に比例します。

UIは比較先selectorとシーンごとの「本文の差分」を持ち、追加は緑、削除は赤＋取消線で区別します。遅れて返る旧比較結果はgenerationとDOM接続状態で破棄します。メモや見出しだけの変更では本文一致を案内します。現行はセリフの役者名を含む平文比較であり、段落の移動やセリフの構造変更を独立した操作として表示するものではありません。

### 履歴のページ取得

`version_page(query, offset, head)` はRustで検証した全metadataを検索し、最大40件とtotal/offset/headを返す。headは最初の取得時のsequenceで、同じ検索の前後移動では固定する。更新・検索変更時はheadを取得し直す。snapshot本文は一覧で読み込まない。主一覧DOMは40行に制限し、180msの検索debounceと要求世代番号で古い応答を除外する。比較先の候補は独立した空検索ページを必要時に追加読み込みする。従来versions commandは互換のため残す。各取得で最大512件のmetadataを再検証し、外部変更や不正な親チェーンを隠すキャッシュは導入しない。保存の容量・版数上限は変更しない。

### 履歴の構造差分

version_detailの変更項目には、アウトラインのparent／outlineOrder変更をlocationで投影する。親タイトルは最大120文字、順序は保存値。version_structure_diff(id,nodeId,compareId,expectedRevision)は本文diffと同様に検証済みsnapshotと現在原稿／保存版を比較し、現在原稿の場合はrevision一致を必須とする。Rustゲート下で対象シーンのcanonicalだけを確保し、比較はゲート外で行う。段落・セリフのcanonical IDを基準に追加・削除を検出し、残存ID間の相対順位で移動を判定する。役者名、セリフ本文、手動列幅、段落本文の変更フラグを分離。応答には本文を含めず、最大100変更と全件数・省略数を返す。シーン間で移した段落の同一性照合は未対応（各シーンでは追加／削除）。

### ストリーミングsnapshot保存

persistence::saveはDocumentの検証後、保存先と同じフォルダのprivateな一時ファイルへcompact JSONを64KiB BufWriter経由で書く。内側のDigestWriterは実際に書けたバイトだけをSHA-256に追加し、128MiBを超える書込を拒否。flush・file fsync・atomic persist・parent directory fsyncの順で公開し、bytes/hashのReceiptを返す。通常保存と版保存で共用し、履歴metadataにはReceiptのhashを使うため全文ファイルの再読込は不要。serde_jsonの読込契約は変更せず、旧pretty JSONのsnapshot／履歴も読める。エラー時は未公開tempfileのDropでcleanupする（rename後のdirectory fsyncエラーは旧方式と同様、公開済みファイルが残る場合がある）。

執筆edit workerは保存成功時にunge://changedへstorySaved=trueを付ける。受信側は描画だけ更新し、保存とstory://changedの二重発行を省く。グラフ側のイベントにはマーカーがなく、従来通り保存する。保存失敗イベントにはfalseを付けるため、既存の再保存経路を維持。UI投影の作品名は取得済みsnapshotから取り、追加の全文cloneを行わない。グラフイベントの保存は現段階ではmain threadに残る。Documentのclone、正本データ、読込バッファ、全文保存方式自体は残っており、ジャーナル方式の実装とは区別する。

### AIストリームのEOF処理

StreamはLF/CRLF/CRを行区切りとして扱い、末尾CRは次チャンクでLFか判定する。正常HTTP EOF時には保留中の最終行・dataイベントを処理するが、response.completedかつresponse.status=completedを必須とする。DONEやテキストの存在だけでは成功にしない。ネットワーク例外時はEOF完了処理を呼ばず、Jobは失敗のままとしai_applyのcompleted条件を維持する。

### グラフのバックグラウンド保存

Hostと同じTauriプロセスがautosave::Workerを1個管理する。unge://changedの受信は世代カウンタと期限だけを更新し、描画はmain threadで、Document取得・保存・投影は専用Rust threadで実行する。キューにはDocumentやフレームを入れない。180ms静止後、連続操作は最初の未保存変更から最大1秒で保存を始める。保存対象世代を開始時に固定し、保存中に届いた世代は次回に残す。保存と通常執筆はHost.gateで直列化し、古いsnapshotが新しい執筆保存を上書きしない。グラフEngine側で保存中にrevisionが変わった場合は保存通知のsavedをfalseにして次回を待つ。すでに保存済みのstorySaved通知はworkerへ登録しない。

controls CloseRequestedとRunEvent::ExitRequestedはflushで未保存世代を待ち、失敗時に閉じる／終了をpreventする。workerの最後の失敗は再flush時に再試行可能。Exitでshutdownしてjoinし、callbackのAppHandleを解放する。callbackのpanicも保存失敗として処理する。正常な終了の保存待機と、強制終了・電源断時の保証は別であり、差分ジャーナルは未実装。

macOSのpredefined QuitはAppKitの直接終了経路になるため、標準メニューの最後のQuitを通常MenuItemへ置換する。日本語／英語／简体中文の起動時設定で表示し、CmdOrCtrl+Qを保持。story-quitのMenuEventでflush成功後だけAppHandle::exitを呼ぶ。RunEvent経路だけに終了保護を依存しない。


## 差分ジャーナル復旧契約（接続前）

`journal.rs`は保存済みcheckpointのバイト列を基準とし、共通prefix／suffixの間を置換するversion 2のJSON行レコードを生成し、legacy version 1も読み込む。before SHA-256がcheckpointまたは直前の復旧結果を識別し、after SHA-256が適用結果を検証する。sequenceは1から連続し、256件でcheckpointが必要。文書とジャーナル入力の上限は各128MiB。バイト差分なのでUnicode文字内部で境界が分かれても、復旧後の元バイト列を保持する。

prepareは状態を進めず、呼出側がappendとfsyncに成功した後にcommitする契約。recoverは改行で終わった全レコードを検証し、末尾の未完了レコードのみ除外してvalid_bytesを返す。完成レコードの破損、未知version、checksum不一致、連番不一致は復旧を拒否し、元checkpointを変更しない。SHAは誤破損検知であり認証署名ではない。

現段階ではcodecのみ実装し通常のsave/loadは変更していない。Rust側の全文走査・コピーはcodecにも残る。ディスク書込量を削減する接続前に、同じ世代のcheckpoint＋journalの原子的切替と起動時tail切詰め、互換読込を実装する。作品一覧・バックアップ・不変履歴が古いcheckpointのみを参照しないことを検証してから有効化する。


### ジャーナルの保存経路への接続

共通save/loadはworkspace.story.jsonのみジャーナルを使う。checkpointの実バイトSHAから`.workspace-{sha}.journal`を選び、完全なレコードを復旧する。各checkpointには固有generation UUIDを入れるため同一原稿へ戻しても別世代となり、checkpoint置換後・旧journal削除前の中断でも古い記録を適用しない。generationのない従来snapshotも読み込める。

差分が全文の半分未満、journalが4MiB未満、256記録未満なら追記とfsyncを行い、ディレクトリもsyncする。それ以外は既存の原子的snapshot保存へ切替。未完了末尾は読込では除外し、次の差分書込でvalid_bytesまで切り詰める。完成レコードの破損はload/saveとも拒否し、原本を保持する。作品一覧の更新日時はcheckpointと該当世代journalの最新日時を使用する。バックアップ・履歴はengine正本から単独snapshotを保存する。

ファイルを手動でコピーする場合workspaceと該当journalを一緒に保持する必要がある。アプリのバックアップは単独snapshot。旧アプリへの新保存形式のダウングレードは保証しない。現段階はディスクへの全文書込頻度の削減であり、保存時の全文読込・JSON変換・ハッシュは残る。世代キャッシュと操作ベースの差分は次の最適化。


### ホスト共有の保存キャッシュ

Host.savesはArc<Mutex<journal::Store>>で、執筆RPCとgraph autosave workerが同じ保存状態を使う。既存のgateで編集／保存の順序を維持し、各ウインドウはキャッシュを所有しない。Storeは最後の保存バイト列、generation、連番、journalのパス・有効バイト数とファイルstampを保持する。checkpointとjournalの長さ／mtime／Unix inodeが一致すれば再読込と全レコードreplayを省く。appendとsync成功後に状態を進める。checkpoint切替、ファイル変更、保存失敗時は破棄して次回検証し直す。

ファイルstampは通常の外部更新・原子的置換の検出用で、同じ長さとmtimeを意図的に維持した改変の認証機構ではない。cacheは保存済み本文のバイト列を1つ保持するため、その常駐メモリと全文JSON変換／checksumの負荷は今後計測する。作品一覧や別作品読込は独立に検証し、キャッシュから古い原稿を返さない。


### 差分生成・保存成功後の負荷削減

共通prefix/suffixは1KiBのスライス比較後に境界のバイトを調べる。prepareがbefore/after hashを生成した自分のレコードは、sync成功後に元のnextバイト列と連番を採用し、commitによる再parse・replay・二重hashをしない。ディスクからのrecoverには従来commit検証を必ず適用する。JSON Vecは直前の保存バイト数＋1KiBを初期容量とし、不要な倍増を抑える。全文JSON生成とprepareのchecksum、snapshotコピーは次工程。


### 検証済みdigestの再利用

Journal.current_hashはcurrentのSHA-256と常に一致する。checkpoint初期化時に計算し、recoverはbeforeを保持digestと照合、適用後のnextをhashしてafterを検証してから両方を更新する。prepareはbeforeを再hashせず、nextのafterだけ計算する。通常保存はprepareで得たafterをsync成功後にnextとともに採用する。失敗時は状態を進めず、Storeのキャッシュは破棄する。ファイル変更時は再読込・再検証するためディスク上のbefore／after検証を省略しない。


### 段落編集の部分シリアライズ

Paragraphs RPCはdispatch前のcanonicalから対象paragraph IDを取得し、dispatch後のsnapshotから同じ段落を取得する。セリフセル内の段落もcontentを再帰して取得する。Store.save_patchedは旧／新の段落objectだけをJSON変換し、旧objectが保存済みUTF-8バイト列に1回だけ現れる場合に差し込む。複数対象は位置順に適用し、重なりは拒否する。最大64段落、変換量は現在バイト数の4分の1まで。

生成候補をSavedWorkspaceとしてparseし、candidate.documentとRustのsnapshotが完全一致した場合だけ採用する。前回保存失敗、別の未保存変更、共有IDの重複、旧段落が見つからない、対象欠落や大変更は従来の全文serializerへfallbackする。この安全確認により他の変更を落とさない。checksum・journal version・append/fsync・checkpoint切替は従来と同じ。全文parseとsnapshotコピー、after SHAはまだ必要で、意味的な操作recordへ移行したものではない。


### 同期失敗後の同一内容再試行 — 2026-10-07

write_allで全レコードを追加した後のsync失敗は、次のrecoverで最新本文として読めても未確認の保存として扱う。Storeの同一バイト列分岐もcheckpoint／該当journal／親ディレクトリをsyncし、すべて成功してからcacheを戻して成功応答する。新規差分も共通sync経路を使う。同期失敗時のcache破棄とUIへの保存失敗通知・終了保護は既存経路を維持。全文checkpointの作成・原子的置換はpersistence側の同期契約を維持する。


### 範囲置換／composition準備の仮想化 — 2026-10-07

captureSelectionReplacementはManuscriptViewport.replacementPartsでparagraphのblock位置情報とcanonical文字列の断片を取得し、paragraphInputsによる全peer mountをしない。composition中は入力中textareaを保持し、存在するpeerのみ値・offsetを更新。未生成peerはsourceの文字列／offset、entry.values、placeholder寸法を更新し、古いhtmlを無効化する。削除peerはviewportとvirtualSourcesの両方から除く。確定後は既存reflowへ接続する。paragraphMarkupのclosureは更新可能なsourceを読むので、後のmountで古い置換前文字列を表示しない。位置情報配列・文字列断片・placeholder DOMは残る。Rust正本と保存形式は変更しない。

## Native graph tools

`graph_tools.rs` owns tool mode, pending character endpoint, selected edge, and inspector visibility in Rust. `graph-rail` and `graph-inspector` child WebViews only show metadata projections and input drafts. The inspector is a 300px panel on the right of the canvas, can be closed, and follows native window resize. Native input excludes both WebView regions, and routes selection/pan/click-to-connect through the shared engine.

Click picking samples the same cubic curve as the renderer, with an eight screen-pixel tolerance. Edge selection is ephemeral Engine view metadata, rendered as a colored halo. Reconnection is one Disconnect+Connect batch, so invalid ports, types or cycles roll back without losing the old cable; relationship endpoints cannot duplicate the other character. Form property changes are one validated batch and one Undo step. Saving uses the existing journal store and save worker retry notifications. No image/frame data crosses IPC.

Hidden canvas panels return only a hidden marker instead of cloning the workspace projection on manuscript-save events. Opening the canvas emits a refresh event to resume the tools. Inspector metadata is read from the Rust snapshot without transferring scene canonical text.

### 検証済み保存構造キャッシュ

段落差分の保存では、検証済みのノード構造と本文以外のDocument／Graphメタデータを保持する。候補全文をJSONとして再解析せず、同じ段落IDの変更前後・その他のプロパティ・ポート・接続・配置を照合する。差分外の変更、重複、古い段落、64件超、大きい変更は全文serializerへ戻す。キャッシュの本文はfsync成功後、完全に一致する変更前段落だけを変更後の値へ置き換える。全文経路の成功時は構造を再構築し、同期失敗やファイルstamp変化時は既存の保存キャッシュと一緒に破棄する。

構造は一世代分のノード内容を追加保持するため、常駐メモリが増える。変更のない本文を毎回parse・cloneする処理を削減する一方、構造照合・バイト列生成・SHA-256・Engine snapshotの全文処理は残る。RSSとrelease測定は次の工程。

### 作品内検索と範囲書き出し

検索はRust正本のsnapshotをworkerで読み、本文・セリフ・役者名・シーン名・メモを走査する。最大2,000一致を保持し、40件の抜粋とUTF-16位置・元revisionだけを返す。WebViewは検索語とページ位置を持ち、正本本文を検索用に所有しない。検索後にrevisionが変わった場合は対象シーンだけを開き、古いoffsetを適用しない。

書き出しのScopeはRustで検証した項目IDまたは本編／別展開。シーンの集合と祖先の構造見出しをRustで選び、すべての形式が同じ対象を使用する。外部snapshotは標準ファイルダイアログで選択したファイルだけをworkerで検証し、完成するまでは非公開の作品ディレクトリへ保存する。取り込みは現在の作品と元ファイルを変更しない。

### Graph viewport focus

Focus is a Rust-owned viewport command. It frames the selected nodes and their immediate neighbors, or the endpoints of a selected cable. Framing uses the unobscured canvas after reserving the icon rail and, when open, the inspector; it neither changes Document nor records an authored Undo operation. WebViews send only the action and display the existing selection projection.

### Portable Story Graph archive and lineage

The `.komyaku-story` archive is an application-specific binary format, not the shared Canonical Archive contract. It contains a versioned magic header followed by SHA-256 protected length-delimited records: preferences, a complete working snapshot, version count, and every immutable version's metadata/snapshot. The 2 GiB archive, 128 MiB snapshot, 16 KiB metadata and 512-version limits bound processing. No filenames from the input are extracted: canonical UUIDs identify only known snapshot/metadata paths. Import builds a hidden workspace, validates every document and history parent relation, syncs its files, and publishes it atomically. Export never replaces the destination before all records validate and the temporary file is synchronized. Credentials are excluded.

History metadata defaults legacy entries to `main`. Ordered parents may number zero, one or two; each must exist at an earlier unique sequence. This ensures a DAG independently of wall-clock time. Branch heads are derived from immutable sequence order. Fork copies verified history and creates a child of the selected version in a separate workspace. Merge finds one closest common ancestor, merges independent object fields, and treats authored arrays, text, deletion/edit and same-ID addition as explicit conflicts. Side choices must match the preview's conflict paths; revision and head are checked again. Final domain validation is required. The new workspace contains a working-draft checkpoint and a two-parent merged version, preserving the source workspace.

## Named reading paths and scene restructuring

`Document.extensions["komyaku.story.paths"]` owns up to 32 named, ordered scene-reference lists. Legacy main/alternative routes project into stable path IDs until the first path edit. A single batch updates references and the union of narrative adjacency edges; the generic DAG validator rejects cyclic orders without partial mutation. Outline containment remains independent. Reading-path exports follow reference order, including repeated ancestor headings when returning to another sequence.

Snapshots with document extensions use SavedWorkspace version 2; version 1 remains readable. This prevents older binaries from silently dropping named paths. New journal operation records use version 2 with a checksum over their payload and metadata; legacy version 1 records remain readable. The portable `.komyaku-story` archive accepts both snapshot versions.

Scene split accepts a canonical block boundary or a grapheme-safe UTF-16 offset within a paragraph. Existing block IDs remain on authored blocks; a split paragraph receives a new ID for its second half. Dialogue tables remain atomic. All routes containing the source receive the continuation. Merge requires adjacent outline siblings and matching consecutive membership in every route. It appends canonical blocks and notes, removes the second scene, and preserves an ID-based split/merge event under `komyaku.story.scene-lineage` (512 events maximum). Each restructure and its routes form one undoable command.

## Graph groups, portrait crop and graph export

Character groups are reversible `SetGroup` commands, capped at 32 groups with 80-character names and character-only membership. Rust-rendered backgrounds follow committed member bounds and native drag previews. Portable snapshots, history and archives retain memberships. Portrait import retains at most 8MiB of original bytes per authoring window in a temporary Rust store; previews and adoption bind the import token and document revision. The saved normalized PNG contains no original metadata. Later recropping requires reimporting the original.

Relationship PNG/PDF export builds an immutable filtered graph, includes localized labels and group backgrounds, fits all cards, and suppresses editing overlays. An offscreen native GPU target renders 3072×2048 pixels entirely in Rust. PNG is encoded there; PDF embeds a compressed RGB image. No frame bytes traverse the WebView. Outputs are written to a synced temporary sibling before replacement.

## PDF layout settings

PDF export accepts validated A4/B5/Letter dimensions, font family, font size and margins. Standard vertical pages and screenplay pages share the OpenType vertical glyph renderer. Script layout derives its rule, frame, line capacity and indentation from settings; impossible layouts are refused before file publication. Horizontal pagination and PDF media boxes use the selected dimensions. Settings are remembered in the current export UI session; they do not change the manuscript or editor appearance.

## Presentation state and failed persistence

Rust owns panel widths and physical window positions with logical inner sizes in a separate layout.json. Presentation changes never advance manuscript revisions. A debounced atomic writer coalesces changes; exit captures remaining windows and flushes immediately. Restore clamps rectangles to available monitors. WebViews receive layout projections and send resize commands; keyboard resizing shares the same contract.

Accepted edits return saved:false when disk persistence fails. The UI retains this distinction from unsent local input, and save_now retries the accepted Rust snapshot without replaying commands or advancing revisions. Close remains blocked until manuscript persistence succeeds.

## Explicit state and shared archives

Author-declared entities, initial state, conditions, effects and assertions reside in the narrative extension. Each named path evaluates independently, with conditions before scene effects. Missing and explicit JSON null remain distinct. Impact reports follow route, foreshadow and declared state dependencies. Typed value controls are a UI projection of the same bounded JSON contract.

Shared Archive v1 exports one Canonical document and the native graph through the workspace extension in a stored ZIP. Import validates ZIP structure, CRC, manifest and exact workspace reprojection before publishing a separate work. This bridge does not yet replace native composite persistence or history with shared Archive v2.
