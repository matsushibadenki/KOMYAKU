# Symbioからのコピー

元プロジェクト：`/Users/Shared/Program/Tauri/Symbio`（MIT、同梱LICENSE）。2026-11-10に元ファイルから実際にコピー。

`math-keyboard.js`、`math-keyboard-edit.js`、`math-keyboard-data.js`、`math-keyboard-layout.js`、`i18n.js` は無改変。`keyboard.css` は元 `apps/desktop/ui/style.css` の `.math-keyboard` 行をコピー。MathLive 0.111.4も元プロジェクトの同梱物から `public/symbio/mathlive` へコピーし、ライセンスを保持。

原本パスとコピー時SHA-256は `ORIGIN.json`。コピーされた編集ルールのテストも元 `scripts/math-keyboard.test.mjs` からコピーし、importパスだけ変更。KOMYAKUの接続処理は `../../math-input.js`。数式の原文は既存Canonicalの `math_inline`／`math_block` に保存し、Rust正本でサイズ・形式を検証。MathLiveでLaTeXをMathMLへ変換し、WebViewのネイティブMathMLで組版する。外部CDN、CAS、手書きモデルのダウンロードは行わない。
