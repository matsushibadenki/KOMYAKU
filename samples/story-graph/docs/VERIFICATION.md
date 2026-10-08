# Verification — 2026-10-02

## 執筆の構造見出し編集 — 2026-10-05

- まとめ執筆のシーケンス・シーン名と、パンくずの親ブロック・シーケンス名を入力欄へ変更。ブロック／シーケンスの主見出し、単独シーン名を含め、対象IDごとにRustの既存property命令で保存する。
- 独立bridge fixture＋Playwrightで横書き／縦書き2ケース成功。ブロック・シーケンス・複数シーンの編集、左ツリーへの反映、パンくずの親項目の編集、再読み込みによる保存保持、読むモードの入力欄なしを確認。自動保存後のカーソル位置、保存中の追加入力、保存失敗時の入力保持と再試行、見出し編集後のまとめ執筆の本文保存も確認。console error/warningなし。両書字方向のスクリーンショットで入力欄の表示を確認。
- `bun test test`: 22件・490 assertions成功。macOS debug app packageビルド成功。今回の編集操作はChromiumのfixtureで、実Tauri WebView・実OS IMEの操作は未検証。Rustの名前変更経路は変更なし。

## 構造見出しの太さ統一 — 2026-10-05

- ブロック名のtextarea（通常）、シーケンスのh2（650）、シーンのh3（500）に異なる太さが適用されていたため、種類別のサイズを保ち、まとめ執筆・パンくず・読む画面の構造見出しを400へ統一。
- 既存Playwrightと独立bridge fixtureで日本語の横書き／縦書き2ケース成功。まとめ執筆・パンくず・読む画面でcomputed font-weightがすべて400であること、文字サイズ・書体の一致を確認。console error/warningなし。横書きまとめ執筆のスクリーンショットを確認。macOS debug app packageビルド成功。

## macOSのウインドウボタン位置 — 2026-10-05

- OverlayタイトルバーのtrafficLightPosition.yを10→21へ変更し、36pxのWebViewタイトルバーに対してネイティブボタンを11px下げる。横位置12pxは維持。
- ローカルのtao実装でyがタイトルバーコンテナの高さに加算されることを確認。macOS debug app packageビルド成功。専用のtmp作品・認証保存先で起動し、CUAでタイトルバー・タイトル・パネルボタン・メニューを確認。OSの画面共有インジケーターが左上の3ボタンに重なるため、ボタン自体の目視確認は未完了。利用者の作品・認証を使用しない。

## 既定サイズと構造見出しの書体統一 — 2026-10-05

- Rust／ブラウザープレビュー／設定リセットの既定値を本文18px、ブロック30px、シーケンス25px、シーン22pxへ変更。既存の保存済みサイズは維持し、欠けているブロック／シーケンス値には30／25pxを補完。
- シーケンスの中間見出し・パンくずと読む画面の構造見出しへ本文フォントを適用。選択した明朝・ゴシック・等幅フォントが、ブロック／シーケンス／シーンへ揃って反映される。
- 独立bridge fixture＋既存Playwrightで3言語×横書き／縦書きの6ケース成功。初期表示とリセット後の既定サイズ、見出しと本文のcomputed font-family一致、手動変更と再読込みを検証。各ケースの書体は日本語＝明朝、英語＝ゴシック、简体中文＝等幅。console error/warningなし。日本語のまとめ執筆・読む画面のスクリーンショットを確認。
- 環境設定のRustテスト2件成功。旧設定と新しい既定値、保存・復元・無効値の拒否を確認。macOS debug app packageビルド成功。今回の画面操作はChromiumのfixtureで、実Tauri WebViewの操作は未検証。

## ブロック・シーケンス・シーン名の文字サイズ — 2026-10-05

- アピアランスに種類ごとの文字サイズ（12〜48px）を設置。既存titleSizeをシーン名として継承し、ブロック／シーケンスのサイズを追加。執筆のパンくず・まとめ執筆と、読む画面の構造見出しへ反映。
- Browser pluginは利用できないため、既存Playwright＋Chromiumと独立したTauri bridge fixtureを使用。日本語・英語・简体中文×横書き・縦書きの6ケース成功。34／24／28pxへUIで変更し、computed font-sizeを枠名・シーン名・パンくず・読む見出しで確認。再読み込みによる設定保持、初期化、49px入力の拒否、375pxのダイアログ収まりも確認。console error/warningとViteエラーなし。
- 1040×820の執筆／読む／設定と375×820の設定をスクリーンショットで確認。小さい画面のアピアランスタブの途中改行も解消。読む画面でブロックとシーケンスを重複表示しないことを確認。
- Rustの環境設定2テストで旧設定の既定値、保存・復元、12〜48px外と非有限値の拒否、無効な保存が既存値を置換しないことを確認。`bun test test`は22件・490 assertions、clippyとmacOS debug app packageビルドが成功。
- 今回の画面検証はChromiumのbridge fixture。実Tauri WebViewでの設定操作と分離ウインドウ間の同期操作は未検証。設定保存はRust、ウインドウは既存の設定イベントを利用。

## 台本PDFの縦組修正 — 2026-10-05

- 開きカッコ分の1文字追加も確認。2文字の役者名では2行目以降を3文字分下げ、セリフの最初の文字に揃える。折り返し・明示改行・改ページの既存テストを更新し、export関連6件とPDF生成fixtureが成功。PDFのセリフを再画像化して確認。
- 視覚QA fixture内で英字・半角の?!・句点・小書き仮名・括弧・長音・三点リーダーの描画パス境界を測定し、12ptのセル内（字体の張り出し許容1pt）に収まることを確認。回転する文字もフォントのascender／descenderに合わせて列中央へ配置。
- 添付manuscript-script-1.jpgに合わせ、タイトル枠の下辺を除去。枠と本文の文字セル端の空白を左右18ptに統一し、空のシーンで枠が連続する場合も18ptに揃える。
- usvgの横組字形の回転に代えて、rustybuzzの縦方向shapeとOpenType縦用字形・原点を使用。確認用4ページをPopplerで画像化し、句読点・括弧・小書き仮名・長音・三点リーダー、枠、余白、ページ番号、長文の続きに欠けや重なりがないことを目視確認。
- 追加のレイアウトテストで枠の両側の空白が等しいこと、長いセリフの折り返し・明示改行・改ページの開始位置が役者名2文字＋開きカッコ1文字分下がること、本文の欠落がないことを確認。既存の20,000文字・長いタイトル・本文のページ境界の検証も成功。
- `cargo test -p komyaku-story-graph --locked`: 41件成功・2件ignore。視覚QA fixtureは別途実行して成功。`cargo clippy -p komyaku-story-graph --all-targets --locked -- -D warnings`、`bun test test`（22件・490 assertions）、macOS debug app packageビルド成功。
- pypdfで4ページから元の句読点・小書き仮名・セリフを抽出できることを確認（縦組抽出時の文字間改行を除いて照合）。テキスト層の字体は埋込み、可視の縦用字形はパス。今回の変更後の保存ダイアログ操作、他OSの字体とPDFビューアの選択操作は未検証。縦中横・高度な禁則は未実装。

## 台本PDF — 2026-10-05

- ファイル→書き出し→PDF→標準／台本へメニューを拡張。台本は添付のhonbun-drama2.jpgを参考にA4縦型、約1/3の罫線、罫線上のシーン番号と下の縦書きタイトルを囲む枠、縦書き本文、ト書きの6文字字下げ、ページ番号、余白を実装。
- Rustレイアウト2テストで20,000文字の欠落なし、番号順、役者名と引用符、本文／ト書きの開始位置、左右・下端の境界、見出しと本文列を一緒に次ページへ送ること、非常に長いタイトルの保持を確認。PDF生成fixtureテストは明示実行して成功。既定では2つの視覚QAテストをignore。
- `cargo test -p komyaku-story-graph --locked`: 40件成功・2件ignore。`cargo clippy -p komyaku-story-graph --all-targets --locked -- -D warnings`、`bun test test`の22件・490 assertions、macOS debug app bundle生成成功。
- Browser plugin not available。独立Tauri bridge／作品fixtureと既存Playwright＋Chromiumで日本語・英語・简体中文の4形式、編集の保存後に書き出し、エラー／キャンセル、Escape、1040×820／375×820のメニュー表示を確認。console error/warning、Viteエラーoverlayなし。既存のMarkdown中文ラベルも修正。
- 台本fixtureの4ページをPopplerで画像化し、枠・罫線・番号・縦書きの句読点／括弧・字下げ・改ページを目視確認。pypdfで日本語本文と最後のセリフ「終わり。」を抽出。試験中の初回UIテストはサブメニューsummaryが2個になったためlocatorが曖昧で失敗し、階層を区別して再実行成功。
- 専用tmp作品・auth storeで実macOSアプリを起動。CUAでPDF→台本を選択し、標準保存ダイアログからtmpへ保存。完了表示、.pdf拡張子、既定-script.pdf名、実出力の番号付き全5シーン（別展開を含む）を確認。実出力PDFの1ページも画像で確認。利用者の作品や認証は使わない。
- 台本のト書きはparagraph、セリフは既存のセリフシートから分類。手入力の本文中の引用符を自動解析しない。字体・サイズ・用紙・字下げ・罫線位置は固定。縦中横、用紙／余白の設定UI、巨大作品の出力時間測定、他OSでの保存は後続対応。

## 作品の書き出し — 2026-10-05

- ファイル→書き出し→TXT／Markdown／PDFを実装。Rust正本から構造順に全シーン（別展開を含む）を取得。画面外の入力DOM、Reading View、現在の折りたたみ状態には依存しない。
- `cargo test -p komyaku-story-graph --locked`: 38件成功、PDF視覚検証用1件は既定でignore。既存の認証loopbackテストは通常sandboxで拒否されたためデスクトップ権限で再実行して成功。`cargo clippy -p komyaku-story-graph --all-targets --locked -- -D warnings`: 成功。`bun test test`: 22件・490 assertions成功。macOS debug app bundle生成成功。
- Rustの新規3テストで構造順・別展開・空作品・メモの除外、Unicode・Markdownのエスケープ・改行、拡張子検査、既存ファイルの一時ファイル置換を確認。
- Browser plugin not available。既存Playwright＋Chromium、独立したTauri bridge／作品fixtureで日本語・英語・简体中文の各3形式を確認。編集を保存してから命令送信、キャンセル、エラー表示、Escapeでメニューを閉じる、1040×820／375×820でメニューのはみ出しなし。console error/warning、Viteエラーoverlayなし。補足の「A4・横書き」は一行で表示。
- PDFの視覚検証テストを明示実行し、4ページのA4 fixtureを生成。Popplerで全4ページをPNGにして確認。見出し・本文・セリフ2列・ページ番号に重なりや切れなし。pypdfで日本語・英語・中文の文字抽出成功。lopdfのpage抽出はForm XObject内の文字を拾わないため、テストではページ数・ToUnicodeを確認し、実文字はpypdfで別途確認。
- 実macOSアプリを `/private/tmp/komyaku-export-native-20261005` と専用auth storeで起動し、CUAで標準保存ダイアログから各形式をtmpへ保存。成功表示と出力ファイルを確認。TXT／MarkdownはUTF-8、日本語本文と別展開を含む全5シーンを確認。実出力PDFの日本語を抽出し、A4の1ページを画像で確認。利用者の作品・認証は使用しない。
- PDFはA4横書き・固定の字体／サイズ／余白。システムフォントを利用して埋め込み、書記素を保って折返し、英単語・基本的な日本語の禁則を考慮。縦書き、現在のアピアランス設定の反映、ルート指定、巨大作品の出力時間測定、他OSの保存ダイアログは未検証。

## 範囲選択表示のDOM生成削減 — 2026-10-05

- 独立した作品fixture／Tauri bridgeと既存Playwright＋Chromiumで16ケース成功。100万字・40万字・CRLF入り100万字の横書き／縦書きでは、全選択後のtextarea数が1〜3個。全文コピーのUTF-16長は編集済み正本と一致し、選択中に先頭へスクロールすると再生成した非アクティブ欄に選択色が反映される。
- 横書き100万字の追加実行ではMutationObserverで全選択・スクロール中の一時生成も計測し、最大3入力欄。その他のケースの1〜3個は全選択後の計測値。範囲削除、CRLF境界、セリフ編集・幅・合成compositionの既存フローも成功。console error/warningなし。
- `bun test test`: 22件・490 assertions成功。`bun run package`: macOS debug app bundle生成成功。Rustの正本・保存・Undo経路に変更なし。
- 検証中、アクティブ欄のネイティブ選択をCSS選択色で判定したテストが失敗したため、スクロール先の非アクティブ欄を検証するよう修正。実Tauri WebView・実OS IMEは未検証。範囲置換／IME準備時の全段落一時生成と全文snapshot保存の走査は残る。

## 通常入力時の一時DOM生成削減 — 2026-10-05

