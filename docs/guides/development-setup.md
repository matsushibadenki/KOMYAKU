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

Productionでは`NODE_ENV=production`を設定すると、Local Database、HTTP Object Storage、開発Credential、HTTP CORS、弱いSecret、AI学習許可の既定値が起動前に拒否される。詳細は`production-readiness.md`を参照する。

`SESSION_TTL_SECONDS`はCloud Sessionの有効期間で、開発時の既定例は2,592,000秒（30日）。変更後は新規発行Sessionから適用される。

`AUTH_RATE_LIMIT_SECRET`はEmailやNetwork IdentifierをRate Limit保存前にHMAC化するKey。`.env.example`の値はLocal開発専用であり、ProductionではSecret Managerから32文字以上のランダム値を設定する。

認証HTTP Routeは既定で無効。通常のLocal開発では`AUTH_ROUTES_ENABLED=false`のままにできる。単体Serverで有効化するときは`NOTIFICATION_WORKER_ENABLED=true`、`PUBLIC_APP_ORIGIN`、`NOTIFICATION_ENCRYPTION_KEY`、全SMTP設定も必要で、Server起動時にSMTP接続確認が走る。開発用の偽SMTPを用意していない状態で通知Workerを有効化しない。

`TRUSTED_PROXY_HOPS`は既定の`0`を維持する。Reverse Proxy配下で、Proxyが外部から届いた`X-Forwarded-For`を上書きすることを確認できた場合だけ正確なHop数へ変更する。

`single` ModeではAPIとOutbox Dispatcherを同じProcessで実行する。将来分離する場合、`api` ModeはDispatcherを起動せず、`worker` ModeがOutboxをJobへ配送する。`OUTBOX_BATCH_SIZE`、`OUTBOX_LEASE_SECONDS`、`OUTBOX_POLL_INTERVAL_MS`、`OUTBOX_MAX_ATTEMPTS`は計測なしに大きく変更しない。

同じProcessのJob Runnerは登録済みJobだけを実行する。`conversation.imported`はRaw ArchiveをMinIO/S3と照合し、`notification.delivery_requested`は暗号化Payloadを開いて有効TokenだけをSMTP配送する。`JOB_BATCH_SIZE`、`JOB_LEASE_SECONDS`、`JOB_POLL_INTERVAL_MS`で調整できる。依存Serviceが停止している場合はJobが消失せず、Backoff後に再試行される。

認証負荷のLocal Regressionは次で実行する。外部Hostへ接続せず、一時的なLoopback Serverと実Argon2 Dummy Verificationを使用する。

```sh
bun run --filter @komyaku/server test:auth-load
```

## English

Install Bun 1.3+, Rust 1.93+, and Docker. Copy `.env.example` to `.env`, install dependencies, start PostgreSQL and MinIO, apply migrations, initialize storage, and start the server and frontend. Single mode can run the API, Outbox, Jobs, and encrypted notification delivery together. Split deployments use `AUTH_ROUTES_ENABLED` on API replicas and `NOTIFICATION_WORKER_ENABLED` on Workers. Both require the same notification encryption key; only Workers require SMTP credentials. Run `test:auth-load` for the loopback Argon2 endpoint regression. Never commit production credentials.

## 简体中文

请安装Bun 1.3以上版本、Rust 1.93以上版本和Docker。复制`.env.example`后安装依赖，启动PostgreSQL与MinIO并执行Migration。在single模式下，API、Outbox、Job和加密通知配送可在同一进程运行。拆分部署时，API使用`AUTH_ROUTES_ENABLED`，Worker使用`NOTIFICATION_WORKER_ENABLED`；两者共享通知加密密钥，SMTP凭据只配置给Worker。可运行`test:auth-load`执行本地Loopback Argon2回归测试。请勿提交生产凭据。
