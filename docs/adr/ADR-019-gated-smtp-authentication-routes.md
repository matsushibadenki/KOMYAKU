# ADR-019: Gated SMTP Authentication Routes

- Status: Accepted
- Date: 2026-08-18
- Delivery update: Superseded in part by ADR-029 on 2026-08-19

## Context

Identity Domain、Hash化Session、Email Verification、Password Reset、PostgreSQL共有Rate Limitは実装済みだが、公開HTTP Routeと実配送Adapterは意図的に保留していた。認証Endpointを公開するには、誤設定、Credential漏えい、Account Enumeration、巨大Request、Proxy Header偽装、SMTP経由のLocal/Remote File参照を防ぐ必要がある。

## Decision

- 配送Providerを固定せず、標準SMTPをNotification Adapterの最初の実装とする。
- `AUTH_ROUTES_ENABLED`の既定値を`false`とし、無効時は認証Route自体をMountしない。
- 有効化には32文字以上の`AUTH_RATE_LIMIT_SECRET`、`PUBLIC_APP_ORIGIN`、完全なSMTP設定を必須とする。
- Server起動時にSMTP `verify()`を実行し、接続または認証に失敗した場合は認証Routeを公開せずProcessを起動失敗とする。
- SMTP TransportはPoolingを使い、TLS 1.2以上、`disableFileAccess`、`disableUrlAccess`を設定する。LoggerとDebug出力は無効にする。
- Port 465では`SMTP_SECURE=true`を使用する。Port 587では通常`SMTP_SECURE=false`と`SMTP_REQUIRE_TLS=true`でSTARTTLSを必須にする。
- Email本文は日本語、英語、简体中文を提供する。本文へDocumentや会話内容を含めず、必要な一回限りToken Linkだけを含める。
- 認証Responseは`Cache-Control: no-store`とし、Request Bodyは16 KiBに制限する。
- Rate LimitをArgon2 Password検証や通知配送より先に評価する。
- Password Reset要求はAccountの存在に関係なく同じ`202 { accepted: true }`を返す。
- `TRUSTED_PROXY_HOPS=0`では`X-Forwarded-For`を無視してSocketのRemote Addressを使う。値を1以上にするのは、管理下Proxyが受信Headerを上書きする構成を確認した場合だけとする。
- Raw Session Token、Verification Token、Reset Token、SMTP PasswordをApplication Logへ出力しない。

## Public route surface

Feature Flag有効時のみ、次を`/api/v1/auth`へMountする。

```text
POST /register
POST /login
GET  /session
POST /logout
POST /logout-all
POST /email-verification/request
POST /email-verification/confirm
POST /password-reset/request
POST /password-reset/confirm
```

## Consequences

初期の同期配送方針はADR-029で置き換えられた。現在は暗号化Transactional Notification OutboxとDurable Jobを使用し、APIは`pending`を返す。外部Security ReviewとProduction-like負荷試験は引き続きProduction公開前の必須条件である。