- 既存Playwright＋Chromiumと独立したTauri bridge／作品fixtureで16ケース成功。横書き／縦書きの本文・グループ執筆・セリフ・巨大段落を検証し、console error/warningとViteエラーoverlayなし。通常／セリフケースは1040×820と820×650の画面を確認。
- 100万字・40万字・CRLF入り100万字の各横／縦書きで、MutationObserverによる通常入力・隣接表示単位への移動中のtextarea最大数は2個。先頭へのAと絵文字挿入後、次の表示単位へのB挿入が正本UTF-16位置と一致。画面外から再生成した入力欄の編集内容・開始位置・長さも保持。
- CRLF境界の移動位置と、境界をまたぐ4 UTF-16単位のコピー・削除を検証。正本の段落数は1のまま。既存の通常境界2文字の選択・削除、セリフの値・幅・ドラッグ・合成compositionイベント・新規追加フォーカスも成功。
- `bun test test`: 22件・490 assertions成功。`bun run package`: frontend buildとmacOS debug app bundle生成成功。Rustの正本・保存・Undo経路に変更なし。
- 実Tauri WebView・実OS IME・複数ウインドウは追加QA。明示的な範囲選択時の全段落一時生成、プレースホルダー数、全文snapshot保存の走査は残る。フレーム時間・保存時間の改善は今回測定していない。

## セリフシートのDOM仮想化 — 2026-10-05

- `test/manuscript-viewport-browser.mjs`を拡張。Browser plugin not availableのため既存Playwright＋Chromium、`http://127.0.0.1:1448/`、独立したTauri bridge／作品fixtureで検証。利用者の作品・認証には接続しない。
- 横書き／縦書きで本文500＋セリフ500の混在、ブロック執筆、セリフのみ1,000シートを検証。混在時の初期生成は19／21シート、グループ執筆は17／19シート。画面外のシート除去と再生成、両セルのUnicode・改行・手動幅の保持を確認。
- キーボードで幅80→82、3pxドラッグで85へ変更。つかむ位置の違いで幅が飛ぶ問題を修正。幅のドラッグ中に末尾へスクロールしてもtableとpointer captureを保持し、再表示後も85を保持。追加したセリフの役者名へフォーカスが移ることを確認。
- compositionstart→フォーカス移動→末尾スクロールで対象シートが保持され、compositionend後に除去可能になることを合成イベントで検証。実OS IMEの入力検証とは区別する。
- 縦書きで幅保存後に先頭へ戻る不具合を修正し、単一シーンの横スクロール位置を再描画後も保持。
- 本文8ケース＋セリフ6ケースの14ケースを実行。URL・タイトル、本文の存在、Viteエラーoverlay、console error/warning、1040×820→820×650の画面を確認。faviconのみ既存dev pageの仕様に合わせ204へ差し替え。
- `bun test test`: 22件・490 assertions成功。macOS debug app bundle生成成功。Rustの正本・保存・Undo経路に変更なし。実Tauri WebView、実IME、複数ウインドウ競合は追加QA。プレースホルダー数と巨大なセリフセルの分割・性能測定も残る。

## 本文入力DOMの仮想化 — 2026-10-05

- Browser plugin not available。既存Playwright＋Chromium（ローカルの検証用ブラウザー）で `http://127.0.0.1:1448/` を検証。Tauri invoke・作品・保存先はブラウザー内の独立したfixtureで代用し、利用者の作品や認証には接続していない。Rust保存の実検証とは区別する。
- フロー：本文／ブロック執筆を開く→入力→末尾へスクロール→先頭へ戻る→編集内容を再表示。100万字／40万字の単一段落ではShift＋クリックで分割境界をまたぐ2文字をコピー・削除し、正本の文字数と段落数を検証。
- 1040×820、リサイズ後820×650。横書き・縦書き×通常1,000段落／グループ1,000段落／100万字／40万字の8ケース成功。通常1,000段落は39／43入力欄、グループは35／38入力欄、巨大段落は初期1入力欄。画面外のtextarea除去・再生成、編集保持、段落ID・段落数の維持、方向別スクロールを確認。
- ページURL・タイトル、本文の存在、Viteエラーoverlayなし、console error/warningなし、スクリーンショットを確認。デスクトップappのアイコンはTauri bundle側なので、dev pageのfaviconリクエストのみ204へ差し替えた。
- `bun test test`: 21件・485 assertions成功。`bun run package`: macOS debug app bundle生成成功。Rustロジックへの変更はない。
- 縦書き40万字の範囲削除で、再分割後の全入力欄を同期計測する遅延を検出。再分割時も入力欄を遅延生成し、カーソル位置の入力欄だけ即時生成・計測するよう修正。
- 再実行：検証用Viteを1448番で起動し、`node test/manuscript-viewport-browser.mjs`。`STORY_GRAPH_QA_URL`、`STORY_GRAPH_QA_BROWSER`（既存Chromium実行ファイル）、`STORY_GRAPH_QA_OUTPUT`でURL／実行ファイル／画像出力先を指定可能。既定の画像出力はOSのtmp。
- WebKit検証は手元の既存runtimeで起動後に結果が返らず中断。実Tauri WebView、実IME、分離パネル・複数ウインドウのnative QAは未完了。セリフシート、全プレースホルダー、範囲操作中の段落全体の一時DOMは削減対象として残る。全文保存の時間やフレーム時間の改善は今回測定していない。

## 長段落のShift＋クリック範囲選択 — 2026-10-04

- `bun test test`: 20件成功、480 assertions。遠い表示断片への選択、始点を保った方向反転、CRLF、既存の跨ぎ範囲置換・IME継続用の入力欄保持を検証。
- `bun run package`: frontend buildとmacOS debug app bundleの生成成功。
- 同一段落・同一シーン内のShift＋クリックを対象とする。横書き／縦書きともWebKitのnative hit-test位置を用い、文字の座標を独自推測しない。
- 実WebViewのShift＋クリック、実IMEとの連続操作、グループ執筆でのnative QAは未完了。ドラッグ／複数段落選択、完全DOM仮想化は引き続き[Next]。

## AI writing and authentication — 2026-10-03

- App-specific Rust tests: 31 pass, including actual loopback cancellation with desktop sandbox approval, OAuth/JWT trust boundaries, private credential storage, independent-store locking, refresh scheduling, SSE split UTF-8/CRLF and late failure, supported request fields, model filtering/order, and changed-manuscript protection.
- Existing UNGE workspace tests pass; the two dedicated GPU tests remain outside this auth/text change.
- `bun test test`: 11 pass, including three-language key parity with the new AI messages.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: pass.
- `bun run package`: macOS app bundle builds.
- Native macOS UI verified at 1040×820 using an isolated `/tmp/komyaku-ai-qa.RcbHqZ` workspace/auth store: AI writing opens, reviewed source shows the selected scene's text, Continue preset populates the request, unauthenticated sending/applying stays disabled, and Preferences → AI shows Continue with ChatGPT and current assistance guidance.

The native screenshots show a meaningful scene editor and complete AI/settings dialogs without a framework overlay. No real account consent, manuscript transmission, live inference, or production token refresh/revocation was performed. Connected model selection, completed-result application through IPC, and provider-specific account eligibility still require a user's authenticated live smoke test. Parser/append/error-path behavior is verified in Rust tests. Browser plugin was unavailable; the Tauri WebView was inspected directly through native computer use. Runtime console capture was not available in this native UI check.

## Automated checks

- `bun run build`: pass.
- `bun test test`: 4 tests pass. Canonical schema adapter, Unicode preservation, two story routes, relationship endpoints and all three translation key sets.
- `cargo test --workspace --locked`: 74 tests pass; 2 GPU tests are ignored by default.
- `cargo test -p unge-render --test render --locked -- --ignored`: both GPU tests pass with desktop Metal access. Pixel validation and English/Japanese/Simplified Chinese text, clipping, layering and two DPI scales.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: pass.
- `cargo fmt --all -- --check`: pass.
- `bun run package`: development macOS `.app` built. Signing/notarization is outside this initial implementation.

The sandbox initially could not access Metal. The explicit desktop GPU run passed. Cargo reports an upstream future-compatibility warning for `block 0.1.6`; the current build passes.

The eight app-specific Rust tests cover semantic relationship cycles without flow cycles, registry executors/caching/cancellation, rollback of invalid relationships, canonical IDs and Unicode, flow disconnection reporting, full snapshot roundtrip and unknown format rejection, text editing/reload/stale-window rejection, character deletion and undo, appending and deleting shared scenes without disconnecting routes.

## UI inspection

Codex Browser/IAB was used for the read-only preview. Main/alternative route switching visibly changes the development scene. Reading View displays four scenes in order. Japanese, English and Simplified Chinese controls were inspected; author text remains Japanese as authored.

Responsive measurements: `document.documentElement.scrollWidth === innerWidth` at 320, 375, 414, 768 and 1280px. Narrow layouts use one column and at least 16px horizontal padding. Desktop writing text is 17px; note text is 14px. Headings and navigation were inspected for sensible wrapping.

The packaged app's native WebView and separate UNGE/wgpu canvas were inspected by screenshot on macOS. GPU titles include actual scene/character/relationship names, Japanese characters and ports. This establishes native startup/rendering, not complete native editing QA.

## Reference comparison

The supplied `docs/images/Story-Graph-images.png` was viewed with `view_image`. Implementation screenshots were viewed through Browser/IAB and native computer-use screenshot tools. Checked:

1. Pale paper/surface treatment, fine borders and blue selection in the authoring UI.
2. Navigation → writing → relationships layout on wide screens; narrow-screen collapse.
3. Serif body typography and compact sans-serif authoring controls.
4. Scene labels and route semantics, with readable title/body/notes hierarchy.
5. Native node titles, connection ports and alternative route connections.
6. No copied decorative illustrations or inert rich-editor controls.

Intentional differences: UNGE uses its existing dark native canvas in a separate window. The reference's illustrated inline canvas and rich text toolbar are not reproduced. Scene text supports plain-text paragraphs and inline dialogue tables with one row and two cells. The project and scene seed are an explicitly fictional example. Therefore this is a functional initial app inspired by the reference, not a pixel-identical implementation of the full concept.

## Remaining native QA

UI-driven creation/editing/deletion, live IME composition, draft conflict review, float/dock transitions, close/restart with active text input, native pointer/DPI lifecycle and disk-error recovery remain to be completed. These are marked [Next] in the roadmap, even where the supporting engine behavior is tested.

## Desktop interface follow-up (2026-10-02)

The requested desktop layout replaces the earlier horizontal-padding rule: outer sidebar and editor padding is now 0. Browser inspection at 1280×800 and 320×650 confirmed the page dimensions match the viewport, with scrolling contained in the editor and item list. The View menu opened and switched to Reading successfully. File, Edit, Insert, View and Window menus are localized in Japanese, English and Simplified Chinese. Frontend build and all four JavaScript tests passed.

## Floating panel close fix

The local controls/editor capability now permits window close and destroy, as required by Tauri’s `onCloseRequested` listener. Docking waits for the actual Destroyed event before publishing the docked state, so a prevented close cannot falsely restore the main editor. The debug macOS app was rebuilt. Interactive verification after restarting the running app remains required.

## Left icon menu area

Both windows reserve a 48px strip. The native graph uses a child WebView for menu UI; Rust/wgpu clips graph geometry and text outside that strip and ignores graph pointer-down/zoom inside it. Initial pan compensates for the reserved width. The packaged native graph was visually inspected with the rail present. The graph rail is intentionally empty for future menu additions.

## Preferences

Logo menu opens a modal with left-side Language, Appearance and AI tabs. Browser QA confirmed body size changes to 24px immediately and survives reload. Font selection and AI tab rendering were inspected. Rust owns the native preferences store, saves it separately from manuscript data, validates font/language enums and numeric ranges, and broadcasts changes to both editor WebViews. A Rust test confirmed rejected numeric values do not replace saved preferences. AI service integration remains unimplemented.

## Nested narrative structure

Browser QA confirmed the 3-level outline, collapse behavior, three add icons, parent selector and graph icon at the bottom of the left icon rail. JavaScript tests cover route filtering, nested depths, collapse and legacy unparented scenes. Rust tests reject invalid parent levels and nonempty container deletion, preserve Canonical Document identity during reparenting, persist and reload parents, and restore the old parent with Undo. Structural hierarchy does not reorder existing narrative route edges.

## Title bar panel controls

The macOS main window uses an overlay title bar with native traffic lights; the custom drag region shows the work title and two panel controls at the right. Browser QA confirmed closing both controls hides the left icon rail, navigator and right relationship panel, expands writing to 1280px in a 1280px viewport and keeps root scrolling disabled. Focus display hides metadata/notes while retaining title and body. Panel visibility is persisted with preferences, with defaults for older preference files.

## Strict folder tree and drag/drop

Drop commands accept sibling before/after or an immediate parent folder only. Rust tests reject reversed/skipped levels, reject root scenes and folder text updates, migrate old root scenes without changing canonical identity, reorder siblings without changing narrative route text and Undo the move. JavaScript tests cover valid/invalid drop plans. Blocks/sequences have heading-only UI; scenes own the manuscript. Native drag gesture verification remains separate from command-level tests.

## Tree indentation

Each depth adds 24px of indentation. Leaf scenes reserve the same 18px disclosure slot as folders, so icons and headings align consistently. Browser measurements showed first-level icon x=75, second-level x=99 and third-level x=123, confirming a uniform 24px step.

## New workspace

