# Stable dependency maintenance — 2026-11-02 JST

## 日本語

開始時Git作業ツリーはclean。全Bun workspace、desktop/sampleのRust manifest/lock、vendoredコードを調査し、公式レジストリのlatest stable（Cargoはnon-yanked stable）を確認。プレリリース、内部workspace/file/path依存、独立したSymbioプロジェクトは自動置換しない。

🟢 [Done] 前回保留していたcosmic-textを0.15.0→0.19.0へ更新。上流UNGEのsetter移行方法と公式Buffer APIに合わせ、set_wrap/set_textからFontSystem引数を除き、glyphをキャッシュする前のshape_until_scrollを明示的に維持した。既存のSEMIBOLD/MEDIUM指定、sRGB処理、クリップ、画像exportを保持。Rust/wgpuに描画を保持し、大容量データのWebView転送は追加していない。cosmic-textのMSRV 1.89は既存の開発手順Rust 1.93+以下で、今回はRust 1.99.1で検証した（1.93そのものでは未検証）。

🟢 [Done] encoding_rs 0.8.42→0.8.44、多言語、メール、ProseMirror、AWS SDKなどを更新。ProseMirror listの既存の単一node-type呼び出しは維持し、新しい複数type APIへの不要な変更は加えなかった。Tauri 2とRust側Document/State/Renderer、日英中対応は維持。

🟢 [Done] UNGEローカル上流HEADは364b729ba894bec23ca3f18552a1653971059f88（未コミットCargo.lockあり）。ソース全体は置換せず、必要な文字描画API移行のみ取り込んだ。元のvendor snapshot、独自修正、MIT/Apache-2.0ライセンスは保持し、vendor READMEに出典と検証結果を追記。

🟠 [Next] wgpu 30.0.1はSurface、pipeline、native window/dock/floatの移行を段階的に検証してから採用する。今回は27.0.1を維持。今回のGPU成功は新cosmic-text + 現行wgpuの組み合わせに対する結果。

🟠 [Next] Zod最新は引き続き4.6.7で、既知の日時/UTF-16文字数契約不一致があるため4.4.3のexact pinを維持。失敗済み版の同じ試行を繰り返さず、現行版でRust/JS共通corpusを確認。日時と長さの互換層および全件判定一致を整えてから移行する。

🟠 [Next] SQLx 0.9.0はtauri-plugin-sql 2.6.0の^0.8要求とSQLite native linksの整合が必要。reqwest 0.13.5はTLS feature/証明書/proxy/OAuth redirectの確認と合わせて移行する。両方とも既存互換系列を維持。

🔴 [Later] rfd 0.17.2はnativeファイル選択の実機確認後に更新。pdf-writer 0.15.0はsvg2pdf 0.13.0が要求する0.12系との連携移行が必要。現行のPDF検証は成功している。

⭕️ [Pending] Git client部品は上流の明示ライセンスが未確認でローカル変更もあるため自動置換しない。PostgreSQL統合25件、実SMTP/S3/AI/OAuth、Windows/Linux native、パッケージ実機のdock/floatは未検証。今回実行していないfixture/benchmarkを成功扱いにしない。

## English

Updated stable workspace libraries, encoding_rs and the previously deferred cosmic-text 0.19 migration. Adapted only lazy text setters and retained explicit shaping, local weights, sRGB handling and Rust/GPU ownership. Three native GPU tests passed, including English/Japanese/Simplified Chinese clipping and stacking at two pixel densities. Preserved vendored source provenance and licenses. Zod, SQLx, wgpu, TLS, native dialog and PDF writer upgrades retain the documented blockers above; external-service/platform checks remain Pending.

## 简体中文

