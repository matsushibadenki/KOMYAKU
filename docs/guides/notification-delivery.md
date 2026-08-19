# Notification Delivery Operations

## 日本語

Email VerificationとPassword Resetは、One-time Tokenと暗号化通知Eventを同一PostgreSQL Transactionで保存する。Workerは`notification.delivery_requested` Jobを取得し、AES-256-GCM Envelopeを復号し、Tokenが現在も有効であることをDBで確認してからSMTPへ送る。

単体Serverでは次を設定する。

```text
DEPLOYMENT_MODE=single
AUTH_ROUTES_ENABLED=true
NOTIFICATION_WORKER_ENABLED=true
NOTIFICATION_ENCRYPTION_KEY=<64 hexadecimal characters from Secret Manager>
PUBLIC_APP_ORIGIN=https://app.example.com
SMTP_*=...
PASSWORD_RESET_MIN_RESPONSE_MS=250
```

API／Worker分離時は、APIで`AUTH_ROUTES_ENABLED=true`、`NOTIFICATION_WORKER_ENABLED=false`とし、Workerでは逆に設定できる。両Processへ同じ`NOTIFICATION_ENCRYPTION_KEY`を安全に注入する。WorkerだけがSMTP Credentialを必要とする。

配送はat-least-onceであり、SMTP受理直後のProcess障害では同じLinkのMailが重複する可能性がある。Token自体はSingle-useである。Queueに未処理通知がある状態で暗号鍵を交換しない。Dead Letter確認は`jobs:dead-letters list`を使用し、Payloadは表示されない。再実行時はTokenが失効・置換済みなら安全にPermanent Failureとなる。

## English

Email verification and password reset persist the one-time token and encrypted notification Event in one PostgreSQL transaction. A Worker opens the AES-256-GCM envelope, confirms that the token is still active, and then sends it through SMTP. In single mode, enable both public authentication routes and the notification Worker. Split deployments can queue from API replicas and deliver from Worker replicas; inject the same encryption key into both, but keep SMTP credentials on Workers only.

Delivery is at-least-once, so a transport acceptance followed by a Worker crash can produce a duplicate email. The link remains single-use. Do not rotate the first-version key while encrypted Events or Jobs are pending. Use the payload-free Dead Letter CLI for inspection and audited retry.

## 简体中文

邮箱验证与密码重置会在同一个PostgreSQL事务中保存一次性Token及加密通知Event。Worker解密AES-256-GCM Envelope，确认Token仍然有效后再通过SMTP发送。单服务器模式应同时启用认证路由和通知Worker；拆分部署时，API负责排队，Worker负责发送。两者必须安全注入相同的加密密钥，SMTP凭据只需配置在Worker。

配送采用at-least-once语义，SMTP接受邮件后若Worker立即崩溃，可能产生重复邮件，但链接仍为一次性。存在待处理Event或Job时不要轮换第一版密钥。请通过不显示Payload的Dead Letter CLI进行检查和审计重试。