A Rust test verifies exactly one block, sequence and scene, strict parent links, empty canonical text/notes, no relationships or narrative edges, and independent node/document IDs between new works. File menu places New first and Ctrl/Cmd+N invokes the same command. New works have separate snapshot paths and Rust hosts. Packaged macOS UI QA confirmed File → New opens an independent “無題の作品” window with the three nested unconfigured nodes and a 0-character body. Closing the source application instance leaves the new work open. macOS bundle launches use LaunchServices (`open -n`) to register the separate application instance.

## Compact outline rows

The disclosure triangle is positioned inside the row selection border, with the same internal slot for scenes and containers. Tree titles increase from 11px to 13px; vertical padding decreases from 10px to 5px and subtitle spacing to 1px. Existing 24px parent/child indentation remains. Browser preview QA at 1280×720 confirmed expanded hierarchy, block collapse/re-expansion and sequence selection with its triangle inside the highlighted border. The macOS app bundle was rebuilt. Native drag-and-drop behavior was not re-tested for this CSS-only change.

The compact row disclosure slot was further reduced to 14px, with icon inset reduced from 24px to 17px. Preview inspection at 1280×720 confirmed the block, sequence and scene icons occupy separate columns 24px apart (15px icons), with reduced disclosure/icon spacing and no overlap.

## Native outline indentation correction

Packaged Tauri CSP (`style-src 'self'`) blocked the inline `--depth` declaration, so earlier browser-only checks missed the flat native layout. Removed inline depth styling and derive offsets from `aria-level` in the external CSS: block 0px, sequence 20px, scene 40px. Internal padding preserves the full-width selection background. Packaged macOS screenshot QA confirmed three distinct icon columns, nested disclosures and full-width selected scene background. JavaScript tests: 6 passed; macOS bundle rebuilt successfully.

## Startup visibility

Right relationships panel resets closed on every app startup, including saved preferences and new workspaces. The Rust canvas window is created with `visible(false)` and main controls receive focus. Packaged macOS QA confirmed the right panel initially absent; the titlebar toggle restores it, and Open Graph restores/focuses the initially hidden UNGE canvas. App tests and macOS packaging succeeded.

## Scene breadcrumb heading

Scene editing combines block and sequence names (small muted text) with a larger editable scene title in a breadcrumb above the manuscript. The duplicate scene/type and title labels and parent selector were removed for scenes; structural movement remains in the left tree. Ancestors resolve by IDs, so reparenting updates the breadcrumb on refresh. Preview screenshot at 1280×720 confirmed the full three-part hierarchy and uncluttered body. Title retains the existing `data-field` draft/autosave path and localized accessible name. Narrow layouts wrap the title below ancestor context. The packaged app was rebuilt.

## Work title field

Replaced the structural hint in the scene navigator with an 18px work-title input. Title is document-level Rust state, persisted in the story snapshot with a backward-compatible serde default, independent of block names. SetDocumentTitle uses engine history and optimistic revisions; authoring reuses IME-aware draft/autosave and window title synchronization. Rust regression verifies Unicode title persistence, undo and length validation. Browser screenshot confirms the hint is removed and title is legible. JS tests and workspace checks passed; macOS bundle rebuilt.


## Inline dialogue sheets

The Dialogue button appears immediately left of Float Text Panel and inserts a canonical one-row/two-column table at the last manuscript caret (or at the end when no caret exists). The original paragraph and document IDs remain; new blocks receive unique IDs. Actor and dialogue fields edit independently through the IME-aware canonical draft/autosave path. Reading View renders the table too. Rust validates supported shapes/IDs/limits, prevents legacy plain-text edits from destroying tables, and persists the canonical document through shared Undo/Redo.

JS insertion/editing tests pass; Rust regression covers persistence, text extraction, malformed shape rejection and Undo. Packaged macOS QA confirmed the button location, existing editable actor/dialogue fields, structured reading view, insertion at a caret, focus on the new actor field, and Undo restoring the original paragraph and earlier table.

## Dialogue typography and spacing

Dialogue actor and text inherit the same writing font, size, weight and line height as manuscript paragraphs. Removed all sheet/cell rules and vertical padding/margins; the background mixes only 1% ink into the editor surface. Textareas measure their content height from zero so single-line cells occupy one writing line. Narrowed the actor column and removed the empty paragraph placeholder for a continuous manuscript appearance. Packaged macOS screenshot inspection confirmed matching typography, no grid lines, near-invisible shading and continuous line spacing. App rebuilt.

## Outline context deletion

Block, sequence and scene tree rows expose a localized Delete context menu on right-click or Control-click; keyboard Context Menu/Shift+F10 also opens it. Deletion uses the clicked row's ID rather than the current editor selection, preserves the existing confirmation/Undo and nonempty-container guard, and commits drafts through the existing mutation path. Escape/outside click/scroll dismiss the menu. Removed the scene editor's trailing Delete button. Packaged macOS QA confirmed right-click menus on sequence and scene rows and absence of the scene footer Delete control; bundle build succeeded.

## Collapsible notes and stretching manuscript

Scene notes now use a native details/summary disclosure with a triangle, collapsed by default; open state survives draft renders during the session. The scene editor uses a column flex layout and the final manuscript paragraph consumes available height, while retaining its measured content minimum. Notes/character count occupy the bottom of the editor. Packaged macOS screenshots confirmed the manuscript extends to the bottom area and notes are initially absent; clicking the triangle reveals the notes input. The app bundle was rebuilt.

Character count moved from the scene footer to the right end of the manuscript heading, opposite Text. It updates on manuscript/cell input and uses tabular digits. macOS bundle rebuilt successfully.

## Dialogue column sizing

Actor column auto-measures the widest name line with the actual manuscript font and adds one root rem of space. Both cells align left/top. The invisible separator supports pointer dragging, left/right keyboard adjustment, and double-click reset to automatic sizing. Manual width persists as validated canonical table extension metadata and participates in Undo. Existing tables need no migration. JS regression checks width retention through cell edits, reset and invalid values. Native macOS QA measured 高橋 at 50px (34px text +16px rem), then dragged the separator to 126px. Bundle rebuilt successfully.

Manuscript focus rings now paint above adjacent dialogue-table backgrounds using a positioned focus stacking layer. This changes neither line height nor padding/margin. Packaged macOS screenshot QA confirmed all four edges, including the lower edge of a paragraph directly preceding a dialogue sheet, remain visible. Bundle rebuilt.

## 大容量本文 — 2026-10-03

`bun run check`（JS 11テスト、Rust workspace）、`bun run package`が成功。追加テストは10万字／100万字（1段落1,000字）のコピーオンライト更新・差分文字数、改行による表示分割、絵文字／結合文字のUTF-16編集境界、Rustの差分更新・ID維持・保存／再読込・Undoを確認します。

このMacのデバッグビルドで測定した単発の参考値：

| 本文量 | JSモデルの100回更新 | Rust差分適用＋検証 | snapshot保存 |
| --- | ---: | ---: | ---: |
| 10万字 | 0.17 ms | 23.20 ms | 34.20 ms |
| 100万字 | 0.59 ms | 215.56 ms | 93.61 ms |

JS値はDOM描画を含まないマイクロベンチマークです。Rust値には段落範囲更新からEngine適用までを含み、保存は別計測です。初回読み込み・画面描画・IPC・入力遅延・FPSの計測値ではありません。

専用の `/tmp/komyaku-performance-qa` に100万字／1,000段落の保存済みfixtureを置き、識別子 `dev.komyaku.performance-qa` のmacOS検証用appで実表示を確認しました。本文への「検証」の貼付後、保存JSONの文字数が1,000,002へ増え、編集メニューのUndo後に1,000,000へ戻ることを確認。スクロール中もタイトルバー・左サイド・上部ツールバーが固定され、本文領域だけが移動します。初期表示とフォーカス枠もスクリーンショットで確認しました。

100万字の機能確認は完了していますが、全DOMのメモリ削減、分割入力欄をまたぐ選択、改行なし巨大段落、複数ウインドウへの範囲通知、Reading View全体の性能保証は次段階です。通常保存も全snapshotのJSON書込みを使うため、本文量に比例するRust側の時間が残ります。

追加の回帰確認では、通常の本文途中へのセリフ挿入、役者名とセリフの保存、名前の自動幅50px、本文の下側フォーカス枠が表示されることを確認。最終 `cargo clippy --workspace --all-targets --locked -- -D warnings` とmacOS再パッケージも成功しました。

## 縦書き — 2026-10-03

Browser plugin not available。Tauriの実WebViewをCUAで検証。専用 `dev.komyaku.vertical-qa` appで、右端から進む本文の縦書き、セリフの役者名・本文編集、複数列、保存後の再起動と内容維持、横書きへの切り替えを確認しました。WebKitの段落wrapperの幅不足による重なりを実画面で発見し、textareaとwrapperの列幅を明示して修正しました。方向の設定はRust Preferencesで保存し、旧設定ファイルは横書きを既定値として読み込みます。日本語・英語・简体中文の設定ラベルに対応。

自動検証はJS 11テストとRust workspaceを通過。Preferencesテストで縦書きの保存／再読込、旧形式の横書き既定値、不正な方向値の拒否を確認。縦中横や独自の組版エンジンは未実装で、文字の向き・句読点の組版はWebViewに従います。縦書きの100万字での入力遅延・描画フレーム測定は未実施です。

### 縦書きの役者名の右揃え

役者名の入力欄をセルの右端へ配置し、役者名・セリフのセル幅を実測したシート幅に揃えました。WebKitの縦書きtextareaの列幅不足は、改行数と表示高から求めた最小列幅でも補正します。専用macOS appで、名前「高橋」と2列のセリフ、空の役者名placeholderと「こんにちは。／それは何故？」の2列が、それぞれ同じ右端の列に揃うことを確認。macOS packageビルド成功。

### 縦書きで改行した直後のカーソル

実WebViewで、セリフ「今日の駅は寒いですね。」の後にReturnを入力すると、空の最終列のネイティブカーソルが約2文字分下へずれることを再現。幅を0へ縮める計測を除き、空の最終列にカーソルがある場合だけ先頭位置に表示用カーソルを重ね、文字入力・選択移動・フォーカス移動・IME開始時には通常カーソルへ戻します。textareaとcanonicalの文字列は変更しません。

専用macOS appで改行直後の先頭表示と、その後「次の行です。」を入力したときの正常な文字配置を確認。保存JSONは `今日の駅は寒いですね。\n次の行です。` で、補正用文字・先頭空白は含まれません。JS 11テスト通過、macOS再ビルド成功。

### 「読む」の縦書きレイアウト

編集用の縦書きシートのスタイルをmanuscript内へ限定し、読む画面には独立した読み取り専用シートのレイアウトを設定しました。固定の本文表示高と横スクロール用viewportを分離し、見出し・段落・シートが縦書きのブロック進行方向（右→左）に並びます。マウスホイールも横方向の読み進みに対応。

専用のmacOS検証用appで、本編4シーン、複数の2列セリフ、改行を含むセリフ、役者名の右端配置が重ならないことをスクリーンショットで確認。読む状態で横書きへ切り替え、通常の読み取り表示も維持することを確認しました。検証用fixtureは大量テキスト性能測定用の100万字シーンを短い文章へ置き換えた専用コピーで、実作品は変更していません。

### 役者名の太字設定

アピアランスのチェックボックスを実macOS appでオフからオンへ変更し、チェック状態・Rustのpreferences.jsonのactorBold=true・縦書きの執筆画面と読む画面の役者名の太字を確認。旧Preferencesではfalseを既定値として読み込み、Rustの保存／再読込テストではtrueも保持します。英語・日本語・简体中文のラベルに対応。bun run checkとmacOS packageが成功しました。

### 左ツリーの名称変更

右クリック／Control＋クリックのメニューに「名前を変更」を追加。専用の検証用macOS appで、ブロック・シーケンス・シーンそれぞれの変更、ツリーとパンくず／シーンタイトルへの反映、本文の維持、編集メニューのUndoによる名称復元を確認しました。選択中のシーン以外の項目を変更しても、編集中のシーンは維持されます。空白だけの名称は拒否し、日本語・英語・简体中文に対応。JS 11テストとmacOS packageビルド成功。

### ブロック／シーケンス内のまとめ執筆

専用macOS app `dev.komyaku.groupqa.QvSrZ7` と `/tmp/komyaku-group-qa.QvSrZ7/data` で検証。ブロックとシーケンスの選択で、本編／別展開を含む5シーンが重複なく構造順に表示されることを確認しました。ブロック表示で2シーンの本文を変更し、シーケンス表示へ切り替えて双方の保存を確認。2番目のシーンへセリフを挿入・編集し、個別シーン表示でも本文と役者名・セリフが保持されることを実画面で確認しました。縦書きへ切り替えて本文を編集し、Undoで変更前へ戻ることも確認。保存JSONでも各シーンの内容を照合しています。

ブラウザプラグインは未提供のためTauri実WebViewをCUAで操作。実作品は変更していません。構造順、別ルートの包含、他の枠の除外、空の枠をJSテストで検証し、合計12テストとmacOS packageビルドが成功。複数シーンをまとめた状態での大容量性能測定と複数ウインドウ競合の追加QAは未実施です。

### まとめ執筆の横方向連続表示

