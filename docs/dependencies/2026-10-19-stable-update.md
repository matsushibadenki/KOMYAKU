# Stable dependency maintenance — 2026-10-19 JST

## 日本語

開始時Git作業ツリーはclean。公式npm latestタグとcrates.ioの非yanked stableを調査し、プレリリースを除外。内部workspace/file依存は更新対象外。Tauri 2、Rust所有のDocument/State/Renderer、WebView UIと英語・日本語・简体中文を維持した。

🟢 [Done] Tauri 2.12.4、SQLプラグイン2.6.0、React 19.3.1、i18next 26.5.2、react-i18next 17.1.0、Mermaid 12.2.0等と互換範囲のRust依存を更新。base64 0.22.1→0.23.1、pollster 0.4.0→1.0.1をホストとvendored unge-renderで統一した。base64のSTANDARD / URL_SAFE_NO_PADおよびpollster::block_onの使用を維持。

🟠 [Next] Zod 4.6.7を実際に導入して共通corpusを再検証したが、日時・UTF-16文字数の契約不一致が同じ10件で再現（138 pass / 10 fail）。この更新だけを戻し、4.4.3のexact pinを維持した。日時と長さの互換層を定義しRust/JS両側の共通corpusを全件通してから再開する。

🟠 [Next] SQLx 0.9.0はTauri SQLプラグイン2.6.0が引き続き^0.8を要求するため未採用。SQLite native linksを二重化せず、プラグイン側対応と合わせて移行する。

🟠 [Next] wgpu 30.0.1 / cosmic-text 0.19.0はnative Surface、Glyph Atlas、整形/fallback、日英中描画、dock/floatの移行と実機QAが必要なため未採用。UNGEのローカル上流HEADは5498d1bf371bb13e2d6e17174531f70a7fd97c9eで未コミットの描画変更を含む。vendor独自の画像export等とMIT/Apache-2.0ライセンスを保持し、上流ソース全体を無条件に置換しなかった。

🟠 [Next] reqwest 0.13.5はTLS feature、証明書、proxy、OAuth redirectの契約確認と合わせて移行する。今回は0.12系を維持。

🔴 [Later] rfd 0.17.2はnativeファイル選択の実機確認、pdf-writer 0.15.0はsvg2pdf 0.13.0が要求する0.12系との連携移行が必要なため未採用。

⭕️ [Pending] Git client部品は取り込み時にlicense宣言が確認できず、ローカル改変を含むため自動置換しない。明確な上流ライセンスと差分確認後に再開。

⭕️ [Pending] PostgreSQL統合テスト25件は環境未設定でskip。実SMTP/S3/AI/OAuth、Windows/Linuxのnative動作とパッケージ実機のdock/floatは未検証。明示実行しないfixture/benchmarkは成功扱いにしない。

## English

Updated stable Tauri, SQL plugin, React, localization, Mermaid and compatible lockfile dependencies. Migrated host and vendored renderer base64/pollster together while preserving local source changes and licenses. Zod 4.6.7 reproduced ten cross-language contract failures and was restored to 4.4.3. SQLx, GPU/text, TLS, native dialog and PDF migrations remain deferred under the conditions above. All ordinary checks and 60 Chrome E2E tests passed. Four explicit native GPU tests also passed, including CJK rendering. External-service/platform checks remain Pending.

## 简体中文

已更新 Tauri、SQL 插件、React、多语言、Mermaid 及兼容锁文件依赖，并统一升级宿主和 vendored 渲染器的 base64/pollster，保留本地修改与许可证。Zod 4.6.7 仍导致十项跨语言契约失败，已恢复为 4.4.3。SQLx、GPU/文字、TLS、原生文件选择和 PDF 迁移需满足上述兼容条件后再更新。常规检查、60 项 Chrome E2E 和 4 项显式原生 GPU 测试（含中日英文字渲染）均通过。外部服务及其他平台验证仍为 Pending。

## Actual direct dependency changes

