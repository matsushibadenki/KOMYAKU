# Stable dependency maintenance — 2026-11-09 JST

## 日本語

前回11月2日の依存更新・cosmic-text移行・保守記録が未コミットの状態から開始した。これらを含む全ソースとローカルSymbio path依存を一時コピーし、元の作業ツリーを保護して検証。公式レジストリのstable（Cargoはnon-yanked stable）を確認し、内部workspace/file/path依存とプレリリースを自動更新から除外した。

🟢 [Done] i18next 27.0.1 / react-i18next 18.0.1を組で更新。既存React 19は新peer要件React 18+を満たす。i18next 27の空文字翻訳の既定変更により、待機状態が空表示でなくキー文字列になる回帰を日英中3件で再現し、returnEmptyString: trueを明示して解消。既存の明示的な英語fallback、3言語resources、エスケープ設定は保持。i18n packageのcheckに回帰テストを接続した。新React integrationのNode要件は22+、今回Node 26.12.1で検証。既存Vite要件との共通範囲Node 22.12+をREADMEと3言語の開発手順へ明記した（server runtimeはBun 1.4.0のまま）。

🟢 [Done] reqwest 0.12.28→0.13.5へ移行。0.13の標準rustls機能をそのまま使うとOS root/providerが変わるため、rustls-no-provider、明示的なring providerとWebPKI rootsを共有factoryに設定し、旧rustls-tlsの信頼範囲を保持した。OAuthのform featureを明示し、AI/OAuthの既存タイムアウト、リダイレクト禁止、エラーコードを保持。production側のproxy設定は変更していない。rustls/webpki-rootsを直接宣言したが、テストCAはcfg(test)内でのみ使用し、OS trust storeや本番信頼範囲には追加しない。

🟢 [Done] loopback TLSの実通信6件で、未信頼CAの拒否（async/blocking）、信頼CAでも不正hostnameの拒否、OAuthフォームの特殊文字、JSON/UTF-8/chunk読み取り、リダイレクト禁止（async/blocking）を確認。accept/read/writeを有限時間にし、macOSでacceptされたsocketのblocking状態も明示した。実OpenAI/OAuth/SMTPなどへ認証情報は送信していない。

🟢 [Done] Playwright、Vite React plugin、Vite、Hono、Nodemailer、ProseMirror、Mermaid、AWS SDK、flate2、uuidなどのstable更新を採用。PDF解析用dev依存lopdfを0.46.0→0.47.0へ更新し、既存PDF export/parseテストが成功。Tauri 2、Rust所有のDocument/State/Renderer、wgpu描画、既存3言語UIを維持。

🟠 [Next] Zod最新4.6.7は既知の日時/UTF-16長契約不一致が変わらず、4.4.3のexact pinを維持。Rust/JS共通corpusと互換層を整えてから再開。SQLx 0.9.0はTauri SQL plugin 2.6.0の^0.8要求とSQLite native linksの整合が必要。

🟠 [Next] wgpu 30.0.1はSurface/pipeline/native dock/floatの段階移行後に採用する。今回cosmic-text 0.19とwgpu 27の既存組み合わせは保持し、11月2日のvendorソース変更やMIT/Apache-2.0ライセンスを置換しない。UNGEローカル上流HEAD 8a384911d959c4bc6b9bb973ae380878b28b48e6にはlock/docsの未コミット変更があり、全体置換を行わなかった。

🔴 [Later] rfd最新0.18.0はnativeファイル選択の実機確認後に更新。pdf-writer 0.15.0はsvg2pdf 0.13.0の0.12系依存と連携移行が必要。

⭕️ [Pending] Git client部品は上流の明示ライセンス未確認とローカル変更があるため自動置換しない。PostgreSQL統合25件、実SMTP/S3/AI/OAuth、corporate proxy、Windows/Linux native、パッケージ実機dock/floatは未検証。今回GPU/benchmark/手動fixtureを明示再実行していないものは成功扱いにしない。

## English

Upgraded i18next/react-i18next together and preserved intentionally empty idle statuses after reproducing a three-language regression. Migrated reqwest 0.13 while explicitly preserving the previous WebPKI/ring trust policy, timeouts, redirect prohibition and error mapping. Six real loopback TLS tests cover certificate rejection, hostname checks, form/JSON transport and redirects. Updated other stable libraries and lopdf, preserving previous uncommitted work and Rust-owned state/rendering. External-service/platform checks and the documented Zod/SQLx/GPU/native/PDF writer migrations remain deferred.

## 简体中文