専用macOS app `dev.komyaku.flowqa.skLQXu` で検証。シーケンス／ブロックのタイトル、シーケンス見出し、各シーンの見出しと本文が、縦書きでは右から左へ連続することを実画面で確認。本文上のホイール操作で同じ横スクロール領域を進み、最後のシーンまで表示できました。本文変更後に別の枠を選択しても変更が保存され、セリフの役者名と本文も保持されます。横書きへ切り替えると左から右へ各シーンが並ぶことも確認。12 JSテストとmacOS packageビルド成功。

### 保存済み作品を開く — 2026-10-03

専用macOS app `dev.komyaku.libraryqa.vUVsET` と `/tmp/komyaku-library-qa.vUVsET/data` で検証。ファイル→「開く…」の作品一覧、作品名検索、更新日時、現在の作品・既に開いている作品の無効化、破損データのエラー行を実画面で確認。選択した作品が別ホストで開き、親作品を終了しても継続することを確認しました。開いた作品の本文を変更して保存・終了し、別作品の一覧から再オープンして同じ本文が維持されることを確認。親作品の本文は変更されていません。

独立した `dev.komyaku.newqa.vUVsET` ではファイル→「新規」で作成した作品が同じライブラリの一覧へ登録され、「既に開いています」と表示されることを確認。保存JSONはブロック・シーケンス・空本文のシーンの3ノードで、保存先が親作品の内部へ入れ子になっていないことも照合しました。破損fixtureのバイト列は変更されていません。実作品は変更していません。

JS 12テスト、Rustアプリ33テスト、Clippy（warnings禁止）、macOS package成功。初回のRustテストではsandboxが既存認証テストのloopback listenerを拒否したため、ローカル接続を許可した再実行で33件すべて通過。新規のRustテストは作品カタログ・破損データ不変・不正ID拒否・排他ロックと解放を検証。Windows/Linuxでの起動・OSロックのnative QA、外部ファイルの取り込み、バックアップ復元は未実施／未実装です。

### snapshotバックアップの復元 — 2026-10-03

専用macOS app `dev.komyaku.restoreqa.LY839Y` と `/tmp/komyaku-restore-qa.LY839Y/data` で検証。ファイル→「バックアップから復元…」で保存日時、有効／破損バックアップ、選択後の5シーン・13項目、復元タイトル初期値を確認しました。作品名を指定して復元すると別作品として起動し、バックアップ時点の本文を実画面に表示。復元した作品が「開く」の一覧へ登録されることも確認しました。ワーカーへ移した通常のバックアップ作成も、実メニューから実行して保存完了と保存先を確認。

保存データの照合では復元Graphがバックアップと一致（本文・セリフ・人物相関・IDを含む）、元作品のGraphが不変、正常／破損バックアップのバイト列が不変でした。実作品は変更していません。CUAの初回アプリ接続は約9分かかりましたが、接続後のメニュー・復元操作は確認できました。

JS 12テスト、Rustアプリ34テスト、Clippy（warnings禁止）、macOS package成功。追加テストは復元先の独立性、Graph ID／本文の保持、元snapshot・バックアップの不変、不正ID・空タイトル・破損バックアップの拒否を検証。外部ファイル取り込み、Version／Undo履歴を含む完全Archive復元、Windows/Linuxのnative QAは対象外／未実装です。
## 改行なし長段落の表示分割 — 2026-10-03

- `bun test test`: 16テスト成功。改行なし100万文字を123表示単位に分割（約2〜3 ms）、結合結果の完全一致、ZWJ絵文字・結合文字・旗・CRLF境界、textarea正規化後の正本UTF-16差分を検証。この時間は分割関数の測定であり画面の描画時間ではありません。
- `bun run package`: macOS debug appのビルド成功。
- Browser plugin not available。ネイティブTauri WebViewをCUAで検証（tauri://localhost、1040×820）。隔離したテスト作品を使用。画面は正常表示、エラーoverlayなし、スクリーンショットで本文と内部スクロールを確認。WebView consoleの取得は未実施。
- macOSの標準全選択→2万文字貼り付け→自動保存。正本の段落が1つのまま、指定した20,008文字と完全一致することをファイルで確認。
- 追加編集後、段落全体をコピー→別シーンの段落全体へ貼り付け→保存。20,011文字の完全一致と不要な改行がないことを確認。
- 境界の書記素削除は純粋関数テストで検証。実IME、縦書きの境界操作、グループ執筆での長段落、100万字の今回の変更後のフレーム時間は追加QAに残します。
## 同一段落内の表示境界をまたぐ範囲選択 — 2026-10-03

- `bun test test`: 19テスト成功。Shiftによる書記素単位の選択、方向反転、CRLFを含む範囲、前向き／後向きの範囲置換、IME継続用の入力欄保持と正本offsetを検証。
- Browser plugin not available。Tauri実WebView（tauri://localhost、1040×820）をCUAで確認。隔離した作品を使用。本文・メニュー・内部スクロールの表示は正常、framework error overlayなし。console取得は未実施。
- 横書き：8,192 UTF-16境界を挟む「前後」をShift＋左矢印で選択→「置換」を貼り付け。保存された正本が `雨×8191＋置換続` と完全一致。
- 同じ跨ぎ範囲をコピー→別シーンへ貼り付け。正本が選択された「置換」の2文字だけと一致。範囲選択を確認した後の切り取りでは、正本が `雨×8191＋続` と一致。観測を挟まない連続CUA操作では選択範囲に差が出たため、実キーリピートの追加QAを残す。
- 縦書き：境界を挟む「前後」をShift＋上矢印で選択→「縦換」を貼り付け。正本が `雨×8191＋縦換続` と完全一致。スクリーンショットでカーソル近くの列が内部スクロールで見えることを確認。
- 実IME、多ウインドウ競合、グループ執筆での範囲選択、今回の変更後の100万字描画時間は追加QAに残す。ドラッグ／複数段落をまたぐ選択は未実装。
## 書字方向ごとのスクロール統一 — 2026-10-03

- 横書きのまとめ執筆を縦積みへ変更。group-manuscriptだけが縦スクロールし、シーン内の独立スクロールを除去。横書きのホイール→横スクロール変換も除去。
- 縦書きのまとめ執筆は全体の横スクロールを維持。シーン単独表示では外側の縦スクロールを停止し、本文の高さを残りのウインドウ領域に合わせる。
- Tauri実WebViewの1040×820画面でブロック選択→縦書きのホイール操作による横移動→横書きへ切り替え→縦移動を確認。横書きの横スクロールバー、縦書きの縦スクロールバーがないことをスクリーンショットで確認。隔離した作品を使用。console取得は未実施。

## 人物サムネイル・カラフルな相関図 — 2026-10-03

- 参照画像の写真カード・関係色・落ち着いた背景を取り込み、既存wgpuグラフを明るい紙面・白いカード・小さな影へ変更。人物カードにはサムネイル（未設定時は頭文字）・名前・人物設定、関係カードには名前と三言語対応の種別を表示。関係線は種別と同じ色。既存の配置・ノードID・ポート・DAG制約は維持。
- ネイティブPNG選択ダイアログ→人物管理・一覧→wgpu相関図への即時反映を隔離QA作品で確認。画像削除→編集メニューのUndoで復元。アプリ終了・再起動後も画像が一覧・編集・グラフで表示された。元の参照写真は取り込まず、独自のテスト画像を使用。
- Rustアプリの回帰テスト35件：画像のsnapshot保存・再読込、削除、Undo/Redo、旧作品の任意プロパティ互換性、シーンへの画像設定拒否、URL/不正画像拒否、projectionが画像本体を含まないことを検証。画像ライブラリの追加テスト：PNG正規化・デコードキャッシュ・容量上限・JPEGのEXIF向き補正・WebP。
- Metal GPUテスト3件を明示実行して合格。sRGBターゲット上の赤/青画像の区別、アトラススロット入替時の再転送、反復フレーム、背景をpixel readbackで確認。既存のクリッピング・重なり順・日本語/简体中文表示も合格。
- JSテスト19件、workspace Rustテスト、Clippy（全target、warnings拒否）、macOS debug app bundleのビルドを確認。実WebViewのconsole取得は未実施。Windows/Linuxのファイル選択・カスタムprotocolは未検証。
- 最終画面：[相関図](qa/character-graph.png)。サムネイルは128px正方形へ中央トリミング。トリミング位置の手動調整・人物グループ背景・画像/PDF書き出しは未実装。

## グラフの文字・接続線・矢印 — 2026-10-03

- 名前は濃色・600ウェイト、人物設定は12px・500ウェイトへ変更。接続線は2pxから4px（world単位）へ拡大。三角矢印は曲線の接線に沿わせ、ノードやポートで隠れない線上へ配置。
- Sceneの方向テストで、片方向の関係が人物A→関係→人物Bとなり、mutual切替で両線が双方向になることを確認。通常のFlow接続は接続先向き。ズーム時の矢印サイズを調整し、BVHカリングにも矢印の余白を含める。
- renderer回帰テスト、Metal GPU描画テスト3件、Clippyを確認。macOS bundleを再ビルドし、隔離QA作品で文字・太い線・矢印の実表示を確認。曲線の各線分を丸い端で重ね、線分の境界で途切れて見える問題も解消。[確認画面](qa/graph-directions.png)。

- 矢印を曲線途中から接続端へ移動。接続点の6px手前に先端を置き、ノード本体・ポートで隠れないよう調整。双方向の両端、片方向の接続先側という意味は維持。方向・端位置の回帰テストに合格し、更新macOS bundleの実表示を確認。[両端の確認画面](qa/graph-endpoint-arrows.png)。

## Compact履歴・ローカル版管理 — 2026-10-05

指定URLのHTML/CSS/JSを取得し、Git client本体をvendorへ取り込み。履歴の行高3rem・グラフ幅5.75remを維持し、丸の開閉をinline詳細へ接続しました。

- `bun test test`: 22 pass、0 fail。履歴を含む3言語のキー一致も検証。
- `cargo test -p komyaku-story-graph --locked`: 44 pass、0 fail、2 ignored（従来のPDF生成fixture）。認証のloopback待受に必要なsandbox外実行で確認。履歴テスト3件は原子公開前の中断、親ID順序、再読込、ハッシュ不一致、無効ID、別作品復元と正本不変を検証。
- `cargo clippy -p komyaku-story-graph --locked -- -D warnings`: 成功。
- `bun run package`: macOS debug app bundle生成成功。
- ブラウザー: Browserプラグイン不在のため既存Playwright/Chromiumを使用。最終ビルドを`http://127.0.0.1:1449/`で配信。日本語／简体中文1100×820、英語760×820。`style-src 'self'`ヘッダーを付与し、丸のstroke色、SVG高さ、Compact変数、ページ識別、非空画面、overlayなし、console/page errorなしを確認。
- 操作: 履歴→空状態→初稿保存→改稿版保存→丸で詳細表示→Enterで省略→上下キー移動→検索→元版IDで復元要求→保存失敗時の名称保持→再試行。ブラウザーのTauriブリッジはfixture/mockであり、Rust永続化の証拠とは分離。
- 実Tauri/WebKit: `/private/tmp/komyaku-history-native-20261005`を保存・作品libraryの隔離先として起動。初稿保存→シーン名変更→2版目保存→初稿の丸で「変更 起 · 雨の駅 改稿」表示→「初稿からの復元」で新しいウインドウ起動。復元先のシーン名が「起 · 雨の駅」であることをAXで確認。
- 実ファイル: 2版のSHA-256と親ID、復元snapshotが元snapshotと作品名以外完全一致、現在原稿が改稿状態のままであることを比較。再起動後に両版を読込・展開できることを確認。
- 表示修正: hostのSVGアイコン用18px規則によるグラフ圧縮を、実測SVG高さで修正。CSPが動的HTMLのstyle属性を拒否するため、色はlane CSSクラスへ変更。CSPを緩めず、最終WebKitスクリーンショットで青緑の線・headの丸・選択輪を確認。

一時QAスクリプトは`/private/tmp/komyaku-history-qa.mjs`、画像は`/private/tmp/komyaku-history-{ja,en,zh-CN}.png`。永続化はローカル不変版、差分は変更項目の要約です。本文内diff、分岐・統合・履歴Archive・Gitリモートは今回の検証対象外。上限512版の性能計測とWindows/Linux実機検証は未実施です。使用者の通常作品・認証profileを変更していません。

## 履歴の本文内差分 — 2026-10-05

- `cargo test -p komyaku-story-graph --locked`: 48 pass / 0 fail / 2 ignored（従来PDF fixture）。差分テストで、空／一致／追加／削除、CRLF・結合文字・絵文字、日本語の複数変更、反復文字を含む短い入力7,225組の双方再構成、100万文字の範囲比較と4KiB未満の応答、長い周辺本文の省略数を確認。追加の単一巨大書記素テストでは10万結合文字を1書記素として丸ごと省略し、応答1KiB未満を確認。
- `bun test test`: 22 pass、3言語の追加キー一致を含む。`cargo clippy -p komyaku-story-graph --locked -- -D warnings` と `bun run package` 成功。ビルド時にdistが置換されるためRustテストとは順番に実行。
- Browserプラグイン不在のため既存Playwright/Chromiumを使用し、静的ビルドを`http://127.0.0.1:1449/`で配信。日本語／简体中文1100×820、英語760×820、`style-src 'self'`制約下でページ識別、非空、overlayなし、console/page errorなしを確認。
- 一時QA `/private/tmp/komyaku-history-diff-qa.mjs`: 版作成→丸を開く→本文差分→追加／削除のDOM→書記素保持→HTML文字のescape→省略数→保存版へ比較先切替→指定compareIdで差分要求→復元の版ID維持→保存失敗／再試行。これはTauri bridge fixtureによるUI検証であり、実Rustの永続化とは分離。
- 実Tauri/WebKitは `/private/tmp/komyaku-history-diff-native-20261005` の隔離作品。初稿を保存し、「差出人のない手紙」を「青い封筒」へ本文改稿。初稿→現在原稿で追加3／削除7の強調表示を確認。改稿を別の版として保存し、初稿の比較先を「青い封筒へ改稿」に切り替え、保存版同士でも同じ本文差分を確認。グラフの直下にある履歴アイコンから遷移。通常作品・認証profileは変更していません。

