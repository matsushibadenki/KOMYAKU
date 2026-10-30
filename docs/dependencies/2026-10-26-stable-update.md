# Stable dependency maintenance — 2026-10-26 JST

## 日本語

開始時はSymbio数式統合などの未コミット変更が存在した。元の作業ツリーを変更せず、既存変更と未追跡ソースを含む隔離コピーで依存更新を検証した。ローカルpath依存のSymbioもコピーして既存統合を保持した。適用前後に元ソースのハッシュを再照合し、依存10ファイルと保守記録4ファイルだけを反映済み。既存の未コミットソースは保持した。

🟢 [Done] 公式npm latestとcrates.ioの非yanked stableを確認。Tauri 2.12.5 / runtime-wry 2.12.3 / build 2.7.4、Tokio 1.54.1、uuid 1.29.0、i18next 26.5.11、react-i18next 17.1.9、Vite 8.3.5、Nodemailer 10.2.1、KaTeX 0.19.1、ProseMirror View 1.42.8、AWS SDK 3.1156.0等を更新候補として採用。PDF解析用dev依存lopdfを0.45.0→0.46.0へ移行し既存のPDF export検証で成功を確認した。内部workspace/file/path依存とTauri 2/Rust所有の状態・描画設計、3言語対応を維持。

🟠 [Next] Zodの最新stableは前回と同じ4.6.7。前回の日時・UTF-16文字数に関する共通契約不一致10件が解消したという上流根拠がないため、4.4.3のexact pinを維持。今回は同じ失敗する更新を繰り返さず、採用版で共通契約を確認。日時と長さの互換層を明示しRust/JS corpusが全件一致してから再開。

🟠 [Next] SQLx 0.9.0はtauri-plugin-sql 2.6.0の^0.8要求とSQLite native linksの整合が必要なため未採用。プラグイン対応と同時に移行する。

🟠 [Next] wgpu 30.0.1 / cosmic-text 0.19.0はSurface、GPU pipeline、整形/fallback、日英中の欠字・クリップとdock/floatを段階移行で確認してから更新。UNGE上流HEAD 5498d1bf371bb13e2d6e17174531f70a7fd97c9eには未コミットの描画・ACX変更がある。MIT/Apache-2.0とvendorの独自画像export等を保持し、上流を無条件置換しなかった。

🟠 [Next] reqwest 0.13.5はTLS feature、証明書、proxy、OAuth redirectの互換確認が必要なため0.12系を維持。

🔴 [Later] rfd 0.17.2はnativeファイル選択の実機確認と合わせて更新。pdf-writer 0.15.0はsvg2pdf 0.13.0の0.12系依存と連携して移行する。今回のlopdfはPDFを読むdev依存であり、PDF生成APIの移行とは別。

⭕️ [Pending] Git client部品は明示的な上流licenseが未確認でローカル改変を含むため自動置換しない。上流ライセンスと差分確認後に再開。

⭕️ [Pending] PostgreSQL統合25件、実SMTP/S3/AI/OAuth、Windows/Linux native、パッケージ実機のdock/floatは未検証。通常スキップされるfixture/GPU/benchmarkを成功扱いにしない。

## English

Protected existing uncommitted Symbio integration by testing a complete source snapshot, including local path dependencies. Selected current stable npm/Rust updates and lopdf 0.46 for PDF parsing tests. Kept Zod 4.4.3 and documented the unchanged contract blocker. SQLx, GPU/text, TLS, native dialog and PDF writer migrations remain deferred. Applied only dependency differences after verifying original source hashes; preserved all user edits and licenses. All checks and 60 E2E tests passed; 673 tests/check/build also passed on the project-pinned Bun 1.4.0.

## 简体中文

通过包含本地 path 依赖的完整隔离快照保护现有未提交的 Symbio 集成。采用当前 npm/Rust 稳定版更新，并升级 PDF 解析测试依赖 lopdf 至 0.46。Zod 仍固定为 4.4.3，原有契约问题尚未解决。SQLx、GPU/文字、TLS、原生文件选择和 PDF 生成器迁移继续保留。应用前后已重新检查原始源码哈希，只反映依赖差异，保留用户修改与许可证。所有检查与 60 项 E2E 通过；项目固定的 Bun 1.4.0 上的 673 项测试、check 和 build 也通过。