已配套升级 i18next/react-i18next，复现并修复三种语言下空闲状态空字符串变成键名的回归。reqwest 升级至 0.13，同时明确保留原有 WebPKI/ring 信任策略、超时、禁止重定向和错误映射。六项真实回环 TLS 测试覆盖证书拒绝、主机名、表单/JSON 传输和重定向。更新其他稳定版依赖和 lopdf，保留此前未提交的工作及 Rust 状态/渲染所有权。外部服务与其他平台，以及上述 Zod/SQLx/GPU/原生/PDF 生成器迁移仍待后续验证。

## Actual direct dependency changes

| Lockfile | Dependency | Before | After |
|---|---|---|---|
| apps/desktop/src-tauri/Cargo.lock | flate2 | 1.1.10 | 1.1.11 |
| apps/desktop/src-tauri/Cargo.lock | uuid | 1.29.0 | 1.29.1 |
| samples/story-graph/Cargo.lock | flate2 | 1.1.10 | 1.1.11 |
| samples/story-graph/Cargo.lock | lopdf | 0.46.0 | 0.47.0 |
| samples/story-graph/Cargo.lock | reqwest | 0.12.28, 0.13.5 | 0.13.5 |
| samples/story-graph/Cargo.lock | uuid | 1.29.0 | 1.29.1 |
| bun.lock | @aws-sdk/client-s3 | 3.1161.0 | 3.1164.0 |
| bun.lock | @aws-sdk/s3-request-presigner | 3.1161.0 | 3.1164.0 |
| bun.lock | @playwright/test | 1.64.1 | 1.65.0 |
| bun.lock | @vitejs/plugin-react | 6.1.2 | 6.2.1 |
| bun.lock | hono | 4.13.16 | 4.13.17 |
| bun.lock | i18next | 26.7.1 | 27.0.1 |
| bun.lock | mermaid | 12.2.0 | 12.3.0 |
| bun.lock | nodemailer | 10.3.1 | 10.4.0 |
| bun.lock | prosemirror-model | 1.25.12 | 1.25.13 |
| bun.lock | react-i18next | 17.1.11 | 18.0.1 |
| bun.lock | vite | 8.3.5 | 8.3.6 |

## Validation

- Final Bun tests: 676 passed, 25 skipped, 0 failed; check/build passed.
- Project-pinned Bun 1.4.0: same 676 passed / 25 skipped / 0 failed; check/build and sample build/63 JS tests passed. Official temporary binary integrity verified; global toolchain and project pin unchanged.
- Desktop cargo check --locked passed; cargo test --locked: 89 passed, 0 failed, 1 benchmark ignored.
- story-graph bun run check: build and 63 JS tests passed; Rust workspace 229 passed, 0 failed, 21 explicit fixture/GPU/benchmarks ignored. Includes six new TLS tests.
- Final bounded TLS helper: six focused TLS tests passed after the macOS socket inheritance adjustment. The production client configuration was unchanged by this test-only hardening.
- Chrome E2E after the empty-status fix: 60 passed, 0 failed (1.9 minutes), Node CLI / temporary port 1442; existing server on 1420 untouched.
- Temporary shared Cargo target: debug symbols disabled, incremental disabled, four jobs, disk guard at 5 GiB free. Guard did not trigger. Test/debug assertions remain active. Build cache removed after completion.
- Existing chunk-size / ineffective dynamic import and transitive block 0.1.6 future-Rust warnings remain.
- Original KOMYAKU and local Symbio source-hash guards passed before application. Only the verified dependency/migration differences and their regression tests were applied; pre-existing uncommitted changes remain intact. Final frozen installation and the original working tree's 676 tests passed (25 skipped, 0 failed). Post-application hashes confirmed that unrelated sources and all earlier uncommitted work remain intact. git diff --check passed. Development prerequisites now document Node 22.12+ for frontend tooling; the server runtime stays pinned to Bun 1.4.0.

## Evidence

- [Official registry candidates](2026-11-09-candidates.json)
- [Actual lock differences against the starting working tree](2026-11-09-lock-changes.json)
- [i18next 27.0.1 release](https://github.com/i18next/i18next/releases/tag/v27.0.1)
- [i18next official changelog](https://raw.githubusercontent.com/i18next/i18next/master/CHANGELOG.md)
- [react-i18next official published version](https://registry.npmjs.org/react-i18next/18.0.1) — publisher CHANGELOG.md from the package tarball inspected. Migration websites returned HTTP 403, so release/package notes were used instead.
- [reqwest 0.13 documentation](https://docs.rs/reqwest/0.13.5/reqwest/) — public features/API and downloaded crate Cargo.toml/source inspected against 0.12.28.
