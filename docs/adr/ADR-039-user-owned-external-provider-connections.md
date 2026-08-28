# ADR-039: User-owned External Provider Connections

- Status: Accepted for future implementation
- Date: 2026-08-28
- Owners: KOMYAKU architecture

## Context

KOMYAKUは、ユーザーの文書と接続先を運営者の資格情報へ過度に集中させない。Google Drive連携では、KOMYAKU運営の共通OAuth Clientだけでなく、ユーザーが自分のGoogle Cloud ProjectとDesktop OAuth Clientを登録するBYO（Bring Your Own）方式を選べることが望ましい。

Googleの現行資料ではNative/Desktop appはPublic Clientであり、端末へ配布されたClient Secretを秘匿情報として信頼できない。Desktop OAuthではPKCEが強く推奨され、Loopback IP Redirectがサポートされている。Drive APIでは`drive.file`がNon-sensitiveなPer-file Scopeとして推奨され、Drive全体へアクセスする`drive`と`drive.readonly`はRestricted Scopeである。

## Decision

### Provider abstraction

Google Drive専用の永続化境界をDocument Domainへ埋め込まず、次のProvider-neutral modelを採用する。

```text
ExternalProviderConnection
├ connection_id
├ owner_type: user | workspace
├ owner_id
├ provider: google | future_provider
├ auth_mode: managed_oauth | byo_oauth_client
├ capability_set: drive_backup | drive_file_exchange | future_capability
├ client_id
├ requested_scopes[]
├ granted_scopes[]
├ secure_token_reference
├ status
├ last_verified_at
└ metadata_schema_version
```

初期BYO実装は`owner_type=user`、`provider=google`、`auth_mode=byo_oauth_client`に限定する。Workspace共有接続、Service Account、API Key、Workload Identity、任意のGCP APIは、それぞれ異なる権限・課金・秘密管理を持つため同じCredential入力欄へ一般化しない。

### Storage roles

外部ProviderをKOMYAKU Cloudの内部Object Storageと混同しない。

```text
Authoritative local document
        │
        ├── KOMYAKU Cloud sync / managed backup
        └── User-owned external target
              └── Google Drive BYO OAuth
```

Google Drive BYOは、`.komyaku` Archive、Export、明示的Backup、またはユーザーが選択したFileの交換先として扱う。Server内部のAsset、Outbox、Job payload、Content-addressed ObjectをGoogle Driveへ直接置き換えない。

### OAuth boundary

- Google Cloud ConsoleでApplication Typeを`Desktop app`として作成したClient IDだけを初期対応する。
- System BrowserでAuthorization Code Flowを開始し、埋め込みWebViewでGoogle Loginを表示しない。
- Authorization RequestごとにPKCE S256のVerifier/Challengeと推測不能な`state`を生成する。
- `127.0.0.1`のEphemeral PortへLoopback Callbackを一時的にBindingする。`localhost`、固定Port、OOB copy/paste、Custom URI Schemeを初期方式にしない。
- CallbackはLoopback Interface、期待したPath、`state`、Single-use、短いTimeoutを検証する。
- Client Secretの入力を要求しない。将来GoogleのExport JSONにClient Secretが含まれても認証強度として信頼せず、既定ではImportしない。
- Access TokenとRefresh TokenはFrontend State、Local Storage、SQLite本文列、Log、Crash Report、Telemetry、`.komyaku` Archiveへ保存しない。
- Long-lived TokenはOS Keychain等のPlatform Secure Storageへ置き、DatabaseにはOpaqueなToken Referenceと非秘密Metadataだけを保存する。
- Disconnect時はGoogle側Revocationを試みた後、成功・失敗にかかわらずLocal Tokenを削除し、再接続を要求する。監査記録へTokenやProvider Error本文を残さない。

### Least privilege

初期Profileは次に限定する。

```text
drive_backup
  scope: https://www.googleapis.com/auth/drive.file
  access: KOMYAKUが作成したFile、またはUserが明示的に開いた/共有したFile
```

`drive`、`drive.readonly`、Drive全体のMetadata Scopeは初期UIから要求しない。将来必要になった場合もCapabilityごとにIncremental Authorizationを行い、Scope差分、利用目的、Google Verification/Organization Policyへの影響を接続前に表示する。

### BYO responsibility and verification

BYO OAuthはGoogleの審査・警告・Quota・組織Policyを自動的に回避する仕組みではない。Personal use、少数の既知User、Testing、Internal use等はGoogleがVerification例外として説明しているが、User cap、Warning、Testing中のRefresh Token lifetime、Workspace Admin制限が適用され得る。

