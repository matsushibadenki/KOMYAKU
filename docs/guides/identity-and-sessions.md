# Identity and Sessions

## 日本語

### 現在実装されている基盤

- User、Personal Workspace、Owner Membership、初回Session、Outbox Eventの原子的作成
- Email＋Password認証
- Argon2id Password Hash
- 256 bit Session TokenとHashのみのDB保存
- Session認証、単一Device Logout、全Device Logout
- Workspace Roleによる会話Import認可
- PostgreSQL共有Rate Limit
- Email確認とPassword Reset用の一回限りToken
- SMTPによる三言語のEmail通知
- Feature Flagで保護されたPublic Authentication Route
- 日本語、英語、简体中文のInterface Locale

Passwordは15〜1024 Unicode文字を受け付け、空白や日本語を利用できる。大文字・数字・記号の組み合わせは強制しない。PasswordをTrimまたはUnicode正規化しないため、登録時とLogin時には完全に同じ文字列が必要になる。

Session有効期間の既定は30日で、Server設定は次の環境変数で変更できる。

```text
SESSION_TTL_SECONDS=2592000
```

Session Tokenは発行Responseで一度だけ取得できる。Database、Application Log、通常のAudit Payloadには平文Tokenを保存しない。

Email確認Tokenは既定24時間、Password Reset Tokenは既定1時間有効。一回使用するか再発行すると、以前のTokenは無効になる。Password Reset成功時は漏えいした可能性のある全Sessionを失効させる。Email未確認のAccountは会話Importなどの機密Workspace操作を実行できない。

Rate Limit Keyは次のSecretでHMAC化する。Productionでは十分に長いランダム値をSecret Storeから設定し、Repositoryへ原文EmailやNetwork Addressを保存しない。

```text
AUTH_RATE_LIMIT_SECRET=replace-with-a-random-production-secret
```

### Public Authentication Routeの有効化

Public Routeは実装済みだが、誤って公開しないよう既定ではMountされない。ProductionではSecret Managerから値を注入し、次を全て設定する。

```text
AUTH_ROUTES_ENABLED=true
AUTH_RATE_LIMIT_SECRET=<32文字以上のランダム値>
PUBLIC_APP_ORIGIN=https://app.example.com
TRUSTED_PROXY_HOPS=0
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=<provider user>
SMTP_PASSWORD=<provider password>
SMTP_FROM=KOMYAKU <no-reply@example.com>
```

Port 465を使うProviderでは`SMTP_SECURE=true`にする。Port 587では上記のSTARTTLS構成を使う。Serverは起動時にSMTP接続と認証を検証し、失敗時は起動しない。

`TRUSTED_PROXY_HOPS=0`では偽装可能な`X-Forwarded-For`を無視する。Load BalancerやReverse Proxyを使う場合、受信した同HeaderをProxyが必ず上書きすることを確認してから、APIまでの信頼できるHop数を設定する。推測で設定してはならない。

公開されるPathは`/api/v1/auth`配下のRegister、Login、Session、Logout、Email Verification、Password Resetである。認証ResponseはCache禁止、Bodyは16 KiBまで。Password Reset要求はAccountの有無を公開しない。現時点ではEmail配送を同期実行するため、次段階で配送照合と負荷・Security Auditを行う。

## English

The foundation atomically creates a user, personal workspace, owner membership, initial session, and outbox event. Passwords use Argon2id. Sessions and one-time verification/reset credentials use 256-bit random tokens; only SHA-256 hashes are stored. PostgreSQL serializes rate-limit attempts across API replicas, with identifiers protected by a secret HMAC. Password reset revokes every existing session.

SMTP email and rate-limited HTTP authentication routes are implemented but disabled by default. Enabling them requires `AUTH_ROUTES_ENABLED=true`, a secret of at least 32 characters, the public application origin, and complete SMTP settings. Startup verifies the SMTP connection. Keep `TRUSTED_PROXY_HOPS=0` unless a controlled proxy overwrites forwarding headers; then set the exact trusted hop count. Port 465 normally uses implicit TLS, while port 587 uses STARTTLS with `SMTP_REQUIRE_TLS=true`. Complete delivery reconciliation, load testing, and an external security review before declaring production readiness.

## 简体中文

当前基础会以单个事务创建用户、个人工作区、所有者成员关系、初始会话和 Outbox 事件。密码使用 Argon2id。会话、邮箱验证和密码重置均使用 256 位随机 Token，数据库只保存 SHA-256 哈希。PostgreSQL 会在多个 API 副本之间统一执行限流，并用带密钥的 HMAC 隐藏邮箱和网络标识。密码重置成功后会撤销全部现有会话。

SMTP 邮件和限流的 HTTP 认证接口已经实现，但默认关闭。启用时必须设置 `AUTH_ROUTES_ENABLED=true`、至少 32 个字符的随机密钥、公开应用来源和完整 SMTP 配置；服务器会在启动时验证 SMTP 连接。除非受控代理会覆盖转发头，否则保持 `TRUSTED_PROXY_HOPS=0`。使用 465 端口时通常启用隐式 TLS；使用 587 端口时应设置 `SMTP_REQUIRE_TLS=true` 以强制 STARTTLS。正式上线前仍需完成投递核对、压力测试和外部安全审查。
