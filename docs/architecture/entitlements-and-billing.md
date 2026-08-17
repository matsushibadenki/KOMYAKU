# Entitlement・Quota・Billing Architecture

## 1. Design Goals

- Local CoreをCloud Billingから分離する。
- Plan名ではなくEntitlement Keyで機能を判断する。
- BackendをCloud権限とQuotaの最終Authorityにする。
- Payment Providerを交換可能にする。
- Usageを監査可能かつ冪等に計測する。
- Downgradeや支払い失敗でDocumentを失わせない。

## 2. Domain境界

```text
Plan Catalog
    Planと標準Entitlement
        │
        ▼
Subscription Service ◀── Billing Provider Adapter
        │
        ▼
Entitlement Resolver
        │
        ├── Feature authorization
        └── Numeric limits
                  │
                  ▼
             Usage Meter
                  │
                  ▼
             Quota Decision
```

Route HandlerからPayment Provider APIを直接呼び出さない。

## 3. Entity

### plans

```text
id
code
display_name_key
status
created_at
updated_at
```

### plan_entitlements

```text
plan_id
entitlement_key
value_type
boolean_value
numeric_value
string_value
effective_from
effective_until
```

### billing_customers

```text
workspace_id
provider
provider_customer_id
created_at
updated_at
```

### subscriptions

```text
workspace_id
plan_id
provider_subscription_id
status
current_period_start
current_period_end
grace_until
cancel_at_period_end
created_at
updated_at
```

Subscription status例：

```text
active
trialing
past_due
grace
canceled
```

### workspace_usage

```text
workspace_id
metric_key
quantity
measured_at
calculation_version
```

### usage_ledger

```text
id
workspace_id
metric_key
delta
idempotency_key
resource_type
resource_id
occurred_at
recorded_at
```

`idempotency_key`をUniqueにしてRetryで二重計上しない。本文内容はUsage Ledgerへ保存しない。

## 4. Entitlement Resolution

Entitlementは以下の優先順位で解決する。

```text
Enterprise contract override
 ↓
Workspace override
 ↓
Active subscription plan
 ↓
Free Cloud defaults
```

Local Coreはこの解決処理を通さない。

Boolean機能とNumeric limitを分離する。

```text
can("git.sync") -> boolean
limit("storage.cloud_bytes") -> integer
remaining("ai.monthly_credits") -> integer
```

Conversation機能では、Local Import・基本管理・Exportを無料Core候補とし、CloudまたはManaged処理を個別Entitlementにする。

```text
conversation.import.local
conversation.import.cloud
conversation.export
ai.handoff.byok
ai.handoff.managed
ai.connection.personal
ai.connection.workspace
ai.monthly_credits
```

BYOKのProvider利用料はUserとProvider間で発生し得るため、KOMYAKUのSubscription表示と混同しない。Managed AIは送信前にKOMYAKU側の推定Credit消費を表示する。

## 5. Write Flow with Quota

```text
Authenticate
 ↓
Check Workspace permission
 ↓
Resolve entitlement
 ↓
Reserve estimated usage
 ↓
Write immutable object
 ↓
Finalize actual usage in ledger
 ↓
Create metadata transaction
 ↓
Release or adjust reservation
```

Usage reservationとVersion作成のFailure処理を設け、失敗したUploadを課金しない。Object Storageの孤立ObjectはReconciliation Jobで検出する。

## 6. Quota Decision

```text
within_limit
near_limit
write_blocked
grace
```

`write_blocked`でもRead、Export、Downloadを許可する。ClientはLocal Versionを保存してSync Queueへ残し、容量が回復したら同期する。

## 7. Billing Provider Boundary

Provider Adapterが担当するもの：

- Customer作成
- Checkout Session
- Subscription変更
- Invoice状態
- Webhook署名検証
- Refund / Credit情報

Domain Serviceが担当するもの：

- KOMYAKU PlanへのMapping
- Entitlement解決
- Grace Period
- Quota Policy
- Audit Log
- Userへの状態表示

Webhookは署名検証し、Event IDで冪等処理する。Webhookだけを唯一のSubscription真実として扱わず、定期Reconciliationを可能にする。

## 8. Security and Privacy

- Frontendだけで有料機能を保護しない。
- Billing LogへDocument titleや本文を出さない。
- AI学習拒否と基本ExportはPlanに関係なく利用可能にする。
- 広告Targetingへ本文を使用しない。
- Payment ProviderへDocument Metadataを送らない。
- Price ID等のProvider固有値をClientのAuthorityにしない。

## 9. Initial API Surface

```text
GET  /api/v1/plans
GET  /api/v1/workspaces/:id/entitlements
GET  /api/v1/workspaces/:id/usage
GET  /api/v1/workspaces/:id/subscription
POST /api/v1/workspaces/:id/billing/checkout
POST /api/v1/workspaces/:id/billing/portal
POST /api/v1/billing/webhooks/:provider
```

PriceとPlan説明はLocale-aware resourceとして返し、UI文字列をBackendへHard-codeしない。
