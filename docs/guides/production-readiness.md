# Production Readiness

## 日本語

`NODE_ENV=production`ではKOMYAKUが起動前に設定を検証する。最低限、`SERVER_HOST`、Production PostgreSQL URL、HTTPS Object Storage、BucketとCredential、32文字以上の固有`IDEMPOTENCY_SECRET`、HTTPSのみの`CORS_ORIGINS`、`AI_TRAINING_DEFAULT=deny`を明示する。開発用CredentialやLocal Endpointは拒否される。

認証Routeを有効にする場合は、32文字以上の`AUTH_RATE_LIMIT_SECRET`、HTTPSの`PUBLIC_APP_ORIGIN`、Secret Managerから注入する64桁Hexの`NOTIFICATION_ENCRYPTION_KEY`が必要になる。通知Workerには完全なSMTP設定も必要である。本番Secretを`.env`やRepositoryへCommitしない。API／Worker分離時は両方へ同じ通知暗号鍵を注入し、SMTP CredentialはWorkerだけへ与える。`PASSWORD_RESET_MIN_RESPONSE_MS`はAccount EnumerationのTiming差を抑える防御であり、計測とReviewなしに`0`へしない。

LogはJSON Linesで出力される。Path、本文、Token、Password、Email、通知Envelope等は記録しない。`LOG_LEVEL=info`を通常値とし、Debugは機密性と容量を評価した限定環境だけで使用する。Deploy前に`bun run db:migrate`、`bun test`、`bun run check`、`bun run build`、`cargo check`、負荷試験、Backup/Restore手順を確認する。隔離PostgreSQL／Mailpit Baselineは`docs/testing/auth-production-like-load-baseline.md`に記録済みだが、本番相当TLS／Proxy構成での再試験と独立した外部Security Reviewが終わるまで公開認証をProduction-readyと判定しない。

## English

With `NODE_ENV=production`, KOMYAKU validates configuration before startup. Explicitly provide the bind host, a production PostgreSQL URL, an HTTPS object-storage endpoint, bucket credentials, a unique idempotency secret of at least 32 characters, HTTPS-only CORS origins, and `AI_TRAINING_DEFAULT=deny`. Local endpoints and development credentials are rejected.

Enabling authentication additionally requires a strong rate-limit secret, an HTTPS public application origin, and a 256-bit notification encryption key from a secret manager. Notification Workers also require complete SMTP configuration. API and Worker replicas share the encryption key; only Workers need SMTP credentials. Logs exclude authored content, credentials, recipients, and encrypted notification envelopes. The isolated PostgreSQL/Mailpit baseline is complete, but public authentication is not production-ready until deployment-topology testing and an independent external security review are complete.

## 简体中文

当`NODE_ENV=production`时，KOMYAKU 会在启动前验证配置。必须明确提供监听地址、生产 PostgreSQL URL、HTTPS 对象存储、Bucket 凭据、至少 32 个字符的独立 Idempotency Secret、仅 HTTPS 的 CORS Origin，并设置`AI_TRAINING_DEFAULT=deny`。本地 Endpoint 和开发凭据会被拒绝。

启用认证时还需要强Rate-limit Secret、HTTPS Public App Origin，以及由Secret Manager注入的256位通知加密密钥。通知Worker还需要完整SMTP配置；API与Worker共享加密密钥，但SMTP凭据只提供给Worker。日志不得包含正文、凭据、收件人或通知Envelope。隔离的PostgreSQL／Mailpit基线已经完成，但在部署拓扑测试和独立外部安全审查完成前，不得将公开认证标记为Production-ready。
