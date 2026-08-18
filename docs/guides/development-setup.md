# KOMYAKU 開発環境セットアップ

## 日本語

### 必要な環境

- Bun 1.3以上
- Rust 1.93以上
- Docker DesktopまたはDocker Engine

### 起動

```sh
cp .env.example .env
bun install
docker compose up -d
bun run db:migrate
bun run storage:init
bun run dev:server
bun run dev
```

Web/Tauri Frontendは`http://localhost:1420`、APIは`http://127.0.0.1:3000/api/v1`を使用する。

`bun run db:migrate`はPostgreSQL Advisory Lockを取得し、未適用Migrationだけを順番に実行する。`bun run storage:init`はS3-compatible StorageのBucketを冪等に作成する。

会話Import Repositoryの実PostgreSQL統合テストは、Local Service起動後に次で実行する。Test Fixtureは専用UUIDを使い、終了時に自分が作成したRecordだけを削除する。

```sh
RUN_DB_INTEGRATION=1 bun test apps/server/test/integration/conversation-import-repository.integration.test.js
```

環境変数や秘密鍵をGitへCommitしない。`.env.example`には開発用の例だけを記載し、本番Credentialを保存しない。

`SESSION_TTL_SECONDS`はCloud Sessionの有効期間で、開発時の既定例は2,592,000秒（30日）。変更後は新規発行Sessionから適用される。

`AUTH_RATE_LIMIT_SECRET`はEmailやNetwork IdentifierをRate Limit保存前にHMAC化するKey。`.env.example`の値はLocal開発専用であり、ProductionではSecret Managerから32文字以上のランダム値を設定する。

認証HTTP Routeは既定で無効。通常のLocal開発では`AUTH_ROUTES_ENABLED=false`のままにできる。有効化する場合は`PUBLIC_APP_ORIGIN`と全SMTP設定も必要で、Server起動時にSMTP接続確認が走る。開発用の偽SMTPを用意していない状態で有効化しない。

`TRUSTED_PROXY_HOPS`は既定の`0`を維持する。Reverse Proxy配下で、Proxyが外部から届いた`X-Forwarded-For`を上書きすることを確認できた場合だけ正確なHop数へ変更する。

`single` ModeではAPIとOutbox Dispatcherを同じProcessで実行する。将来分離する場合、`api` ModeはDispatcherを起動せず、`worker` ModeがOutboxをJobへ配送する。`OUTBOX_BATCH_SIZE`、`OUTBOX_LEASE_SECONDS`、`OUTBOX_POLL_INTERVAL_MS`、`OUTBOX_MAX_ATTEMPTS`は計測なしに大きく変更しない。

同じProcessのJob Runnerは登録済みJobだけを実行する。現在は`conversation.imported`のRaw ArchiveをMinIO/S3と照合する。`JOB_BATCH_SIZE`、`JOB_LEASE_SECONDS`、`JOB_POLL_INTERVAL_MS`で調整できる。Object Storageが停止している場合はJobが消失せず、Backoff後に再試行される。

## English

Install Bun 1.3+, Rust 1.93+, and Docker. Copy `.env.example` to `.env`, install dependencies with `bun install`, start PostgreSQL and MinIO, run `bun run db:migrate` and `bun run storage:init`, then start the server and frontend. In `single` mode the same process leases outbox events, creates idempotent jobs, and runs registered handlers; `api` mode omits this work and `worker` mode owns it after separation. The current `conversation.imported` handler verifies raw archive size and SHA-256 metadata, retrying temporary storage failures without deleting source data. `SESSION_TTL_SECONDS` controls new cloud sessions. Replace `AUTH_RATE_LIMIT_SECRET` with a random production secret. Authentication routes remain off when `AUTH_ROUTES_ENABLED=false`; enabling them also requires the public app origin and complete SMTP settings. Keep trusted proxy hops at zero unless a controlled proxy overwrites forwarding headers. Never commit production credentials.

## 简体中文

请安装 Bun 1.3 以上版本、Rust 1.93 以上版本和 Docker。复制 `.env.example` 后安装依赖并启动 PostgreSQL 与 MinIO，然后运行 `bun run db:migrate` 和 `bun run storage:init`，最后启动服务器与前端。在 `single` 模式下，同一进程会租用 Outbox、创建幂等 Job 并执行已注册 Handler；拆分后由 `worker` 模式负责，`api` 模式不执行后台任务。当前 `conversation.imported` Handler 会核对原始归档的大小与 SHA-256 元数据，存储暂时不可用时会重试且不会删除原文。`SESSION_TTL_SECONDS` 控制新会话的有效期，生产环境必须替换 `AUTH_RATE_LIMIT_SECRET`。当 `AUTH_ROUTES_ENABLED=false` 时认证接口不会挂载；启用时还必须配置公开应用来源及完整 SMTP 信息。除非受控代理会覆盖转发头，否则可信代理跳数应保持为零。请勿提交生产环境凭据。
