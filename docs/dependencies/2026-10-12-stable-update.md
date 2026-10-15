# Stable dependency maintenance — 2026-10-12 JST

## 日本語

開始時のGit作業ツリーはclean。Bun 1.4.0、Node 26.11.1、Cargo/Rust 1.99.0、macOSで検証。公式npm latestタグとcrates.ioの非yanked・非プレリリース版を調査した。全依存が最新という意味ではない。内部workspace/file依存を除外し、Tauri 2とRust所有の状態・描画設計を維持した。

🟢 [Done] JavaScript依存を更新し、両Rustロックファイルの互換範囲を更新。story-graphのTauriを2.11.6→2.12.3、tauri-runtime-wryを2.11.4→2.12.1、objc2を0.6.4→0.6.5へまとめて更新。

🟠 [Next] Zod 4.6.6は既存のRust/JavaScript共通契約テスト10件を壊した。分単位のISO日時・年0000の日時の判定、およびUTF-16長制限との不一致が発生したため更新を戻し、4.4.3へexact pinした。再開条件は両側の日時と文字数の契約を明示して共通corpusを全件通すこと。

🟠 [Next] SQLx 0.9.0は未採用。tauri-plugin-sql 2.5.0がsqlx 0.8を要求し、SQLiteのnative linksの整合を必要とする。プラグイン側の対応または接続層の移行を確認してから更新する。

🟠 [Next] wgpu 27.0.1→30.0.1、cosmic-text 0.15.0→0.19.0は未採用。native SurfaceとGPUパイプライン、整形・fallback API、日英中の文字描画・欠字・クリップ・ドッキングを段階移行で検証してから更新する。UNGE vendorはMIT OR Apache-2.0。ローカル上流HEAD d7c6b6ff3fc2da284b127bb7f6a2cbc345b3e4f1は未コミット変更を含み、vendorには独自のexport_image.rs等があるため全体置換しなかった。

🟠 [Next] reqwest 0.12→0.13.5はTLS featureがrustls-tlsからrustlsへ変わる。AI/OAuthの証明書・proxy・redirect契約を確認してから採用する。

🔴 [Later] pdf-writer 0.12.1→0.15.0はsvg2pdf 0.13.0がpdf-writer 0.12を要求するため連携して移行する。base64 0.22→0.23.1、pollster 0.4→1.0.1、rfd 0.16.0→0.17.2も今回は未採用。それぞれ保存アーカイブ/OAuth encoding、GPU初期化、nativeファイルダイアログの互換性を個別に確認してから更新する。

⭕️ [Pending] 外部由来のGit client部品は取り込み時点でlicense宣言がなく、Rust版履歴表示に合わせたローカル改変がある。上流のライセンスと差分を確認できるまで自動置換しない。

⭕️ [Pending] PostgreSQL統合テスト25件は接続環境未設定でskip。Rustの明示実行用fixture/GPU/benchmarkはデスクトップ1件、story-graph21件を実行していない。実SMTP/S3/AI/OAuth、Windows/Linuxのnative動作とmacOSパッケージのdock/float/GPU実機QAは未検証。通常テスト成功はこれらの検証完了を意味しない。

## English

Updated stable JavaScript dependencies and compatible Rust lockfile dependencies on macOS, preserving Tauri 2 and Rust-owned state/rendering. Zod was restored and pinned to 4.4.3 after ten shared-contract failures. SQLx, GPU/text, TLS, PDF and selected native/helper upgrades remain deferred with the resume conditions above. Local UNGE modifications and source provenance were preserved. Environment-dependent tests are Pending, not verified.

## 简体中文

已更新 JavaScript 稳定版依赖及兼容范围内的 Rust 锁文件，保留 Tauri 2 和 Rust 端状态与渲染架构。Zod 更新导致十项跨语言契约测试失败，因此恢复并固定为 4.4.3。SQLx、GPU/文字、TLS、PDF 及部分原生/辅助依赖待满足上述兼容性条件后更新。保留 UNGE 的本地修改和来源信息。需要外部环境的测试标记为 Pending。

