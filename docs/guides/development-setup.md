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

## English

Install Bun 1.3+, Rust 1.93+, and Docker. Copy `.env.example` to `.env`, install dependencies with `bun install`, start PostgreSQL and MinIO, run `bun run db:migrate` and `bun run storage:init`, then start the server and frontend. `SESSION_TTL_SECONDS` controls new cloud sessions. Replace `AUTH_RATE_LIMIT_SECRET` with a random production secret. Never commit production credentials.

## 简体中文

请安装 Bun 1.3 以上版本、Rust 1.93 以上版本和 Docker。复制 `.env.example` 后安装依赖并启动 PostgreSQL 与 MinIO，然后运行 `bun run db:migrate` 和 `bun run storage:init`，最后启动服务器与前端。`SESSION_TTL_SECONDS` 控制新会话的有效期，生产环境必须替换 `AUTH_RATE_LIMIT_SECRET`。请勿提交生产环境凭据。
