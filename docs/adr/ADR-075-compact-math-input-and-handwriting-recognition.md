# ADR-075: Compact math input and handwriting recognition

- Status: Accepted
- Date: 2026-09-01

## Context

数学者、物理学者、研究者が試行錯誤を残すには、LaTeXを暗記していない利用者でもEquationを素早く作れ、熟練者の直接入力を妨げないUIが必要である。参考実装は記号カテゴリ、構造Template、LaTeX/MathML Previewを一画面にまとめているが、Keyboard本体が最低1,120px幅で、OS KeyboardのControl、Command、Delete等まで再現している。Support AppのText入力面へそのまま置くと本文の表示領域を圧迫し、Mobile、横分割、Accessibilityで扱いにくい。

UniMERNetは数式画像をLaTeXへ変換し、印刷、Screen Capture、手書き数式を対象にするApache-2.0の公開Projectである。公式Repositoryが示すModel規模はTiny約441MB、Small約773MB、Base約1.3GBで、Desktop Appへ無条件同梱するには大きい。認識結果は確率的であり、Canonical Equationへ自動確定してはならない。

## Decision

### Compact math palette

- Full-width仮想Keyboardではなく、Text／Equation編集面から開くCompact Math Paletteを作る。
- 閉じた状態は`数式`アイコンButton 1個とし、開いた状態はDesktopで最大520px幅・最大240px高のPopover、狭い画面ではBottom Sheetとする。
- Keyは最低44×44 CSS pxのTouch Targetを維持する。Compact化はKeyを小さくするのではなく、一度に表示するCategoryとCommandを減らして実現する。
- 最初のCategoryは`よく使う`、`構造`、`微積分`、`ギリシャ`、`集合・論理`とする。最近使用したKeyは端末内に限定して最大12件を保持し、文書本文やAnalyticsへ送らない。
- OS Keyboardが提供するUndo、Redo、Delete、Arrow、Modifier、Enter、Spaceは重複実装しない。Paletteは数学記号と構造Templateだけを担当する。
- LaTeX sourceをCanonicalとして保持し、MathMLと視覚Previewは派生物とする。既存の`math_inline`／`math_block`、Stable Node ID、Yjs Transaction、Canonical Checkpointをそのまま通す。
- Previewは既存のbounded KaTeX-to-MathMLとsandboxed static preview境界を使う。Runtime CDN、MathJax script、raw `innerHTML`を導入しない。
- Templateは負の文字offsetでCursorを戻さず、明示的なPlaceholder Rangeを持つCommandとして定義する。Selectionがある場合は分数の分子、Root内部、括弧内部等へ安全に包めるCommandだけがSelectionを消費する。
- Source編集、Preview、Palette、Handwritingは同じDialog内のTabにできるが、それぞれ独立したFocus Regionとする。Focusを閉じた時は元のEquationまたは本文Selectionへ戻す。
- 表示文言とARIA Labelは日本語、英語、简体中文を提供する。色だけでCategoryを区別しない。

### Handwriting recognition

- 手書きCanvasはPointer EventによるStroke Capture Layerとし、認識Modelから分離する。
- Strokeは端末Memoryへ保持し、利用者が`認識`を明示的に実行するまで外部送信しない。Undo stroke、Clear、Lasso/Crop、Pen width、High-contrast表示を提供する。
- 認識結果は`候補LaTeX`としてSource欄へ表示し、安全なPreviewと原画像のSide-by-side Reviewを経て、利用者が`数式として挿入`を選んだ時だけCanonical Nodeへ入れる。
- Recognition Adapterは`local`、`self-hosted-worker`、将来の`managed`を交換可能にする。Provider固有形式をDocument Schemaへ保存しない。
- 初期の実用候補としてUniMERNet Tiny/Smallを評価するが、Modelを固定決定しない。CDM、完全一致、Latency、Memory、CPU/GPU、手書き日本語注記を含むKOMYAKU fixtureで比較してから採用する。
- Cloud認識はXServer VPS CloudのApp／Managed PostgreSQLへModelを同居させない。通常VPSまたはGPU Workerへ配置し、Cloud APIが短期Jobを発行する。WorkerはHTTPS APIまたはQueueだけでInput取得とResult返却を行い、Managed PostgreSQLへ直接接続しない。
- Model名、Version、Checkpoint digest、Adapter Version、実行場所、認識時刻、入力Asset hash、利用者が採用した候補をProvenanceへ記録できる。未校正のScoreを確率やConfidenceとして表示しない。
- Stroke／Rasterを学習へ再利用しないことを既定とし、`AI_TRAINING_DEFAULT=deny`と整合させる。Cloud Inputは短期Retention、暗号化、Workspace認可、Size/Pixel/Stroke/Rate Limit、Job timeoutを必須とする。

## Consequences

専門家は直接LaTeX入力を続けながら、頻出構造だけをPaletteで補助できる。一般利用者は手書きから候補を得られるが、Model誤認識が自動的に原稿へ混入しない。EquationのStable IDとVersion履歴を維持するため、KeyboardやModelを将来交換してもArchive Formatを変更する必要がない。

手書き認識はModel配布量、Native Runtime、GPU Cost、Privacy、License確認を伴うため、Compact Paletteの後に段階導入する。RepositoryのApache-2.0表示だけでなく、採用Checkpoint、Tokenizer、学習Dataset、再配布物のLicenseをRelease前に個別確認する。

## Sources checked

- User-provided reference files: `/Users/littlebuddha/Desktop/index.html`, `script.js`, `styles.css`（構造と見た目の参考のみ。直接取込しない）
- UniMERNet official repository, accessed 2026-09-01: https://github.com/opendatalab/UniMERNet
- UniMERNet paper: https://arxiv.org/abs/2404.15254