## Actual direct dependency differences

| Lockfile | Dependency | Before | After |
|---|---|---|---|
| apps/desktop/src-tauri/Cargo.lock | tauri | 2.12.4 | 2.12.5 |
| apps/desktop/src-tauri/Cargo.lock | tauri-build | 2.7.3 | 2.7.4 |
| apps/desktop/src-tauri/Cargo.lock | tauri-runtime-wry | 2.12.2 | 2.12.3 |
| apps/desktop/src-tauri/Cargo.lock | tokio | 1.53.3 | 1.54.1 |
| apps/desktop/src-tauri/Cargo.lock | uuid | 1.28.0 | 1.29.0 |
| samples/story-graph/Cargo.lock | lopdf | 0.45.0 | 0.46.0 |
| samples/story-graph/Cargo.lock | tauri | 2.12.4 | 2.12.5 |
| samples/story-graph/Cargo.lock | tauri-build | 2.7.3 | 2.7.4 |
| samples/story-graph/Cargo.lock | tauri-runtime-wry | 2.12.2 | 2.12.3 |
| samples/story-graph/Cargo.lock | tokio | 1.53.3 | 1.54.1 |
| samples/story-graph/Cargo.lock | uuid | 1.28.0 | 1.29.0 |
| bun.lock | @aws-sdk/client-s3 | 3.1152.0 | 3.1156.0 |
| bun.lock | @aws-sdk/s3-request-presigner | 3.1152.0 | 3.1156.0 |
| bun.lock | @tauri-apps/cli | 2.12.3 | 2.12.4 |
| bun.lock | hono | 4.13.13 | 4.13.14 |
| bun.lock | i18next | 26.5.2 | 26.5.11 |
| bun.lock | katex | 0.19.0 | 0.19.1 |
| bun.lock | nodemailer | 10.1.7 | 10.2.1 |
| bun.lock | prosemirror-view | 1.42.6 | 1.42.8 |
| bun.lock | react-i18next | 17.1.0 | 17.1.9 |
| bun.lock | vite | 8.3.4 | 8.3.5 |

## Validation

- Isolated source snapshot bun test: 673 passed, 25 skipped, 0 failed.
- bun run check / bun run build: passed, large-chunk warnings remain.
- Desktop cargo check --locked: passed.
- Desktop cargo test --locked: 89 passed, 0 failed, 1 explicit benchmark ignored; existing Symbio integration was included.
- story-graph bun run check: build passed, Bun 63 passed, Rust workspace 223 passed, 0 failed, 21 explicit fixtures/GPU/benchmarks ignored. Existing PDF export/parse tests passed with lopdf 0.46.0.
- Chrome E2E: 60 passed, 0 failed (6.3 minutes); isolated source, Node CLI and port 1442.
- GPU tests were not explicitly rerun this time; the ordinary suite ignored tests are not counted as passes.
- Large frontend chunk warnings and the transitive block 0.1.6 future-Rust-compatibility warning remain.
- Original KOMYAKU and local Symbio source hashes matched the tested snapshot before application. Applied dependency-only differences; existing dirty business/UI/math source files were verified unchanged afterward.
- Original working tree frozen-lockfile install and final Bun tests: passed, 673 passed / 25 skipped / 0 failed.
- Project-pinned Bun 1.4.0 was fetched temporarily from the official npm distribution with SHA-512 integrity verification. On that runtime, all 673 tests, check and build passed as well. No global toolchain or project runtime pin was changed.
- Installed verification environment: Bun 1.4.3, Node 26.12.1, rustc/Cargo 1.99.1.
- git diff --check: passed.

## Evidence

- [Official registry candidates](2026-10-26-candidates.json)
- [Actual lock differences against the dirty starting tree](2026-10-26-lock-changes.json)
- [Tauri releases](https://github.com/tauri-apps/tauri/releases)
- [Nodemailer changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md)
- [react-i18next changelog](https://github.com/i18next/react-i18next/blob/master/CHANGELOG.md)
- [lopdf releases](https://github.com/J-F-Liu/lopdf/releases)
