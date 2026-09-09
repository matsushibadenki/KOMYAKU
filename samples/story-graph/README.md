# Story Graph — KOMYAKU sample application

KOMYAKU完成後に開発する独立サンプルアプリ。文章の意味単位をグラフで構成し、通常のエディタで執筆し、選択したStory Pathを文章として読む体験を提供する。

## 状態と開発場所

現在は開発準備のみ。アプリ実装・依存ライブラリ導入・起動コマンドはまだない。
作業場所はこの `samples/story-graph/` ディレクトリとする。本体の `apps/desktop` とは別アプリとして開発する。
ルートのBun workspace（`apps/*`、`packages/*`）には登録していない。実装開始時に独立したmanifest、ビルド、テスト、Tauri識別子と保存領域を用意する。

- [設計原案](../../docs/Story-Graph設計仕様書.md)
- [画面イメージ](../../docs/images/Story-Graphイメージ.png)
- [開発ロードマップ](ROADMAP.md)
- [本体との境界・画面方針](ARCHITECTURE.md)

原案の「KOMYAKU内部に追加」「第二の中核概念」という記述は長期構想として保持する。実装順序・配置については、今回の「KOMYAKU完成後、別ディレクトリのサンプルアプリとして作成」を優先する。

## 完成後に再利用するもの

Canonical Document、本文エディタ、Version、比較、Archive、必要になった段階のAI Gatewayを、公開されたパッケージ境界から利用する。本体のReact画面やSQLite内部テーブルへ直接依存しない。再利用に不足するAPIは契約として整理し、本体側で互換性を検証してから使用する。

## Languages

UIは日本語・English・简体中文。作者が書いた本文は自動翻訳・Unicode正規化しない。

English: A separate sample application to be implemented after KOMYAKU is complete. This directory currently contains planning documents only.

简体中文：在 KOMYAKU 完成后开发的独立示例应用。此目录目前仅包含规划文档。
