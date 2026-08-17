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

### 現時点の公開範囲

Identity Service、PostgreSQL Repository、Bearer Middleware、分散Rate Limit、Email Verification、Password ResetのDomain処理は実装済み。ただしPublic EndpointはまだServerへMountしていない。Production Notification Adapterと秘密情報を除外する監査を完成後に公開する。

## English

The foundation atomically creates a user, personal workspace, owner membership, initial session, and outbox event. Passwords use Argon2id. Sessions and one-time verification/reset credentials use 256-bit random tokens; only SHA-256 hashes are stored. PostgreSQL serializes rate-limit attempts across API replicas, with identifiers protected by a secret HMAC. Password reset revokes every existing session. Public routes remain disabled until a production notification adapter and final audit are ready.

## 简体中文

当前基础会以单个事务创建用户、个人工作区、所有者成员关系、初始会话和 Outbox 事件。密码使用 Argon2id。会话、邮箱验证和密码重置均使用 256 位随机 Token，数据库只保存 SHA-256 哈希。PostgreSQL 会在多个 API 副本之间统一执行限流，并用带密钥的 HMAC 隐藏邮箱和网络标识。密码重置成功后会撤销全部现有会话。生产通知适配器和最终安全审计完成前，不会开放公共认证接口。
