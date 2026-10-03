# Verification — 2026-10-02

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