UIとDocumentationは次を明示する。

- Google Cloud Project、OAuth Consent、Test User、Quota、請求、Google PolicyはそのProject Ownerの管理対象である。
- KOMYAKU Subscription料金とGoogle側の料金・Quotaは別である。
- GoogleがConnectionを拒否、失効、停止する可能性があり、KOMYAKUはLocal Documentを失わせず再接続可能な状態にする。
- 「BYOならVerification不要」と断定しない。

### UX modes

将来、同じ画面で次を選択可能にする。

```text
Google Drive connection
├ Standard connection        (KOMYAKU-managed OAuth; available only after review)
└ My Google Cloud Project    (user-owned Desktop OAuth Client)
```

BYO Wizardは英語、日本語、简体中文で、Project作成、Drive API有効化、Consent設定、Desktop Client作成、Client ID形式検証、Scope Preview、Browser接続、接続試験、切断まで案内する。Project IDは表示・Troubleshooting用の任意Metadataであり、OAuth AuthorizationにはClient IDを使う。

### Visibility and sharing

KOMYAKUの`private`、`restricted`、`unlisted`、`public`とGoogle Drive ACLを自動対応させない。初期ConnectorはDrive Permissions APIを呼ばず、`anyone` Link、Domain共有、User招待を作成しない。外部Export前に対象Google Account、File名、機密性、送信Byte数を表示し、Userの明示確認を要求する。

Google DriveへExportしたCopyの共有・Retention・AI利用・組織PolicyはGoogle側の設定に従い、KOMYAKUのAI学習拒否HeaderやVisibility Policyが外部Copyへ強制適用されるとは表示しない。

### Entitlement and cost boundary

User-owned BYO接続の保存ByteをKOMYAKU Cloud Storage Usageへ計上しない。Google側API、Storage、Network、Quota、BillingはUserとGoogleの間にある。BYO Personal ConnectorはLocal Coreまたは実質的な低コスト機能の候補とし、KOMYAKU-managed OAuth、Server-side scheduled backup、Team共有接続、Managed monitoringは別Entitlementとして判断する。

## Consequences

- KOMYAKU運営のOAuth資格情報に全Userを集中させない選択肢を提供できる。
- Power User、研究室、企業、OSS/Local-first利用と相性が良い。
- 一般UserにはGCP設定が難しいため、BYOだけを唯一の接続方式にしない。
- Google Policy変更をConnector内へ閉じ込め、Document、Version、Asset Domainへの影響を抑えられる。
- Token Security、OAuth Callback、Revocation、Provider Error、Quotaの追加TestとSecurity Reviewが実装条件になる。

## Rejected alternatives

- 全Userで1つの埋め込みClient Secretを秘密として扱う：Desktop appではSecretを秘匿できない。
- Google LoginをTauri WebViewへ埋め込む：System Browserを使用するGoogle OAuth PolicyとPhishing耐性に反する。
- 初期接続で`drive`を要求する：機能に対して過剰権限である。
- Service Account JSON、API Key、OAuth Clientを1つの汎用JSON欄へ貼らせる：秘密種別とThreat Modelが異なり、誤送信・Log漏洩・過剰権限を招く。
- Google DriveをKOMYAKU内部Object StorageのDrop-in replacementにする：Transaction、Inspection、Lifecycle、Quota、Shared Workspace semanticsが一致しない。

## Official references

- [OAuth 2.0 for iOS & Desktop apps](https://developers.google.com/identity/protocols/oauth2/native-app)
- [OAuth 2.0 best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices)
- [Manage OAuth clients](https://support.google.com/cloud/answer/15549257?hl=en)
- [Choose Google Drive API scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Sensitive scope verification and exceptions](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Google OAuth 2.0 policies](https://developers.google.com/identity/protocols/oauth2/policies)

## Multilingual summary

- 日本語：User所有のGoogle Cloud ProjectとDesktop OAuth Clientを使えるProvider-neutralな接続境界を設け、Tokenは端末のSecure Storageへ、既定Scopeは`drive.file`とする。
- English: Add a provider-neutral connection boundary for user-owned Google Cloud projects and Desktop OAuth clients; keep tokens in platform secure storage and default to `drive.file`.
- 简体中文：建立Provider-neutral连接边界以支持用户自有Google Cloud Project和Desktop OAuth Client；Token保存在平台安全存储中，默认仅请求`drive.file`。
