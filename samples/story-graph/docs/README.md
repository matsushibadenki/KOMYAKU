# Story Graph — KOMYAKU sample application

`samples/story-graph/` に構築した独立したTauri 2 + Rustアプリです。KOMYAKUのCanonical Document schemaを利用し、UNGEで物語のノードと登場人物の相関を表示します。

## 起動

リポジトリルートで `bun install` 済みであること、RustとTauriのmacOS前提環境を用意してください。Webビルドツールは本体で固定されたVite／Tauri CLIを再利用します。独立したRust workspace・アプリ識別子・保存先を使い、本体アプリの保存領域へアクセスしません。

```sh
cd samples/story-graph
bun run tauri       # UIをビルドしてTauri + wgpuを起動
bun run dev         # http://127.0.0.1:1437 — 閲覧専用ブラウザープレビュー
bun run check       # Webビルド、JSテスト、Rust workspaceテスト
bun run package     # macOSのdebug .appを作成
```

生成アプリ：`target/debug/bundle/macos/KOMYAKU Story Graph.app`。未署名の開発用ビルドです。

## 今回実装した操作

- シーンを選んで本文・タイトル・メモを編集。本文はプレーンテキスト。Canonical DocumentのDocument IDとParagraph IDを維持する。
- 900msの入力停止とフォーカス移動で保存。保存失敗／revision競合時には画面内の入力を保持する。競合時は最新内容を取得して比較し、作者が「入力中の内容を採用」か「最新内容に戻す」を選ぶ。Undo／Redoは本文・ノード・関係を共通の履歴で扱う。
- 本編／別展開の読み順を選んで読む。欠番・重複・接続切れはエラーとして表示する。シーン追加は選択した読み順の末尾へ接続する。
- 登場人物の名前・設定・メモを編集。二人を選んで家族・友人・対立・信頼・愛情の関係を追加し、一方向／相互を指定する。
- 人物削除は関連する関係ノードの削除と一括Undo。共有シーンの削除は順番と接続を調整する。片方の分岐だけの削除で共有シーンの順番が衝突する操作は拒否する。
- 本文パネルを分離／戻す。両ウインドウは同じRust Engineを編集する。グラフ表示はUNGEのネイティブwgpu別ウインドウで、移動・接続・選択・右ドラッグPan・ホイールZoomを操作する。
- 現在の本文・配置・接続・人物相関を一体のJSONで保存し、再起動時に読み込む。バックアップも同じ形式でアプリ保存領域に作成し、場所を表示する。
- UI：日本語・English・简体中文。作者が書いた本文や人物名は翻訳・Unicode正規化しない。

## 保存形式と制限

`dev.komyaku.storygraph` のアプリデータ領域の `workspace.story.json` に保存します。検証用には `STORY_GRAPH_DATA_DIR=/tmp/story-graph-qa` を指定できます。書き込みは一時ファイルへ同期してからrenameします。壊れた既存ファイルをサンプル作品で置き換えることはありません。

保存形式はサンプル専用 `komyaku-story-workspace` v1。各Sceneが唯一のCanonical DocumentをUNGEのpropertyに持つ暫定アダプターです。共有のCanonical Story Workspace v1や `.komyaku` Archive互換ではありません。本文は複数Paragraphと2列1行のセリフTableに対応し、装飾なしの平文でシーン6 MiBまで（canonical JSON 16 MiB、workspace 128 MiB）。通常入力は段落範囲の差分更新、画面外はレイアウト・描画を省略します。完全なDOM仮想化は次段階です。Nodeは256、Edgeは1,024に制限しています。完全Version／Branch／Merge、任意の名前付きPath、豊富な本文Block、バックアップを選んで取り込むUIは次段階です。Undo履歴はメモリ内で、再起動を跨ぐVersion履歴ではありません。

UNGEは人物から関係ノードへの二つの入力で相関を表現します。A→B、B→C、C→Aのような意味上の循環があっても、ノード実行DAGへ循環を持ち込みません。リンク先UNGEは変更せず `vendor/unge/` に必要なソースとライセンスを取り込んでいます。

- [設計原案](../../../docs/Story-Graph設計仕様書.md)
- [参考画像](../../../docs/images/Story-Graph-images.png)
- [ロードマップ](ROADMAP.md)
- [実装境界](ARCHITECTURE.md)
- [検証記録](VERIFICATION.md)

English: A standalone Tauri sample with Rust-owned state, canonical plain text, two story routes, character relationships, autosave, and a native UNGE/wgpu window. The browser preview is read-only. Full KOMYAKU archive/version integration is unfinished.

简体中文：独立的 Tauri 示例应用，包含 Rust 共享状态、规范化纯文本结构、两条故事路线、人物关系、自动保存和 UNGE/wgpu 原生窗口。浏览器仅供只读预览。完整的 KOMYAKU 归档和版本集成尚未完成。