単語や意味単位の差分ではなく書記素単位の比較です。大きな変更は範囲比較を明示し、省略本文の全文取得や全文転送を行いません。段落移動・セリフ構造差分、512版を使う性能計測、Windows/Linux実機QAは未実施。

## 履歴ページ取得と512版メタデータ計測 — 2026-10-05

- `cargo test -p komyaku-story-graph --locked`: 50 pass / 0 fail / 3 ignored。40件ページを通して512件のIDが重複・欠落しないこと、古い版を含む検索、取得headの固定、空検索結果を確認。追加のignored性能fixtureを明示実行し、履歴テスト5件成功。
- debugビルド／macOS／ローカル一時ディレクトリに512個の有効なversion.jsonと親チェーンを生成。生成直後の最初の検証＋ページ化＋JSON応答化は13.75ms、応答10,765bytes。全metadata再検証を含む検索ページ20回の平均は12.79ms。OSキャッシュの冷却は行っていない。nodes=10,000/scenes=4,000はmetadata値であり、この計測ではsnapshot本文を生成・読込していない。大量本文の保存速度やディスク容量を測定した結果ではない。
- `bun test test`: 22 pass / 490 assertions。clippy `-D warnings` とmacOS debug `.app` package成功。
- Browser plugin not available。Playwright/Chromiumで静的ビルド `http://127.0.0.1:1449/`、ja/zh-CN 1100×820、en 760×820、CSP `style-src 'self'`を検証。512版bridge fixture→履歴→40件→次ページ→古い比較先追加→全履歴検索→検索結果の次ページ→該当なし→検索解除。常時最大40行、ページ識別・非空・overlayなし・console/page errorなし、ウインドウ全体の縦スクロールなし。画像 `/private/tmp/komyaku-history-page-{ja,en,zh-CN}.png`。
- `/private/tmp/komyaku-history-page-regression.mjs`: 保存2版、丸の開閉、キーボード移動、debounce後検索、本文diff・HTML escape・Unicode保持、保存版同士比較、復元ID、保存失敗時の名前保持と再試行を3言語で再確認。

本変更のUI検証はmock bridgeを使うChromium、永続化はRust実ファイルテスト。今回のページ操作そのもののTauri/WebKit実機QA、Windows/Linux、512版の全文snapshot保存は未実施。各ページ要求で全metadataを再検証し、版数上限512と全文snapshot方式を維持する。

## 履歴の所属先と段落・セリフ構造差分 — 2026-10-05

- Rust全体53 pass / 0 fail / 3 ignored。追加の所属先／順序投影テスト1件も成功（計54件）。構造比較は挿入による後続の位置ずれを移動扱いしないこと、残存IDの順序変更、削除、一致、役者名・台詞本文・列幅・段落本文の個別フラグを確認。20,000項目の追加は最大100件・省略19,900件、本文を含まないJSON応答32KiB未満。
- JS22 pass / 490 assertions、3言語キー一致。clippy `-D warnings` とmacOS debug `.app` package成功。
- Browser plugin not availableのためPlaywright/Chromium。静的ビルド http://127.0.0.1:1449/、日本語・简体中文1100×820、英語760×820、CSP style-src self。`/private/tmp/komyaku-history-structure-qa.mjs` はmock bridgeで所属先・順序→本文差分→保存版の比較先→構造差分→役者名／本文／列幅→省略数→開閉→復元版ID→保存失敗の入力保持→再保存を検証。文字中のHTMLをescapeし、ページ識別／非空／overlayなし／console・page errorなし。画像 `/private/tmp/komyaku-history-structure-{ja,en,zh-CN}.png`。
- 実macOS/Tauri/WebKitは既存の隔離profile `/private/tmp/komyaku-history-diff-native-20261005` を使用。履歴の下部アイコンから保存済み2版を取得し、初稿→現在の原稿で「段落・セリフの変更」を開く。Rust RPC経由で「変更 段落 1 → 1 段落本文の変更」を実画面に表示。通常の使用者作品・認証profileは変更せず、原稿・版を追加保存せず終了。

構造の移動は同じシーンのcanonical IDと残存項目の相対順位に基づく。シーンをまたぐ段落移動は追加／削除として表示。セリフ本文や役者名の全文は構造応答に含めず、別の本文差分から確認する。多数の移動を最小操作列へまとめる処理、Windows/Linux実機、実WebKitでのセリフ操作は追加QA。

## 大規模保存・ストリーミングsnapshot — 2026-10-05

`cargo test -p komyaku-story-graph --locked benchmark_large_snapshot_history -- --ignored --nocapture`を変更前と変更後に各1回実行。macOS、debug、ローカル一時ディレクトリ、同じ定義の初期作品へ1,000段落×1,000日本語文字を入れるfixture（別途段落区切りと初期の他シーンあり）。通常保存5回、タイトルを変えながら名前付き全文版30個、全30版のSHA-256検証・再読込・graph完全一致まで測定。fixture生成、正本clone、UI入力、レンダリングは保存計測区間に含めない。

| 計測 | 従来 | 変更後 |
| --- | ---: | ---: |
| 通常保存5回平均 | 160.96ms | 160.73ms |
| snapshotサイズ | 3,709,343bytes | 3,260,522bytes |
| 30版保存合計 | 4.839s | 4.255s |
| 版保存平均 | 161.30ms | 141.83ms |
| 版保存p50 / p95 | 152.20 / 202.97ms | 139.04 / 170.27ms |
| 全30版の検証再読込 | 1.738s | 1.599s |

このfixtureの版保存平均とサイズは約12%減。通常保存速度はほぼ同じ。OSキャッシュの冷却・RSS計測・複数試行の統計は行っておらず、一般的な速度保証ではない。明示的な全文JSON Vecと履歴SHA用の全文再読込をコードから除いたが、正本／snapshot cloneや読込バッファは残る。二重保存抑制のアプリ全体の時間短縮はこの表に含めていない。

- `cargo test -p komyaku-story-graph --locked`: 57 pass / 0 fail / 4 ignored。通常ignoredの大規模保存fixtureは別途成功。新しい3テストはUnicode（ZWJ絵文字・結合文字・CRLF）roundtrip、従来pretty形式の読込、書込Receiptと実ファイルSHAの一致、部分書込での正確なdigest、容量超過／publish失敗時の元ファイル保持と一時ファイルcleanupを検証。既存の履歴tamper検出と別作品復元も成功。
- JS22 pass / 490 assertions、clippy `-D warnings`、macOS debug `.app` package成功。フロントエンドの画面・翻訳は変更なし。
- 実Tauri/WebKitでは通常作品とは別のコピーprofile `/private/tmp/komyaku-save-stream-native-wifm1o92` を使用。日本語・ZWJ絵文字・改行・アクセント文字入り本文を編集し、保存済み表示→「保存方式確認」の版作成→再起動→本文と旧2版・新1版を再表示。新版は現在原稿と「変更なし」、旧初稿は本文変更を表示。独立したPython検証で新版snapshotと現在原稿のdocument一致、全3版のSHA-256とparentチェーン、旧snapshotのバイト不変、一時ファイル残留なしを確認。macOS貼付でアクセント文字はNFCのéとして入力され、結合文字を保持する保存単体テストとは分けて検証。

通常使用者の原稿・履歴・認証profileには触れていない。Windows/Linux、グラフ操作イベントの二重保存回帰の実機計数、電源断のfault injectionは未実施。グラフ側のmain-thread保存と差分ジャーナルは次段階。

## AI生成完了イベントの末尾処理 — 2026-10-05

報告されたai_stream_interruptedの原因候補として、正常EOF時に残ったdataを処理せず失敗にする経路を修正。最後のresponse.completed JSONに空行／末尾改行がなくても、status=completedを確認した場合だけ成功とする。改行コードLF／CRLF／CRと、CRLFがチャンク境界で分割される場合も処理する。ネットワークエラー時にはEOF救済をせず、途中提案は未完了のまま保持する。

AIテスト7件成功。新しい再現fixtureでは日本語・絵文字を含むdeltaとcompletedを1／2／7／全バイト幅で送信し、各改行・末尾の形式を検証。EOFだけ、DONEだけ、status=in_progress、不正なJSON、incompleteは成功しない。既存の出力容量上限・遅れて届く失敗・原稿変更時の取り込み拒否も維持。公式仕様 https://developers.openai.com/api/reference/resources/responses/streaming-events のresponse.completedとstatus=completedに従う。

使用者の実応答・request IDは未取得で、この報告の原因を確定したものではない。使用者の原稿・認証を使う外部生成は実行していない。モデル・要求・認証方式は変更していない。

AI EOF修正後の全Rustテスト: 59 pass / 0 fail / 4 ignored。clippy -D warnings とmacOS debug .appの再ビルド成功。実サービスへの生成再現は未実施。


## グラフの専用Rust autosave worker — 2026-10-06

- Rust全体65 pass / 0 fail / 4 ignored。workerの6テストで100要求の集約、呼出元とは別スレッドでの保存、保存中の追加要求、終了時の排出、連続操作時の最大待機、保存失敗後の再試行と実ファイルの最新documentを検証。
- JS22 pass / 490 assertions、clippy -D warnings、macOS debug .app package成功。180ms debounce、連続操作でも最大1秒で保存開始。キューは要求番号だけを保持し、保存時にRust正本のsnapshotを取得する。
- 実macOS/Tauriは隔離profile /private/tmp/komyaku-autosave-native-i9cymvvw。灯ノードを移動→保存→終了→再起動で位置復元を確認。保存先をテスト用ディレクトリに置き換えて書込失敗を発生させ、再移動後の⌘Qでアプリが残ることを確認。保存先を元に戻して⌘Qを再実行し、最新位置y=527.5の保存を独立したPython読込で検証。graph／原稿は変更なし、placementは灯1件のみ変更、テストbackupの残留なし。
- 初回fault injectionでmacOS標準Quitが終了保護を迂回することが判明。標準Quitをアプリ側の保存待機付きメニュー項目へ置換し、⌘Qも同じ経路に接続した後、上記の失敗・再試行を確認。

通常使用者の原稿・履歴・認証profileは変更していない。Windows/Linux実機、電源断・強制終了、UIフレーム時間の定量計測は未実施。保存のディスクI/Oはmain threadから分離したが、終了時は保存完了を待機する。差分ジャーナルとチェックポイントは次段階。

## 差分ジャーナル復旧codec（保存経路への接続前） — 2026-10-06

- 新規4テスト成功。100万字（約3MB）の一部をZWJ絵文字・結合文字へ置換し、差分レコード1KB未満、準備時の状態不変、commit／replay後の元バイト列一致を確認。第2レコードの全切断位置で第1レコードまで復旧し、valid_bytesを検証。
- 破損した完成レコード、異なるcheckpoint、順序違い、重複適用、改変後checksum不一致を拒否。失敗時に復旧状態は不変。空文字列への挿入・削除と256記録のcheckpoint境界を確認。
- Rust全体69 pass / 0 fail / 4 ignored、clippy -D warnings、git diff --check成功。初回sandbox内実行では既存cancelled_listener_exitsのlocalhost bindがPermissionDenied。ローカル待受を許可した再実行で全件成功。

この工程はcodecと復旧契約の実装。通常save/loadには未接続で、利用者の保存速度が向上したという計測ではない。実ファイルappend/fsync、checkpoint切替中の異常終了、既存作品・バックアップ・履歴との統合、実機の再起動QAは次工程。UI変更なし。

## 差分ジャーナルの共通save/load接続 — 2026-10-06

- Rust全体71 pass / 0 fail / 4 ignored。追加の実ファイル2テストは小変更時のcheckpointバイト不変、差分1KB未満、再読込の最新document一致、未完了末尾の読込と次変更時の切詰め、独立backup snapshot、checkpoint切替後の旧journal残留、完成レコード破損時の原本保持を確認。
- 既存作品一覧テストも更新。小さなタイトル変更をjournalへ保存し、checkpointバイトが不変の状態で一覧に最新タイトルが表示されることを確認。履歴・バックアップ・Undo・文字／人物／階層永続化の既存回帰テストは成功。
- clippy -D warnings、macOS debug .app package、git diff --check成功。フロントエンド変更なし。

実ファイルfault injectionは未完了末尾と古い世代の残留を再現するもので、実電源断の証明ではない。今回の新journal形式の実Tauri/WebKit再起動操作は未実施。保存時の全文読込・JSON変換・ハッシュを残しており、アプリ全体の保存時間／RSSの改善は未計測。checkpointに固有generationを追加し、現コードで従来形式を読めるが、旧アプリへのダウングレードは保証しない。手動コピーにはworkspaceと該当世代journalの両方が必要。アプリ内バックアップは単独snapshot。