已更新 workspace 稳定版依赖、encoding_rs，并完成此前保留的 cosmic-text 0.19 迁移。仅适配延迟文字 setter，保留显式整形、本地字重、sRGB 处理及 Rust/GPU 所有权。三项原生 GPU 测试通过，包括两种像素密度下中日英文字的裁剪与叠放。保留 vendor 来源记录和许可证。Zod、SQLx、wgpu、TLS、原生文件选择及 PDF 生成器仍需满足上述兼容条件后更新；外部服务及其他平台验证仍为 Pending。

## Actual direct dependency changes

| Lockfile | Dependency | Before | After |
|---|---|---|---|
| samples/story-graph/Cargo.lock | cosmic-text | 0.15.0 | 0.19.0 |
| samples/story-graph/Cargo.lock | encoding_rs | 0.8.42 | 0.8.44 |
| bun.lock | @aws-sdk/client-s3 | 3.1156.0 | 3.1161.0 |
| bun.lock | @aws-sdk/s3-request-presigner | 3.1156.0 | 3.1161.0 |
| bun.lock | hono | 4.13.14 | 4.13.16 |
| bun.lock | i18next | 26.5.11 | 26.7.1 |
| bun.lock | nodemailer | 10.2.1 | 10.3.1 |
| bun.lock | prosemirror-schema-list | 1.5.1 | 1.6.0 |
| bun.lock | prosemirror-view | 1.42.8 | 1.42.9 |
| bun.lock | react-i18next | 17.1.9 | 17.1.11 |

## Validation

- bun test: 673 passed, 25 skipped, 0 failed.
- bun run check and bun run build: passed; existing chunk-size warnings remain.
- Project-pinned Bun 1.4.0 (official npm binary, SHA-512 verified): 673 tests passed, 25 skipped, 0 failed; check/build passed. System runtime and project pin were not changed.
- Desktop cargo check --locked passed; cargo test --locked: 89 passed, 0 failed, 1 benchmark ignored.
- story-graph bun run check: web build passed, JS 63 passed, Rust workspace 223 passed, 0 failed, 21 explicit fixture/GPU/benchmark tests ignored by the ordinary suite.
- Explicit native GPU tests: 3 passed, 0 failed. Portrait atlas refresh, pixel/validation, and CJK text clipping/stacking at 1x/2x density. Command: cargo test --locked -p unge-render --test render gpu_ -- --ignored --skip benchmark --test-threads=1.
- Chrome E2E: 60 passed, 0 failed (2.7 minutes), Node CLI and a temporary port-1442 config; existing port-1420 server preserved.
- Verification used one temporary Cargo target, CARGO_PROFILE_DEV_DEBUG=0, CARGO_PROFILE_TEST_DEBUG=0, CARGO_INCREMENTAL=0, CARGO_BUILD_JOBS=4. A disk guard would terminate only this run's build processes below 5 GiB free; it was not triggered. Debug assertions/tests remain enabled. Temporary build output is removed after verification.
- Existing transitive block 0.1.6 future-Rust-compatibility warning remains.
- Final frozen installation: passed (no changes). Baseline source-hash guard confirmed that only the 12 intended dependency/migration files changed; unrelated source was preserved. git diff --check: passed.

## Evidence

- [Official registry candidate audit](2026-11-02-candidates.json)
- [Actual lock differences](2026-11-02-lock-changes.json)
- [cosmic-text changelog](https://github.com/pop-os/cosmic-text/blob/main/CHANGELOG.md)
- [cosmic-text 0.19 Buffer API](https://docs.rs/cosmic-text/0.19.0/cosmic_text/struct.Buffer.html)
- [encoding_rs 0.8.44](https://crates.io/crates/encoding_rs/0.8.44)
- [Published ProseMirror schema-list 1.6.0 package](https://registry.npmjs.org/prosemirror-schema-list/1.6.0) — installed publisher CHANGELOG.md inspected; the archived GitHub copy was stale.
- [react-i18next changelog](https://github.com/i18next/react-i18next/blob/master/CHANGELOG.md)
- [Nodemailer changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md)
