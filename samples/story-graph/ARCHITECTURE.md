# Story Graph implementation boundaries

## 独立アプリと共有エンジン

Story GraphはKOMYAKUを利用するサンプル製品とする。固有のCanvas、Story schema、Path compiler、Graph command履歴は本ディレクトリ内に置く。汎用性が検証される前に本体の共有パッケージへ移さない。

実装時の予定構成（未作成）：

```text
samples/story-graph/
  src/app/          アプリ画面と操作
  src/graph/        schema、検証、Path、compiler、lineage
  src/adapters/     KOMYAKU公開APIとの接続
  src/locales/      ja、en、zh-Hans
  src-tauri/        独立したアプリ識別子とローカル保存
  test/            domain、保存復旧、画面の検証
```

## 正本と復元単位

- 本文の正本はCanonical Document。Story Nodeは本文を複製せず、Document IDと安定Node IDを参照する。
- Story Node ID、Canonical Node ID、Version IDは別の識別子とする。
- Story Pathは作品内の読み順、Version Branchは編集の履歴。Canvas上でも名称と操作を分ける。
- 読み順のFlowにはDAG制約を適用し、意味関係の循環を同じ制約で拒否しない。
- 保存・復元の単位は本文、Graph、Path、lineage、必要なAssetの整合した集合とする。Graphだけ新しく本文だけ古い状態を許さない。

既存の単一Canonical DocumentのVersion/ArchiveがGraph全体を保持できるとは仮定しない。Graphを独立オブジェクトとして参照するSnapshot manifest等の拡張契約を、実装前に決める。`.komyaku` v1を完全Graphバックアップと呼ばない。

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

狭幅では三列を押し込まず、Graph／Editor／Readingを切り替え、ナビゲーションは開閉式にする。左右16px以上の余白と意味のまとまりを保つ改行を確認する。画像中の挿絵は方向性の参考であり、配布用素材は別途準備する。

## AIと性能

AIはMVP後。送信対象Nodeと文脈を表示し、提案を人間が採用して初めて新しいVersionにする。意味関係・AI Workflow・読み順は別レイヤーとして扱う。

1,000／5,000／10,000 Nodeを段階的に測定する。Viewport外の仮想化、Focus、Semantic Zoomを設計に含めるが、測定前に快適性を達成済みとしない。
