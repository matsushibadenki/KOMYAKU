# Production Readiness

## 日本語

`NODE_ENV=production`ではKOMYAKUが起動前に設定を検証する。最低限、`SERVER_HOST`、Production PostgreSQL URL、HTTPS Object Storage、BucketとCredential、32文字以上の固有`IDEMPOTENCY_SECRET`、HTTPSのみの`CORS_ORIGINS`、`AI_TRAINING_DEFAULT=deny`を明示する。開発用CredentialやLocal Endpointは拒否される。

認証Routeを有効にする場合は、32文字以上の`AUTH_RATE_LIMIT_SECRET`、HTTPSの`PUBLIC_APP_ORIGIN`、完全なSMTP設定も必要になる。本番Secretを`.env`やRepositoryへCommitせず、Secret Managerから注入する。

LogはJSON Linesで出力される。Path、本文、Token、Password、Email等は記録しない。`LOG_LEVEL=info`を通常値とし、Debugは機密性と容量を評価した限定環境だけで使用する。Deploy前に`bun run db:migrate`、`bun test`、`bun run check`、`bun run build`、`cargo check`、Backup/Restore手順を確認する。

## English

With `NODE_ENV=production`, KOMYAKU validates configuration before startup. Explicitly provide the bind host, a production PostgreSQL URL, an HTTPS object-storage endpoint, bucket credentials, a unique idempotency secret of at least 32 characters, HTTPS-only CORS origins, and `AI_TRAINING_DEFAULT=deny`. Local endpoints and development credentials are rejected.

Enabling authentication additionally requires a strong rate-limit secret, an HTTPS public application origin, and complete SMTP configuration. Inject production secrets through a secret manager; never commit them. Logs are JSON Lines and exclude paths, authored bodies, tokens, passwords, and email fields. Use `LOG_LEVEL=info` normally. Before deployment, run migrations, all tests/checks/builds, Rust checks, and verify backup and restore procedures.

## 简体中文

当`NODE_ENV=production`时，KOMYAKU 会在启动前验证配置。必须明确提供监听地址、生产 PostgreSQL URL、HTTPS 对象存储、Bucket 凭据、至少 32 个字符的独立 Idempotency Secret、仅 HTTPS 的 CORS Origin，并设置`AI_TRAINING_DEFAULT=deny`。本地 Endpoint 和开发凭据会被拒绝。

启用认证时还需要强 Rate-limit Secret、HTTPS Public App Origin 和完整 SMTP 配置。生产 Secret 应由 Secret Manager 注入，禁止提交到仓库。日志采用 JSON Lines，并排除路径、正文、Token、Password 和 Email 字段。通常使用`LOG_LEVEL=info`。部署前应执行 Migration、全部测试与 Build、Rust 检查，并验证备份恢复流程。
