# Story Graph Roadmap

- [Done] 現在のコードベースに反映済み。文書項目では準備完了のみを意味する。
- [Next] 最優先の未完了項目。
- [Later] 計画済みだが、直近には着手しない項目。

## S0 — 着手準備とKOMYAKU完成待ち

- [Done] 独立作業ディレクトリ、原案と参考画像へのリンク、アプリ境界、画面方針を用意。
- [Next] KOMYAKU本体のローカル版完成を先行する。N0–N3の実装・native QA・確認付き統合・完全履歴Export/空環境復元を確認し、配布対象と依存APIの基準Versionを記録する。Cloud機能を使う場合は対応する公開条件も満たす。
- [Later] 本体の完成確認後、本文＋Graph＋Pathを一括保存・復元できる契約を確定し、独立アプリを初期化する。

本体の一部項目が[Done]でも、Story Graphの実装開始条件を満たしたとはみなさない。

## S1 — AIを使わない最小の文章構築体験

- [Later] Content／Structure／Group、Flow Edge、名前付きStory Pathのschemaと参照・DAG検証。
- [Later] 起 → 承A/承B → 転 → 結A/結Bのサンプル作品を用意。
- [Later] Canvasの作成・削除・移動・接続・選択と、選択本文の通常エディタを接続。
- [Later] Pathを選び、順序が決定的なLinear DocumentへCompileしてReading Viewで読む。
- [Later] Split/Merge/Reorderとlineage、独立Undo、Autosave、再起動復旧。
- [Later] 日本語・英語・简体中文、キーボード操作、狭幅レイアウトを検証。

完了条件：作者が別展開を組み立て、本文を書き、ルートを選んで読める。再起動後も本文・配置・参照・Pathが一致する。

## S2 — KOMYAKU履歴のサンプルとして成立させる

- [Later] 本文とGraph全体のVersion保存、別案、比較、復元。
- [Later] Graph構造差分、分割・結合の系譜、比較時のみの削除Node表示。
- [Later] 完全Exportを空プロファイルへ復元し、Graph・本文・Path・歴史Assetを照合。
- [Later] 1,000／5,000／10,000 Nodeの測定と仮想化・Focus・Semantic Zoom。

## S3以降 — 意味とAI

- [Later] 人物・場所・Timeline・Fact・伏線・制約と、決定的に検証できるNarrative Test。
- [Later] 対象文脈の確認、AI整合性チェック、提案レビュー、採用後のVersion保存。
- [Later] Lens、Tension Curve、Impact Analysis、Narrative Debugger。
- [Later] Reader Simulation、Prompt/AI Workflow、What-if。AI推定値を実測の読者統計と区別する。

仕様原案のPhase 1ではAI不要という方針を採用し、末尾の「最重要MVP」にあるAIチェックはS3以降へ分離する。