## ホスト共有保存キャッシュとネイティブ復旧 — 2026-10-06

- Rust全体72 pass / 0 fail / 4 ignored、clippy -D warnings、macOS debug .app package成功。新規テストは同じStoreで2回の差分保存、連番更新、再読込一致、外部journal破損検出とキャッシュ破棄、修復後再試行、checkpoint外部置換後の新世代保存を検証。
- 実macOS/Tauri/WebKitは専用bundle ID dev.komyaku.storygraph.cacheqaとコピーprofile /private/tmp/komyaku-cache-native-cou89y9r。シーン名を「起 · 雨の駅 キャッシュ確認」へ変更、本文へ「ジャーナル再起動確認。」を追加、灯ノードを下へ70画面px移動。差分3件／889バイトを独立Pythonでbefore／after SHA-256を確認して復旧。⌘Q後のプロセス終了コード0、再起動後の本文・シーン名と灯の新位置を実画面で確認。通常使用者の作品・認証profileには変更なし。
- sandbox内のGUI起動は終了コード134。専用QA bundleを通常GUI実行へ切り替えて検証。再起動時のmacOSウインドウ復元通知を閉じ、最新原稿を確認した。ネイティブUIはCUA、ブラウザーmockは使っていない。

cache hit時にcheckpoint／journal全文readと全replayを省く。全文JSON変換・SHA・snapshot取得と、保存済みバイト列の常駐は残る。RSS・時間の比較計測、Windows/Linux、電源断は未実施。外部更新の検出はlen／mtime／Unix inodeで、メタデータを意図的に保持した改変の検知保証ではない。


## 長文保存の比較計測と重複処理削減 — 2026-10-06

`cargo test -p komyaku-story-graph --locked benchmark_cached_saves -- --ignored --nocapture`。実ファイル、一時ディレクトリ、macOS debug、初期作品の1つのtextノードへ100万字の日本語を配置。作品タイトルを10回変更し、各保存後に独立loadとdocument一致を確認。snapshot／キャッシュ無しjournal／キャッシュ付きjournalを同じfixture定義で順次測定。compileと検証loadはsave時間の外。

| 最終実装 | 10回の中央値 | checkpoint | 差分10件 | 保存済みバッファ容量 |
| --- | ---: | ---: | ---: | ---: |
| 全文snapshot | 81.557ms | 3,012,859 bytes | 0 | 0 |
| journal・cache無し | 95.380ms | 3,012,852 bytes | 2,215 bytes | 0 |
| journal・cache有り | 74.263ms | 3,012,852 bytes | 2,215 bytes | 3,013,883 bytes |

初回実装計測はsnapshot106.360ms／uncached474.483ms／cached162.231ms。キャッシュだけでは全文snapshotより遅かった。自生成差分の保存後commitに伴う再parse／全文hash／全文割当を除去し、prepare済みのnextをsync成功後にそのまま保持。共通部分の比較を1KiB単位にし、Vecの不要な倍増を避けて最終表の結果を得た。別試行間でOS負荷・cache状態は統制しておらず、この前後数値は単独要因の速度保証ではない。最終表も1試行、順序固定、release・RSS・電源断未測定。容量はVec.capacityで、プロセス総メモリ／peak RSSではない。

Rust73 pass / 0 fail / 5 ignored。新規境界テストは0／1／1023／1024／1025／2048／末尾位置、挿入・削除・同一文字列・Unicodeの差分replay一致を確認。手動benchmarkも成功。通常ロードのchecksum／連番検証、破損拒否、失敗時のキャッシュ破棄は維持。UI変更なし。

最終変更後のclippy -D warnings、macOS debug .app package、git diff --checkも成功。今回の最適化後のUI操作QAは再実施していない。


## 検証済みchecksumの再利用 — 2026-10-06

Journalに現在バイト列のdigestを保持。新規テストは初期checkpoint、日本語・ZWJ絵文字・空文字・結合文字の変更、準備のみ、commit成功、重複commit失敗、全レコード復旧でcurrent_hashと実バイトSHAの一致を検証。変更前の再hashを除き、復旧の適用後hash検証は維持。

既存benchmark_cached_savesを同条件で再実行し成功。100万字、タイトル変更10回、debug・ローカル実ファイル、中央値snapshot76.965ms／uncached86.075ms／cached66.086ms。差分10件2,215bytes、cached Vec.capacity 3,013,830bytes。単一試行・固定順序で、前回試行との差を単独要因の効果とは断定しない。RSS／release／実電源断は未測定。全文シリアライズとafter hash、snapshotコピーは依然残る。UI変更なし。

最終変更のRust全体74 pass / 0 fail / 5 ignored、clippy -D warnings、macOS debug .app package、git diff --check成功。今回のdigest再利用後のネイティブ操作QAは再実施していない。


## 段落／セリフセル編集の部分JSON変換 — 2026-10-06

新規テストはUnicode・ZWJ・結合文字・改行を含む段落変更、candidateと正本の一致、重複patch拒否、別の作品タイトル変更検出、stale patchの全文fallback、保存後再読込一致を確認。初期checkpoint・既存形式・失敗後・graph保存は従来経路を維持。

手動benchmark_paragraph_saves成功。1,000段落×1,000日本語文字のシーンで50番目の段落を10回変更。両経路は同じ初期fixture、Store、実ファイル。変更候補の構築・load検証は計測外。patched候補を採用できることも各回assert。中央値full_serializer74.683ms／paragraph_serializer43.205ms。debug・固定順序・単一試行、速度保証ではない。全文parse／比較・after SHA・snapshot cloneは残る。RSS・release・電源断、今回の部分serializerの実Tauri/WebKit操作は未確認。UI変更なし。

最終変更のRust全体75 pass / 0 fail / 6 ignored、clippy -D warnings、macOS debug .app package、git diff --check成功。手動段落ベンチマークは別途成功。


## 部分serializerの段落・セリフ編集ネイティブ回帰 — 2026-10-06

専用bundle ID dev.komyaku.storygraph.paragraphqa、隔離コピーprofile /private/tmp/komyaku-paragraph-native-aywp4fj8。通常使用者の原稿・認証には触れず、現行debugビルドを別bundleへコピーしてCUAで検証した。

本文の第1段落へ「段落保存実機確認。」を追加→「セリフ」から2列シートを挿入→役者名「高橋」→セリフ「雨の駅で待っています。」→保存済み表示→⌘Q→プロセス終了コード0→同じprofileで再起動。第1段落の追加文、役者名、セリフ、元の第2段落をAXと実画面で確認した。

独立Python読み込みでcheckpointのSHAを世代識別に用い、全7差分レコード（元コピーの3件＋今回4件、計7,506bytes）のbefore/after SHA-256を逐次検証して復旧。追加文・役者名・セリフを確認し、checkpointバイト列はコピー元と同一。最終の検証用アプリも正常終了コード0。

新しい実装変更なし。前工程のRust75 pass／6 ignored、clippy、package成功に加えた実操作QA。ウインドウ／原稿の読み込みと保存結果の検証であり、実UI操作中の部分serializer採用回数は計数していない。単体テストと手動benchmarkで採用可能な候補を直接検証している。今回のQAは横書き、日本語、macOS。縦書き・他OS・IME変換・保存失敗の実機再試験と電源断は未実施。


## 同期失敗後の同一内容再試行 — 2026-10-07

保存バイトが一致すればsyncせず成功を返す分岐を修正。同期callbackによるfault injectionの2テストを追加。実ファイルへ完全な差分を書いた後に同期エラーを返す→最新内容はload可能だがcache無し・保存失敗→同一内容を再試行して再エラー→再度sync成功で保存成功、cache保持、差分バイト不変を検証。journalのない同一checkpointも同期失敗を返すことを確認。

Rust全体77 pass / 0 fail / 6 ignored、journal12 pass / 2 ignored。注入は同期境界の制御フロー再現で、OSの実fsync障害・電源断ではない。前工程の保存時間は今回の追加sync後の速度保証ではなく、再計測は未実施。UI変更なし、実ネイティブのディスク障害再現は未実施。キャッシュの削除対象は未確定のため削除・撤去は行っていない。

最終変更のclippy -D warnings、macOS debug .app package、git diff --checkも成功。


## 範囲置換・IME準備の入力欄一括生成削減 — 2026-10-07

JS24 pass / 0 fail / 625 assertions。新規2テストは約100万字のreplacementPartsでmountを呼ばないこと、生成済みinput1つの保持とcanonical断片の一致、横／縦の未生成placeholder更新、古いhtml無効化、CRLF正規化とoffsetを確認。既存範囲置換・方向反転・Unicode・CRLF回帰成功。build／macOS debug package／git diff --check成功。Rust変更なし、既存million_character_patch_preserves_ids_history_and_saveはfixture生成時に実行し成功。

Browser plugin not available。Tauri nativeをCUAで検証（mockなし）。専用bundle dev.komyaku.storygraph.imeqa、隔離profile /private/tmp/komyaku-ime-native-y_90pgce、100万字の単一段落。初期AXに本文input1つ→見えている本文をクリックしてfocus確認→⌘A→「長文置換確認 👨‍👩‍👧‍👦」を貼付→短い本文と未保存表示→保存済み→正常終了コード0。Pythonでcheckpointと該当journalを読み、before/after SHA-256を全レコード検証してcanonicalの置換結果とZWJ絵文字を確認。最初にcheckpoint単独の読込では旧本文となることも確認し、差分を適用した最新原稿を検証した。

AXのpage identity・意味のあるアプリ表示・overlay／blankなし、操作後実画面を確認。native WebView console収集は未実施。使用者の作品・認証は変更なし。native操作は横書き・日本語・約1100×800、通常貼付置換。OS日本語IME composition、縦書きの実操作、他言語UI・狭いウインドウ・他OS・RSS・瞬間DOM計数は未実施。追加生成ゼロは単体テスト対象メソッドの性質で、実機の瞬間計測ではない。キャッシュ削除は対象未確定のため保留、新たな永続キャッシュも追加していない。

## 人物相関グラフのデザイン更新 — 2026-10-07

- Rust/wgpuの描画のみを更新。写真／頭文字の人物カードと濃紺の関係カードで階層を分け、方眼をドットへ変更。保存済みノード位置・サイズ・接続・一方向／相互設定を保持。既存の種類名の英語・日本語・简体中文を利用。
- `cargo test -p unge-render --locked -- --include-ignored`: 15件成功。Metalを利用できないsandboxでGPU3件が起動失敗した後、GPU利用可能な環境で全件成功。サムネイルatlas、CJK文字・クリップ・重なり・2種類のpixel density、接続方向、0.6／1.5／3倍の矢印間隔を検証。`cargo clippy -p unge-render --all-targets --locked -- -D warnings`成功。macOS debug app package作成成功。
- 一時作品・認証ディレクトリを指定した専用macOSアプリで、カード・文字・ドット背景・選択枠・カード移動と接続線の追従を目視確認。拡大時に矢印が丸に隠れる問題を発見し、ワールド座標の接続点半径を考慮した間隔へ修正。
- 最終packageを再起動して、拡大時の矢印先端が接続点の外に表示されることを目視確認。検証アプリは終了コード0で終了。

## 拡大時の接続矢印の明瞭化 — 2026-10-07

- 線だけが相対的に太くなり、矢印先端を軸線が突き抜ける表示を修正。線4・矢印幅18のワールド座標比率を保持し、曲線を矢印の根元までで止める。矢印先端と根元をBezier曲線上で求め、短い急曲線でも隙間なくつながる向きへ変更。拡大時の曲線分割を最大96へ増やして滑らかさを保持。
- `cargo test -p unge-render --locked`: 12件成功、GPU専用3件は今回未実行。0.6／1.5／3倍で矢印比率・接続点との間隔、一方向／相互方向を検証。macOS debug package成功。
- 専用一時作品で最終packageを起動し、通常倍率の短いシーン接続と人物相関線、拡大時の明瞭な三角形・軸線との連続・接続点との間隔をCUAで確認。

## ノードのカラフルな色分け — 2026-10-07

- 濃紺で共通だった関係ノードを、種類別の色面へ変更。文字による種類表示を維持し、写真／頭文字の人物カードにも色面を採用。UUID全体を混ぜた安定した色選択で、末尾の値が似た人物が同色に偏る問題を緩和。シーンは淡いブルー、接続点と線もブルーへ統一。
- 小さな人物説明の文字コントラストは全5色でWCAG比5.32〜5.53。専用一時作品の実Tauriアプリで、人物・関係・シーンの色面、名前と種類ラベル、選択枠を目視確認。
- `cargo test -p unge-render --locked`: 12件成功、GPU専用3件は今回未実行。

## ネイティブグラフ編集ツール — 2026-10-07

