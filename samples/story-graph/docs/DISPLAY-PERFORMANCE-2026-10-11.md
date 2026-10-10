# 表示性能・精度の計測 — 2026-10-11

🟢 [Done] Apple M4 / Metal、Bun 1.4.0で再実行できる計測と正確性検証を実施。値はこの端末の単一測定セッションであり、他端末での保証値ではない。

## 本文

10万／100万／500万UTF-16単位、改行あり・改行なし、日本語、結合濁点、ZWJ家族絵文字、国旗、CRLFを混在。2回warmup後10試行の分割準備と100回の局所編集差分を計測。ハッシュ検証・復元照合は時間の外で行う。文字数は書記素数ではない。

| 構造 | UTF-16単位 | 分割準備 p95 ms | 断片編集差分 p95 ms | 復元 |
| --- | ---: | ---: | ---: | --- |
| newlines | 100,004 | 0.176 | 1.135 | 完全一致 |
| unbroken | 100,002 | 0.233 | 0.363 | 完全一致 |
| newlines | 1,000,017 | 1.502 | 0.963 | 完全一致 |
| unbroken | 1,000,020 | 0.917 | 0.395 | 完全一致 |
| newlines | 5,000,016 | 2.389 | 0.626 | 完全一致 |
| unbroken | 5,000,016 | 8.271 | 1.254 | 完全一致 |

改行なし500万単位の分割準備は、同じfixtureで改善前p95 288.080ms、改善後8.271ms。各断片の改行検索を断片内に限定し、処理済みprefixを繰り返し走査しない。通常の漢字・ひらがな・カタカナの隣接境界は書記素境界が確実なため、前後128 UTF-16単位以内の確定境界間だけをICUへ渡す。確定境界が見つからない場合は全文の標準Segmenterへ戻す。文字列に改行や空白を挿入しない。

全61 JSテスト／2,984 assertions成功。新しい回帰試験は標準Intl.Segmenterの全文境界と各断片の始終点を照合し、300個の結合文字、Prepend文字、絵文字等のfallbackも確認。入力範囲はUTF-16、コピー・復元は元のCRLFと文字列を保持。

## ノード

Rust release rendererで1,000／5,000／10,000ノード、N−1本の接続、1100×800論理viewport、zoom 1 / 0.1、物理DPI 1 / 2を計測。GPU計測は20試行、2回warmup。p95はnearest-rankで19番目を採用（従来は誤って最大値を出していた）。

| ノード | DPI1 通常倍率 p95 ms | DPI1 zoom0.1 p95 ms | DPI2 通常倍率 p95 ms | DPI2 zoom0.1 p95 ms |
| --- | ---: | ---: | ---: | ---: |
| 1,000 | 3.308 | 3.733 | 4.368 | 4.897 |
| 5,000 | 3.071 | 6.328 | 4.462 | 8.653 |
| 10,000 | 3.533 | 9.404 | 4.973 | 11.419 |

これはシーン生成・テキスト準備・GPU submit・GPU完了待ち・診断readbackを含むオフスクリーンwall time。WebView入力、ウインドウ合成、画面提示、保存の時間を含まず、実アプリのFPSではない。Metal timestamp queryは大半が無効値となり、GPU単独の時間はNaNとして棄却。無効サンプルを0msに置き換えたり、有効サンプルだけを選んで速度を主張しない。

CPUの単独再測定は1万ノードのindex構築17.429ms、通常倍率のシーン生成p95 0.062ms、縮小表示p95 2.713ms。別の実行ではアプリbuildとCPU負荷が競合し、縮小表示p95 28.313msへ増えた。この競合実行も [負荷あり記録](performance/graph-cpu-with-build-load-2026-10-11.log) に残し、負荷による変動を除外して保証値にしない。

CPU rendererの15通常テスト、実GPUの画像atlas更新・ピクセル出力・日英中テキストのclipとDPI試験3件が成功。viewportを横切る線が端点cullingで消えないこと、矢印方向、選択・倍率変更後の役割／色の保持を検証。

## 判定基準と未検証範囲

- 🟢 [Done] 今回のfixtureで、局所編集差分p95 16.7ms以下、500万単位までの分割準備p95 16.7ms以下、1万ノードまでのGPU完了待ち込み処理p95 16.7ms以下。60Hzの1フレーム予算を各処理の目安とし、合成・提示までの余裕を保証しない。タイミング値を共有CIの固定assertionにせず、正確性はassertionで失敗させる。
- 🟠 [Next] 新版の実WebViewで横書き／縦書きの入力から提示まで、初回・長時間スクロール、最大RSSを計測。runtime差とウインドウ合成を含む応答を確立するまでは、全体の表示速度を保証しない。
- ⭕️ [Pending] GPU単独timestamp、1万ノードのアプリ編集・保存・復旧、他OS／他GPU／実DPI変更。アプリ側の256ノード上限は維持。rendererの負荷試験合格を作品の上限解除と混同しない。
- ⭕️ [Pending] 日本語の確定境界がない巨大な結合列・英語中心の入力は全文Segmenterへfallback。全Unicodeパターンで500万単位の16.7msを保証するものではない。

フロントエンドbuildとmacOSアプリbundle生成成功。

## 再実行

アプリディレクトリで `bun run benchmark:text`。Rustはsrc-tauriで `cargo test --offline --release -p unge-render benchmark_large_story_graphs -- --ignored --nocapture`、実GPUへアクセスできる端末で `cargo test --offline --release -p unge-render benchmark_native_gpu_graphs -- --ignored --nocapture`。GPU精度確認は同じ条件で `cargo test --offline --release -p unge-render gpu_ -- --ignored --nocapture`。計測は他GPU試験と並列に実行しない。

生データは [改善前本文](performance/text-before-2026-10-11.json)、[改善後本文](performance/text-after-2026-10-11.json)、[CPUグラフ](performance/graph-cpu-2026-10-11.log)、[GPU完了待ち込みグラフ](performance/graph-gpu-2026-10-11.log)。
