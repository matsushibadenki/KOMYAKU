# Stable dependency maintenance — 2026-11-16 JST

🟢 [Done] 公式 npm / crates.io で安定版を照合し、i18next、ProseMirror、Playwright、Hono、Nodemailer、AWS SDK と両 Rust ロックファイルの互換更新を適用。Nodemailer と ProseMirror Input Rules の配布版変更履歴を確認した。Tauri 2、Rust 所有の状態と wgpu 描画、日英中の設定は維持した。

🟠 [Next] Zod 4.6.7 は前回から変わらず、日時と UTF-16 長の Rust/JS 契約が一致するまでは 4.4.3 を維持。SQLx 0.9.0 は Tauri SQL プラグインの 0.8 要求との互換が必要。wgpu 30.0.2 は Surface とパイプラインの移行、ネイティブ描画・ドッキング検証が必要。ローカル UNGE 上流も 27 系を維持しているため、独自描画修正と MIT/Apache-2.0 を含む vendor snapshot を保持した。

🔴 [Later] rfd 0.18.0 はネイティブファイル選択の検証、pdf-writer 0.15.0 は svg2pdf との同時移行が必要。

⭕️ [Pending] PostgreSQL 接続、実 SMTP/S3、他 OS、GPU 実機検証は今回未実施。取り込み元のライセンスが確認できない Git client 部品は差し替え保留。

English: Updated stable workspace libraries and compatible Cargo dependencies. Kept pinned versions where cross-language data, plugin, renderer or native-dialog compatibility still needs validation.

简体中文：已更新工作区稳定版依赖及 Cargo 兼容版本；数据契约、插件、渲染器和原生对话框的待验证版本继续保留。

| Lockfile | Dependency | Before | After |
|---|---|---|---|
| bun.lock | @aws-sdk/client-s3 | 3.1164.0 | 3.1169.0 |
| bun.lock | @aws-sdk/s3-request-presigner | 3.1164.0 | 3.1169.0 |
| bun.lock | @playwright/test | 1.65.0 | 1.65.1 |
| bun.lock | hono | 4.13.17 | 4.13.18 |
| bun.lock | i18next | 27.0.1 | 27.1.2 |
| bun.lock | nodemailer | 10.4.0 | 10.6.0 |
| bun.lock | prosemirror-inputrules | 1.5.1 | 1.6.0 |
| apps/desktop/src-tauri/Cargo.lock | uuid | 1.29.1 | 1.29.2 |
| apps/desktop/src-tauri/Cargo.lock | wry | 0.57.1 | 0.57.2 |
| samples/story-graph/Cargo.lock | uuid | 1.29.1 | 1.29.2 |
| samples/story-graph/Cargo.lock | webpki-roots | 1.0.11 | 1.0.12 |
| samples/story-graph/Cargo.lock | wry | 0.57.1 | 0.57.2 |

- [Registry candidates](2026-11-16-candidates.json)
- [Full lockfile changes](2026-11-16-lock-changes.json)
- [Nodemailer release](https://github.com/nodemailer/nodemailer/compare/v10.4.0...v10.6.0)
- [ProseMirror input rules 1.6.0 package](https://registry.npmjs.org/prosemirror-inputrules/1.6.0)

- [i18next 27.1.2](https://github.com/i18next/i18next/releases/tag/v27.1.2)
- [Vite 8.3.8](https://github.com/vitejs/vite/releases/tag/v8.3.8)

🟠 [Next] Vite 8.3.8 と React プラグイン 6.3.0 の組み合わせは初回検証を通ったが、Rolldown の WASM 向け推移依存に @emnapi/core/runtime 2.0.0-beta.2 を追加したため見送り。現在の 8.3.6 / 6.2.1 を維持し、安定版だけで解決できる構成を再評価する。

検証: Bun 686 件成功（PostgreSQL 25 件スキップ）、check/build 成功。固定 Bun 1.4.0 でも同じ構成を検証。デスクトップ Cargo check / test 成功（89 件）、story-graph のビルド、Bun 73 件、Rust 230 件（ループバック TLS 6 件を含む）成功。Rust の明示実行用フィクスチャ等はデスクトップ 1 件、story-graph 21 件を除外。未追跡の docs/mcp/ は対象外。
Chrome E2E: 最終構成で 60 件成功（ポート 1442）。