- 左ツールバー、右の閉じられる編集欄、Rust所有のツール・線選択状態を追加。人物・シーン・関係の追加、選択・移動・手のひら・拡大縮小・全体表示・Undo/Redo・削除に対応。新しいツールと編集項目の日本語・英語・简体中文文言を追加。ノードや線のクリックで編集欄を開き、線の選択にハイライトを表示。
- 曲線のクリック判定、倍率による許容幅、無効な接続変更の原子性、削除Undoの復元をRustで検証。変更したRustパッケージのClippy（all-targets、-D warnings）成功。既存JSテスト24件・625 assertions成功。
- 一時作品・認証ディレクトリの実Tauriアプリで日本語の操作を確認：人物名変更、線のクリックと強調、接続元の変更とUndo、人物追加、二人のクリック接続、双方向から一方向の変更、関係の削除とUndo、シーン追加（既存シーケンス内・本編）、名前とメモの一括保存と1回Undo、全体表示の文字、手のひら移動、編集欄の開閉。再起動後の人物名・追加人物・関係の保持も確認。
- 最終macOS debug package成功。英語・简体中文の新しいツールを実画面で操作する検証と、GPU専用3テストは今回未実行。
- Rustの最終回帰実行は計98件成功（アプリ79、描画12、共有Engine7）、fixture／GPU専用9件は通常実行から除外。グラフ非表示時のパネル取得を停止し、開くときだけ更新を再開。
- 非表示時の取得停止を含む最終packageで、起動後にグラフを開くと全ツールが表示され、人物クリックで保存済みの名前・役割を編集欄に表示することを確認。検証アプリは正常終了。

## グラフツールバーの上下配置 — 2026-10-07

- 編集ツールを上揃えとし、区切り線の下へ拡大・縮小・手のひら・情報編集を配置。下端から削除・やり直す・元に戻すを配置。
- macOS debug package成功。隔離した実Tauriアプリ（1100×800）で区切り線と上下配置を目視し、手のひらを押すと選択状態が切り替わることを確認。

## 柔らかい色面と明瞭な輪郭 — 2026-10-08

- ユーザー提供の配色画像を参考に、アクア・セージ・ブリー・シルバー・淡いプラムとサンドのノード面を採用。接続線・写真代替アイコンは同系の濃色、本文はガンメタル。影を弱め、カード角丸を8へ変更。ツールバー・編集欄も同じ配色に統一。
- ノード6色でタイトルのコントラスト比9.11〜10.71、小文字4.67〜5.49を確認。
- `cargo test -p unge-render --locked`：12件成功、GPU専用3件は今回未実行。macOS debug package成功。隔離した実Tauriアプリ（1100×800）でノード・線・矢印・ツールバー・選択枠・クリックによる編集欄表示を目視確認。

## 検証済み構造による段落保存 — 2026-10-08

- 保存キャッシュに検証済みノード構造と本文以外のメタデータを保持。段落変更の高速経路で候補全文parseを除去。構造の更新はfsync後のみ、小さい変更後段落だけをコピー。
- 差分外プロパティ・作品名の変更、古い差分、重複差分の拒否と全文fallback、構造更新後の正本一致を既存の段落保存回帰へ追加。journal回帰12件成功、アプリ全体79件成功（fixture6件は通常実行から除外）。
- 100万字・1,000段落・10回の実ファイル保存／検証再読込：debug単一試行の中央値は全文serializer82.937ms、段落serializer29.960ms。既存の段落serializerとの同条件比較、RSS、release、実電源断は未検証。
- 変更後のjournal回帰再実行とClippy（all-targets、-D warnings）、macOS debug package成功。今回の保存変更は実ファイルテストで検証し、新しい実WebView操作・電源断検証は未実施。

## 未着手項目の実装・第1工程 — 2026-10-08

- 外部snapshot取り込み、隠しディレクトリからの完成作品公開、全形式の範囲／読み順指定、Rustのページ付き全文検索を追加。本文・セリフ・役者名・メモ・シーン名を検索し、最大2,000件・40件ページ・短い抜粋とUTF-16位置に転送を限定。日本語／英語／简体中文を追加。
- Rust82件成功（fixture6件は通常実行から除外）、JavaScript24件・625assertions成功、Clippy all-targets -D warningsとmacOS debug package成功。外部取り込みの空プロファイル復元・元ファイル不変・破損拒否、範囲に他シーンが入らないこと、巨大な一致件数の上限とUnicode位置を検証。
- 隔離した実TauriアプリでCmd+F→「手紙」の検索→6件の抜粋→「承・手紙を開く」の本文への移動と一致文字の選択を確認。書き出し→範囲選択→「選択中の項目と配下」→標準保存ダイアログ表示を確認。保存先入力のネイティブ補助シートを自動操作できず、ファイル保存完了と取り込み選択→別ウインドウはPending。認証・本文の実データを使わない一時プロファイルの検証プロセスだけを終了。
- 全ROADMAPの完了ではない。共有Workspace移行、Branch／Merge／Archive、任意Path、パネルドッキング、AI範囲送信、Graph追加機能、本文仮想化・IME／DPI QA、本番同期は残る。

### グラフFocus — 2026-10-08

- 選択ノードと1 hopの接続先、選択線の両端をRustで収集し、左48pxのツールバーと開いている右300pxの編集欄を避けて中央へ配置。データ・Undo履歴は変更しない。
- 自動テスト：表示可能領域の中央、左右余白、Viewport妥当性、直接接続だけの収集、線の両端、空選択を検証。Graph toolsの4テスト成功。
- macOSの隔離アプリ（`/private/tmp/KOMYAKU Roadmap QA.app`）、1100×800、`tauri://localhost/graph-rail.html`から、人物「灯」をクリック→Focus、接続線をクリック→Focusを操作。右編集欄の人物／線情報とGPU画面の移動、対象の可視性を確認。通常終了も成功。
- Browser pluginは提供されていない。対象はwgpuのネイティブウインドウなのでCUAで操作し、ブラウザーによるGPU画面の代替検証は行っていない。空画面・エラー画面なし。実行プロセスの標準出力にエラーなし。WebView consoleの直接取得、小さいウインドウ、DPI変更は未検証。
- 最終チェック：Rust 84テスト成功／6 ignored、JavaScript 24テスト／625 assertions成功、Clippy（警告をエラー化）成功、macOS debug bundle成功、git diff --check成功。

ROADMAP全体の完了には至っていない。未実装の基盤移行・分岐／統合・完全Archive・全パネルドッキング・Minimap等は従来の未完了表示を維持する。

## Archive・Branch・2親Merge — 2026-10-08

- `.komyaku-story` Archive：空プロファイルへ作業原稿／人物画像／Graph／全履歴／環境設定を復元し、取り込み後の版追加を確認。旧版のsnapshot bytes／hash／IDを完全保持。破損・切断・余分な末尾・未来形式を拒否し、公開workspaceを残さない。失敗した書き出しで旧ファイルとsourceを保持。実ファイル3テスト成功。
- Lineage：分岐、順序付き2親、再起動・Archive保持、独立した変更の統合、競合の明示選択、Unicode保持、削除／編集・同一ID追加の競合、未知の選択／重複親／自己親／存在しない親の拒否、criss-cross共通祖先の曖昧性拒否、stale revisionをテスト。
- native環境：隔離したmacOS debug app、1040×820、`tauri://localhost`、合成プロフィール `/private/tmp/komyaku-lineage-qa-5c304cc8-6772-4370-90a6-f60d81a9a211`。初稿Aと本編A2→Aから「別案QA」へ分岐し別プロセス起動→作品名を「別案編集QA」へ変更→本編A2との統合preview→タイトル競合で「選択した版」を採用→統合作品を別プロセスで起動。画面のタイトルが「本編QA」、履歴5件と分岐を確認。ディスク上で元作品2版／分岐作品3版／統合作品5版、統合版2親と全snapshot SHA-256一致を確認。親・分岐・統合アプリを通常終了。
- Browser pluginは提供されていない。ネイティブCUAでmeaningful screen、blank／overlayなし、競合selectとfork／merge buttonsの状態変化を確認。WebView console直接取得は未実施。標準ファイルダイアログを最後まで操作するArchive export/importのnative QAは既存のサブダイアログ制約によりPending。Rustによる実ファイル処理は検証済み。
- macOS debug bundleとJavaScript 24 tests／625 assertions成功。共有Canonical Archive契約との互換性、別プロファイル間の分岐取り込み、同一ウインドウでのBranch切り替えはこの実装範囲に含まれない。

## 2026-10-08 Named paths and scene restructuring

- [Done] Rust tests: ordered path persistence, exact Undo, invalid references, cross-path cycle rejection; Unicode split, block IDs, route expansion, merge, atomic Undo, invalid boundaries and nonadjacent merge.
- [Done] Native isolated profile `/private/tmp/komyaku-paths-qa-20261008`: add Route QA with a scene reference, save, right-click scene → split at UTF-16 position 10 → Split QA; merge with the next scene; one Undo restores Split QA. Clicking it shows the exact continuation body. Native observation exposed a localized-name fallback bug, which was corrected.
- [Done] Rust workspace tests after the named-path change pass, including the local callback listener when run with localhost permission. JavaScript: 24 tests / 625 assertions pass.
- [Pending] Additional native drag reorder, three-language and archive picker QA for the new paths; completion is not implied by the Rust checks.

## 2026-10-08 AI selection and reviewed adoption

- [Done] Rust tests prove selected context excludes private prefix/suffix, replacement preserves document/paragraph IDs, invalid surrogate/grapheme boundaries fail, and changed source refuses stale adoption. Existing completion/failure/size tests remain green.
- [Done] AI candidates remain Rust-owned ephemeral review state. Only explicit Send initiates requests; preparing/comparing/adopting is local. Replacement is a normal validated, undoable canonical command. Save as Version is explicit after adoption.
- [Pending] Native authenticated generation QA needs a connected eligible account. No credentials or synthetic generation results were introduced into production flows.
- Reference: https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations (checked 2026-10-08): stateless HTTP Responses with store false and stream true.

## 2026-10-08 GPU minimap and operation checksums

- [Done] Minimap mapping tests cover zoom 0.02 / 1 / 16, negative coordinates, frame hit testing and small-window suppression. Existing renderer tests pass.
- [Done] Native isolated app: graph’s lower-left minimap is visible; clicking it pans the graph, zooming changes cards while the map remains 180×120 logical pixels. It renders in wgpu with Rust geometry and uses shared Rust viewport commands.
- [Done] Journal operation checksums cover sequence, offsets, deletion size, inserted bytes and before/after hashes. Altered fields are refused; legacy v1 records still replay. Cached saving now publishes SavedWorkspace v2 when document extensions exist, with a regression test through actual journal files.

## 2026-10-08 — graph assets and configurable PDF

- Full Rust workspace checks passed after graph/portrait/PDF work (application: 105 passed, 8 manual fixtures ignored).
- Actual Metal offscreen `native_export_fixture` passed. PNG and PDF include Japanese relationship labels, bilateral arrows, a group background and a work title; no prose or minimap.
- `configured_pdf_fixtures` generated standard vertical A4, B5 screenplay in sans serif, and standard Letter PDF. Poppler rasterizations of vertical A4 and B5 screenplay were visually inspected. Frame gaps, punctuation placement, margins, hanging dialogue and footer are intact.
- Nine A4/B5/Letter × 8/12/18pt screenplay layouts assert every frame and glyph cell remains inside the selected margins, including long titles and multi-page dialogue.
- Portrait crop tests cover EXIF-normalized bounded output, distinct crop positions, invalid crop geometry and metadata-free PNG persistence.
- Native file-picker adoption/save completion remains separately pending; fixture success does not claim that UI workflow.

### Native follow-up

The isolated `KOMYAKU Roadmap QA.app` profile completed standard PDF save to `/private/tmp/komyaku-native-settings-qa.pdf`, portrait file selection, drag of crop position to 0.14 and zoom to 2.4, adoption and thumbnail display. The graph tool created `家族 QA`, then reopened it with exactly Akari and Mio checked and its background visible. File → graph PDF completed to `/private/tmp/komyaku-native-graph-qa.pdf`, with the completion status shown. Native picker navigation used its Go to Folder sheet and AX `setValue`. The settings dialog's numeric labels were crowded in the first screenshot; dedicated grid styles fix that layout and require a fresh visual check. QA app was quit normally afterward.

### Roadmap continuation: shared state and save recovery (2026-10-08)

- Native legacy snapshot picker imported into a new work/window; outline and prose displayed. Shared Workspace and native Archive picker flows were also exercised.
- Native narrative declarations survived restart; tab changes and Save and check retained the main scene tab and selected manuscript.
- General Entity initial state and scene effects saved through the native dialog; impact tracing displayed subsequent scenes and reasons. JSON null/absence, precondition-before-effect ordering, set/list behavior, alternate paths, invalid-reference rejection and Undo are covered by Rust tests. Rust exported fixture passed independent shared JavaScript engine evaluation. Native general state query/assertion controls still require additional interaction QA.
- Save failure induced only in an isolated /private/tmp test profile by removing its write permission. The editor retained text, showed a persistence error, refused window closure, and recovered with Cmd-S after restoring permission. Accepted patches were not replayed. Persistence retry test verifies unchanged revision and exact roundtrip after failure.
- No real user data or credentials were submitted. Actual IME composition, hardware DPI transitions and real power-loss tests remain distinct from committed-text input and filesystem failure simulation.