| Lockfile | Dependency | Before | After |
|---|---|---|---|
| apps/desktop/src-tauri/Cargo.lock | sha2 | 0.10.9, 0.11.0 | 0.10.9, 0.11.1 |
| apps/desktop/src-tauri/Cargo.lock | tauri | 2.12.3 | 2.12.4 |
| apps/desktop/src-tauri/Cargo.lock | tauri-build | 2.7.2 | 2.7.3 |
| apps/desktop/src-tauri/Cargo.lock | tauri-plugin-sql | 2.5.0 | 2.6.0 |
| apps/desktop/src-tauri/Cargo.lock | tauri-runtime-wry | 2.12.1 | 2.12.2 |
| apps/desktop/src-tauri/Cargo.lock | tokio | 1.53.2 | 1.53.3 |
| samples/story-graph/Cargo.lock | pollster | 0.4.0 | 0.4.0, 1.0.1 |
| samples/story-graph/Cargo.lock | sha2 | 0.10.9, 0.11.0 | 0.10.9, 0.11.1 |
| samples/story-graph/Cargo.lock | tauri | 2.12.3 | 2.12.4 |
| samples/story-graph/Cargo.lock | tauri-build | 2.7.2 | 2.7.3 |
| samples/story-graph/Cargo.lock | tauri-runtime-wry | 2.12.1 | 2.12.2 |
| samples/story-graph/Cargo.lock | tokio | 1.53.2 | 1.53.3 |
| bun.lock | @aws-sdk/client-s3 | 3.1149.0 | 3.1152.0 |
| bun.lock | @aws-sdk/s3-request-presigner | 3.1149.0 | 3.1152.0 |
| bun.lock | @playwright/test | 1.64.0 | 1.64.1 |
| bun.lock | @tauri-apps/api | 2.12.3 | 2.12.4 |
| bun.lock | @tauri-apps/cli | 2.12.2 | 2.12.3 |
| bun.lock | @tauri-apps/plugin-sql | 2.5.0 | 2.6.0 |
| bun.lock | i18next | 26.4.3 | 26.5.2 |
| bun.lock | mermaid | 12.1.0 | 12.2.0 |
| bun.lock | nodemailer | 10.1.0 | 10.1.7 |
| bun.lock | react | 19.3.0 | 19.3.1 |
| bun.lock | react-dom | 19.3.0 | 19.3.1 |
| bun.lock | react-i18next | 17.0.16 | 17.1.0 |

## Validation

- bun test: 662 passed, 25 skipped, 0 failed.
- bun run check and bun run build: passed; large-chunk warnings remain.
- Desktop cargo check --locked: passed.
- Desktop cargo test --locked: 87 passed, 0 failed, 1 benchmark ignored.
- story-graph bun run check: build passed, Bun 61 passed, Rust workspace 219 passed, 0 failed, 21 explicit fixtures/GPU/benchmarks ignored by the ordinary suite.
- Explicit GPU command: cargo test --locked -p unge-render --test render gpu_ -- --ignored --test-threads=1. Four tests passed: native GPU benchmark, portrait atlas refresh, pixel validation, and English/Japanese/Simplified Chinese clipping/stacking at two pixel densities. This exercises the adopted wgpu 27/cosmic-text 0.15 combination; it does not validate the deferred wgpu 30/cosmic-text 0.19 migration.
- Chrome E2E: 60 passed, 0 failed (3.1 minutes). A temporary Playwright config uses Node CLI and port 1442, preserving the existing port 1420 server.
- Tauri generated ACL boundary tests: 9 passed, 0 failed. No tracked generated-schema changes were produced.
- git diff --check: passed.
- Cargo reports a future Rust compatibility warning for transitive block 0.1.6; compilation/tests succeed on Rust 1.99.0. Native dependency migration remains a follow-up rather than a claim of compatibility with a future compiler.

## Evidence

- [Official registry candidates](2026-10-19-candidates.json)
- [Actual lock changes](2026-10-19-lock-changes.json)
- [Tauri releases](https://github.com/tauri-apps/tauri/releases)
- [SQL plugin releases](https://github.com/tauri-apps/plugins-workspace/releases)
- [SQL plugin dependency requirements](https://crates.io/api/v1/crates/tauri-plugin-sql/2.6.0/dependencies)
- [base64 release notes](https://github.com/marshallpierce/rust-base64/blob/master/RELEASE-NOTES.md)
- [pollster 1.0.1](https://docs.rs/pollster/1.0.1/pollster/)
- [Zod releases](https://github.com/colinhacks/zod/releases)
- [Mermaid releases](https://github.com/mermaid-js/mermaid/releases)
- [Nodemailer changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md)
