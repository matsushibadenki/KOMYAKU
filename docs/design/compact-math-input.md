# Compact Math Input Palette

- Updated: 2026-09-01
- Applies to: KOMYAKU Support App text pages and structured Equation editing
- Architecture decision: `docs/adr/ADR-075-compact-math-input-and-handwriting-recognition.md`

## Goal

LaTeXを覚えている専門家の速度を落とさず、記号や構造を探したい利用者へ必要な時だけ入力支援を出す。添付参考UIの情報量を常時表示せず、本文の領域を優先する。

## Compact layout

```text
Text / Equation editor
┌────────────────────────────────────────────┐
│ E = mc^2                              [数式] │
└────────────────────────────────────────────┘

Compact palette (desktop popover / mobile bottom sheet)
┌──────────────────────────────────────────────────┐
│ 数式入力      [ソース] [手書き]          [閉じる] │
│ [よく使う] [構造] [微積分] [ギリシャ] [集合・論理]│
│  a⁄b   √x    x²    xᵢ    ∑    ∫    lim    →     │
│  ±     ≤     ≥     ≈     ∞    ∂    ∇      π     │
│ ┌──────────────────────────────┐  ┌───────────┐ │
│ │ \frac{a}{b}+\int_0^1…       │  │ Preview   │ │
│ └──────────────────────────────┘  └───────────┘ │
│ [本文へ戻る]                         [数式を挿入] │
└──────────────────────────────────────────────────┘
```

DesktopではText入力欄またはEquation Nodeの近くへPopover表示する。幅が640px未満、Software Keyboard表示中、またはPopoverが本文を過度に隠す場合はBottom Sheetへ切り替える。横向きMobileではPreviewを折り畳み、Key GridとSourceを優先する。本文、Palette、OS Keyboardが同時に狭い領域を奪い合わないよう、Sheet高はVisual Viewportを基準に制限する。

## Commands

Command定義は表示と編集処理を分離する。

```text
MathCommand
├ id                 fraction
├ category           structure
├ labelKey           mathInput.command.fraction
├ spokenLabelKey     mathInput.command.fractionSpoken
├ template           \frac{${numerator}}{${denominator}}
├ placeholders       numerator, denominator
├ wrapsSelection     numerator
└ canonicalOutput    latex
```

`innerHTML`でSymbolを生成しない。表示文字または安全なStatic Math Descriptorを使う。Command IDとLaTeXはLocaleに依存させず、Labelだけを翻訳する。Key順序は頻度と専門分野Presetで変更可能にするが、初期版では個人最適化をCloud同期しない。

## Initial command set

| Category | Commands |
| --- | --- |
| よく使う | fraction, square root, superscript, subscript, parentheses, equality, approximation, infinity |
| 構造 | fraction, nth root, paired delimiters, cases, aligned, matrix, vector |
| 微積分 | integral, double integral, derivative, partial derivative, sum, product, limit, nabla |
| ギリシャ | lower/upper Greek letters; searchable by name |
| 集合・論理 | in, not-in, subset, union, intersection, forall, exists, implication, equivalence |

初期表示は各Category最大16 Keyとし、残りは検索または`すべて表示`へ置く。添付例にあるEsc、Control、Alt、Command、Backspace、Arrow、Space、EnterはOS Keyboardと重複するためPaletteへ含めない。

## Editing flow

1. Text Selectionがなければ、新しい`math_inline`または`math_block` Draftを開く。
2. Equation Nodeから開いた場合はStable Node IDを保持して編集する。
3. Commandを押すと一つのEditor TransactionでTemplateを挿入し、最初のPlaceholderを選択する。
4. Tab／Shift+Tabまたは`次の枠`でPlaceholder間を移動する。
5. Source変更ごとにbounded rendererへDebounce付きでPreview要求する。
6. `数式を挿入`でSchema検証後にYjs Transactionを発行する。失敗時はSource Draftを保持し、安定したError Codeだけを表示する。
7. Cancel時はCanonical Documentを変更しない。

## Handwriting tab

```text
┌──────────────────────────────────────────────┐
│ [戻す] [やり直す] [選択] [消去]   Pen: 2px │
│                                              │
│           handwritten stroke canvas          │
│                                              │
├───────────────────────┬──────────────────────┤
│ 原画像                │ 認識候補              │
│                       │ 1. \int_0^1 x^2 dx    │
│                       │ 2. \int_0^l x^2 dx    │
└───────────────────────┴──────────────────────┘
│ [端末内で認識 / Cloudで認識] [候補を編集]     │
└──────────────────────────────────────────────┘
```

Canvas自体をCanonical Equationにしない。利用者が原Strokeも保存したい場合は明示的にImage Assetとして添付し、Equationの`derived_from` Relationで結ぶ。既定では認識完了またはDialog Close時にMemory上のStrokeを破棄する。

Cloud送信前に、送信対象が数式CanvasのRasterであること、Provider、Retention、Cost、Training policyを表示する。認識候補はSource Editorで修正でき、Previewを確認するまで挿入Buttonを有効にしない。

## Accessibility and localization

- Keyは44×44px以上、Focus ring、Keyboard操作、Screen Reader名を持つ。
- SymbolだけのKeyにも「分数」「平方根」「積分」のような読み上げ名を付ける。
- Categoryを色だけで区別しない。
- Zoom 200%、Reduced Motion、High Contrast、Touch、Pen、Mouseを検証する。
- 日本語、英語、简体中文で意味単位の改行を確認する。
- Canvasだけに依存せず、常にLaTeX Source入力と記号Paletteを代替手段として提供する。

## Security boundary

- LaTeXは既存の20,000 code-unit、Macro expansion、Output size制限を通す。
- PreviewにScript、External resource、HTML trustを許可しない。
- Raster uploadはMIME、完全Decode、Pixel、Byte、Dimensionを検証する。
- Worker JobはWorkspace認可されたOpaque ID、短期URL、Idempotency Key、Timeout、Rate Limitを使う。
- WorkerへUser Token、DB Credential、Document全体を渡さない。
- Raw Stroke、Raster、Recognition Resultを通常LogやTraining Datasetへ入れない。

## Delivery stages

1. Reusable Command Registry、Placeholder-aware insertion、Compact Palette、Source/Preview、三言語、Accessibility。
2. Support App Text PageとDesktop Equation Nodeへ統合し、Yjs／Canonical restart recoveryを検証。
3. Local-only Stroke Canvasと手動LaTeX転記を追加。
4. UniMERNet Tiny/Smallを隔離Workerで評価し、Model/Checkpoint LicenseとBenchmarkを記録。
5. Explicit-consent Cloud Recognition、Candidate review、Provenance、Quotaを追加。
6. Resourceに余裕がある端末向けにOptional Local Model Packを検討する。App本体へ無条件同梱しない。

## English summary

Use a compact, contextual math palette instead of a full virtual keyboard. Keep touch targets at least 44px and reduce size by showing at most 16 commands per category. Preserve authored LaTeX as canonical data and reuse KOMYAKU's isolated KaTeX-to-MathML preview. Handwriting recognition is an optional suggestion layer: strokes stay local until explicit recognition, results require review, and only the accepted LaTeX enters the document.

## 简体中文摘要

采用按需显示的紧凑数学符号面板，而不是完整虚拟键盘。按键触控区域保持至少44px，通过每个分类最多显示16个命令来减少占用空间。LaTeX源码仍是Canonical数据，并复用KOMYAKU隔离的KaTeX-to-MathML预览。手写识别只是候选建议层：用户明确执行识别前，笔迹保留在本地；识别结果必须审核，只有确认后的LaTeX才能写入文档。