## Actual npm lock versions

| Dependency | Before (lock) | After (lock) |
|---|---|---|
| @tauri-apps/api | 2.11.1 | 2.12.3 |
| @tauri-apps/plugin-sql | 2.4.0 | 2.5.0 |
| i18next | 25.10.10 | 26.4.3 |
| react | 19.2.8 | 19.3.0 |
| react-dom | 19.2.8 | 19.3.0 |
| react-i18next | 15.7.4 | 17.0.16 |
| @playwright/test | 1.62.1 | 1.64.0 |
| @tauri-apps/cli | 2.11.4 | 2.12.2 |
| @vitejs/plugin-react | 5.2.0 | 6.1.2 |
| vite | 7.3.6 | 8.3.4 |
| hono | 4.13.1 | 4.13.13 |
| nodemailer | 7.0.13 | 10.1.0 |
| sharp | 0.35.4 | 0.35.5 |
| uuid | 13.0.2 | 14.0.3 |
| prosemirror-history | 1.5.0 | 1.5.1 |
| prosemirror-model | 1.25.11 | 1.25.12 |
| prosemirror-view | 1.42.2 | 1.42.6 |
| yjs | 13.6.32 | 13.6.33 |
| katex | 0.16.47 | 0.19.0 |
| mermaid | 11.17.2 | 12.1.0 |
| @aws-sdk/client-s3 | 3.1110.0 | 3.1149.0 |
| @aws-sdk/s3-request-presigner | 3.1110.0 | 3.1149.0 |

## Validation

- bun test: 622 pass, 25 skip, 0 fail.
- bun run check: passed.
- bun run build: passed; existing large-chunk warnings remain.
- Desktop Rust cargo check --locked: passed.
- Desktop Rust cargo test --locked: 76 passed, 0 failed, 1 performance fixture ignored.
- story-graph bun run check: build passed, Bun 61 passed, Rust workspace 219 passed, 0 failed, 21 fixtures/GPU/benchmark tests ignored.
- Chrome E2E: all 57 passed using port 1442 and Node CLI (6.1 minutes).
- Generated Tauri ACL boundary test: 9 passed, 0 failed. New generated permission definitions cover app exit and fullscreen-on-monitor; existing default_permission and permission_sets are unchanged.
- git diff --check: passed.
- Tauri generated ACL/schema files are retained to match the adopted SDK.
- Default E2E port 1420 was occupied; a temporary configuration uses port 1442 and Node CLI without stopping the existing server. Three hardcoded test-origin references (URL assertion, mock CORS allow-origin and checkpoint origin assertion) now use Playwright project baseURL. The first run exposed origin mismatches; the complete rerun passed after this repair.

## Audit evidence

- [npm stable candidates](2026-10-12-npm-candidates.json)
- [Rust stable candidates](2026-10-12-cargo-candidates.json)
- [Actual npm lock changes](2026-10-12-npm-lock-changes.json)
- [Actual Rust lock changes](2026-10-12-rust-lock-changes.json)
- [Vite migration](https://vite.dev/guide/migration)
- [react-i18next changelog](https://github.com/i18next/react-i18next/blob/master/CHANGELOG.md)
- [Nodemailer changelog](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md)
- [UUID changelog](https://github.com/uuidjs/uuid/blob/main/CHANGELOG.md)
- [Mermaid releases](https://github.com/mermaid-js/mermaid/releases)
- [KaTeX releases](https://github.com/KaTeX/KaTeX/releases)
- [reqwest 0.13 features](https://docs.rs/reqwest/0.13.5/reqwest/)
- [wgpu releases](https://github.com/gfx-rs/wgpu/releases)
- [cosmic-text changelog](https://github.com/pop-os/cosmic-text/blob/main/CHANGELOG.md)