- Shared Archive v1 native picker now accepts `.komyaku` without relying on macOS dynamic type filtering. Import published a separate window with restored outline and text.
- PDF screenplay settings displayed clearly with no overlapping labels or controls.
- Native floating manuscript: edit and save in the detached window, return to main, detached window destroyed, shared text retained. CUA needed Cmd-` to focus the surviving main window after its former focused window closed. This verifies docking lifecycle, not arbitrary drag docking or simultaneous IME conflicts.
- Save-recovery profile restarted and displayed exactly one appended QA marker with saved status.

### Rust-owned panel layout and typed state follow-up

The isolated native profile restored navigator width 308. Keyboard Right changed it to 316 and then 324; quitting immediately persisted 324 and physical/logical geometry for controls/canvas. Restart restored 324. This verifies width persistence and geometry capture, not multi-monitor/DPI migration or arbitrary panel docking.

The native state dialog accepted unquoted text 東京「鍵」 for Ren/location at the memory scene. Save/check succeeded. Querying the scene's after-state returned the same JSON string. An assertion at that scene with the matching expected value reported Pass. Pure value parsing tests cover finite numbers, booleans, null and structured JSON.

Normal save, autosave, retry, version recording and comparison now borrow the current Rust document. Persistence and history regressions passed, including the million-character save/reload test and explicit stale revision refusal. In the native isolated profile, appending 借用保存 QA, saving and restarting retained the text exactly once with saved status; navigator width remained 324.

### Shared history v2 and reading layout follow-up

The shared history fixture passed the independent Archive core verifier. Native File import opened a separate Working QA work with Base, Main, Alternative and Merge, four original versions and both branches. Rust tests reject invalid calendar timestamps, unknown fields, invalid heads, self-parent cycles, changed native labels and snapshot corruption; empty history roundtrips. Full Rust workspace tests passed outside the sandbox's loopback restriction; the sandbox run failed only binding the authentication cancellation listener.

Reading resize now captures the visible chunk anchor and reflows without replacing the whole app UI. Unit tests cover both scroll axes and retained offsets. IME replacement preparation lazily creates changed fragment strings only; 1,000 fragments use two reads for the active fragment and none for unchanged peers. Actual IME composition remains a native QA item.

Checkpoint v3: all 137 native test cases (including ignored hardware/manual fixtures) and the workspace integration suites passed. The composite test checks one shared manuscript, reference-only native skeleton, exact reload, v1/v2 loading and rejection of simultaneous native/composite bodies. History, merge, Archive, journal recovery and persistence failure tests also pass through the common loader. Clippy all-targets passed. Native checkpoint restart and final dock QA await unlocking the test Mac; no real-account or real-manuscript data was used.

### 2026-10-08 unlocked native follow-up

[Done] Isolated Roadmap QA profile: navigator moves left → top → right → bottom. Native restart restores bottom placement and persisted inspector-left slot. Top/bottom layout exposes the tree independently of route controls; a discovered horizontal overflow of the three creation buttons was corrected to a vertical stack (final visual recheck remains).

[Done] Native checkpoint version 3 plus paragraph journal: edit, save, quit and relaunch restores `checkpoint v3 QA` in the isolated sample manuscript. JavaScript build and all 38 tests / 735 assertions pass, including canonical copy across unmounted Reading paragraphs and CRLF preservation.

[Done] Native File → shared history Archive → Save writes a v2 archive in `/private/tmp`; independent `archive-core` verification accepts its checksums and manifest (isolated profile had one current-draft version and one branch). All JavaScript tests now pass: 39 / 741 assertions. Complete Rust workspace tests pass; native application suite: 137 cases, 123 passed / 14 opt-in tests ignored. Renderer benchmark runs separately and records invalid timestamp samples explicitly.

[Done] Native floating navigator: select a different scene, return, and main authoring shows that selected scene. Native floating relationship panel shows only its relationship list and returns to its previous dock. Native floating history: save `Floating history QA`, quit/relaunch, see the version, float again and return successfully. Fixed a native deadlock: querying Tauri's window registry in `Destroyed` could block; publication now runs on a blocking worker after the callback returns. Side windows have scoped local capabilities and registered Engine views; unknown labels are rejected.

[Done] Native paragraph-delta follow-up: edit/save in the floating editor, return and observe `paragraph delta QA` in the main window. Top/bottom creation icons all remain visible in a vertical stack in the final native screenshot.

[Done] Million-character unbroken paragraph, vertical Reading: a 2,000-page wheel movement reaches the final scene with a responsive native UI. Found and fixed resize-position loss: scroll captures the visible character's canonical UTF-16 offset using WebKit Range; resize uses that saved character instead of a chunk's first paragraph. Native zoom after reaching the end still shows the final scenes. Regression test covers CRLF and changed chunk boundaries. JavaScript suite: 42 passed / 755 assertions.

[Pending] WebKit-inclusive RSS attribution: OS-reparented WebKit XPC helpers are not descendants in `ps`; `launchctl procinfo` refuses ownership inspection without root privileges. Measured app RSS alone was 188,592 KiB, explicitly excluding XPC helpers. Do not present that as total application memory.

### 分離状態の起動復元とjournal範囲生成（2026-10-08）
- 検証専用profileで構造パネルを分離→Cmd+Q→再起動し、`index.html?panel=navigator`の独立ウインドウと「パネルを戻す」を確認。復元したパネルの戻す操作で主画面へ復帰。Layout v1の既存ファイルは`floatingPanels`なしでも読める。
- 通常のパネル閉じるは分離状態を解除する。アプリ終了時には分離状態を保持し、作品RevisionやUndo履歴は変更しない。本文・構造・相関・履歴に適用。本文パネルでも分離→終了→再起動→本文保持→戻すのネイティブ検証を実施。
- 部分保存の差分範囲は実際に生成したbyte spliceに限定。Unicode、削除、同一内容で一般差分とdigest／再生結果が一致し、改ざんを拒否する。外部ファイル変更等のfallbackは維持する。
- releaseの100万字・1,000段落・10保存：中央値 全文17.773ms／部分13.569ms／revision確認済み12.182ms。各保存の後に再読込一致を検証。ネイティブ入力から画面表示までの時間ではない。

最新の確認：JS 43件・758 assertions、Rust 127件成功・14件opt-in ignored、Clippy（all-targets / warnings-as-errors）成功。

### 執筆DOM集約と全文検索の文字位置（2026-10-08）
- 64断片以上の本文は、画面外の断片32個を1つのサイズ保持要素へまとめる。正本は変更せず、個々の断片と段落IDはJavaScriptの投影インデックスに保持し、必要時だけ再接続する。
- 100万文字の隔離作品で縦書きの途中を編集し、`batch QA`を1箇所保存。journalのSHAチェーンを検証し、再起動後の全文検索が1件、一致文字が本文で選択されることを確認。
- 検索からの移動を、横書きと縦書きの実画面で確認。大きな入力欄全体を表示する処理では不十分だったため、実文字のRange矩形に基づくスクロールに修正した。
- ローカルopt-in診断：縦書き起動時120フレーム p50=17ms / p95=18ms / max=28ms、接続本文DOM32 / 集約DOM4 / 入力欄1。横書きwheel後120フレーム p50=17ms / p95=18ms / max=25ms、本文DOM27 / 集約DOM4 / 入力欄2。50ms超はいずれも0。連続スクロール全区間のFPSや入力遅延保証ではない。
- DOMを切り離した群で段落参照・検索・再接続・編集値保持・フォーカスによる保護・削除後の検索インデックス・observer解除をユニットテスト。JS 44件 / 774 assertions成功。

## 中央Document参照 — 2026-10-08

- Rust正本の本文を `komyaku.canonicalDocuments` に一度保持し、Sceneは自身のIDの `documentRef` を保持する。起動時は旧本文の所有権を移し、再変換でもIDと内容を保持する。
- 正本から選択シーンだけをWebViewへ投影。検索、Path、AI、書き出し、履歴差分、三方向マージ、checkpoint、差分ジャーナルで旧形式と新形式を扱う。
- 全Rust workspaceテスト成功。アプリ143件中129成功・14 opt-in除外。参照切れ、シーン削除のUndo、ジャーナル再読込、不変版保存、TXT出力を追加検証。
- 専用native QA profileで `central Document QA` の編集とUndo／Redo、`中央Document QA` シーン追加とUnicode本文保存、`Central Document native QA` の版保存、旧版との追加20字の差分、再起動後の両本文復元を確認。実ユーザーの原稿・認証情報は使用していない。

### 複数段落の範囲編集・ネイティブ Undo（2026-10-08）

- 隔離した QA 文書で、横書きの本文→役者名／セリフ→本文をドラッグ／Shift クリックで選択し、絵文字を含む文字列に置換。未選択の末尾は保持され、セリフの表を含む選択部分が一括で置換されて保存された。
- macOS の Cmd+Z が再生成済み textarea のローカル履歴を参照する問題を修正。ネイティブ Edit メニューの Undo／Redo をフォーカス中の投影に配送し、本文編集は Rust の履歴で戻す。ドラッグ置換後、一回の Cmd+Z で前の段落・高橋・こんにちは。・後ろの段落です。を復元。通常入力も Cmd+Z／Cmd+Shift+Z で復元した。
- JS：47 tests / 796 assertions pass。Rust：143 tests（129 pass / 14 ignored）。localhost コールバック試験はサンドボックスで socket bind が拒否されたため、外部通信を行わない昇格実行で再検証した。
- 縦書きで下ドックにより本文の高さが変わると検索位置が画面外にずれる問題を修正。本文領域の ResizeObserver は小さな文書でも有効にし、列幅を再測定。24k文字の検証本文で「選択の開始ABC」検索後に選択位置が可視領域へ復帰することを確認。
- 長文分割境界のドラッグ、セル端点、実IME変換時の範囲置換は追加QA中。全項目完了とはしていない。

### 本文更新と描画キャッシュ（2026-10-08）

- UNGE の SceneIndex が読む属性に基づき、本文／Document Extension の更新とその Undo／Redo で描画インデックスを再利用。Add／Remove／Move／Connect／Disconnect／Group と title／role／kind／portrait／mutual は再生成する。ジェスチャーの preview invalidation は全 revision で維持。
- 隣接する履歴コマンドは Rust Editor から借用して判断し、本文や履歴全体をクローンしない。10万文字のストア変更・本文参照変更・Undo／Redo では再生成回数が増えず、見出し編集とその Undo／Redo では増える回帰テストが通過。
- canonical validation は借用文字列の列を検証し、JSON のサイズは上限付き Writer で数える。テキスト取得が必要な出力だけ最終 String を作る。中央ストアの本文は domain validator 内で一回検証する。
- 全 Rust workspace tests pass（アプリ 129 pass / 14 ignored、描画キャッシュの追加回帰テスト 1 pass）。全文 checksum は維持しており、残る走査の最適化は未完了。

### 2026-10-08 全パネル配置 v2

本文・構造・相関・履歴を左右／上下／中央へ配置する Rust 状態と WebView 投影を実装。v1 の既存配置を維持して移行し、履歴を本文と独立して表示。49 JS テスト（803 assertions）、Rust layout 4 テスト、フロントエンド build が成功。専用ネイティブ QA プロファイルで本文と履歴の同時表示、履歴の右→下→中央配置、既存パネルとの場所交換を画面確認。GPU の同一ウインドウ合成は未完了。

同日、Rust workspace の全通常テスト成功（アプリ146件中、専用性能試験14件は ignored）。中央の履歴を閉じた間は本文へ空き領域を割り当てる投影を追加し、保存配置を書き換えないことをテスト。

### 2026-10-08 同一ウインドウのネイティブ GPU グラフ

macOS のメインスレッドで NSView 子ビューを生成し、その強参照を Surface の寿命に保持。グラフ領域の矩形と入力命令だけを IPC で送り、wgpu のフレームを WebView へ転送しない。Surface をパネルの移動・サイズ変更に追従させ、メニュー／ダイアログ表示中は重なりを避ける。Rust の Pointer 命令は revision と共有 gate を用いる。範囲値の不正値拒否テストと全 target Clippy が成功。

専用ネイティブ QA プロファイルで、グラフと履歴の同時表示、GPU 左／履歴中央／構造右の配置、再起動による配置復元、ノードのドラッグ、Command+Z での位置復元、全体表示、拡大、ホイール移動、ミニマップからの移動、本文へ復帰を画面確認。別ウインドウの Surface とドック Surface を交互に描画してドラッグがキャンセルされることを避け、再描画はメインスレッドへ送る。macOS 以外のホストは従来の別ウインドウにフォールバックする。

### 2026-10-08 正確な SHA-256 の prefix 再利用

Journal は64KiBごとの SHA-256 Context を保持し、Rust 内部で保証された変更位置より前の状態だけを再利用する。公開された journal の形式・全文digest・操作checksum は変更しない。同期成功後のみ新しい Context を採用し、外部変更・失敗による保存キャッシュの破棄も維持。リプレイは変更前の正本から構築した prefix を用い、変更後の全文digestを検証する。

境界前／境界上／境界後／末尾、Unicode挿入、削除、縮小、破損レコード、復旧の digest 一致テスト成功。Journal 通常テスト18件成功（手動性能3件は ignored）。M4 release、3,000,000 bytes、各位置100回の SHA 処理のみの p50/p95: 先頭は全文1491/1774µs・再利用1497/2909µs、中間は全文1491/1562µs・再利用775/844µs、末尾付近は全文1489/1586µs・再利用27/35µs。先頭変更では改善せず、保存全体／fsync／UI応答の性能値ではない。
