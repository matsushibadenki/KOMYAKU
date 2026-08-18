# ADR-025: Provider-independent Plan Catalog Package

- Status: Accepted
- Date: 2026-08-18

## Decision

- Plan Catalogを`@komyaku/entitlements`へ置き、Payment Providerから独立させる。
- Catalog Version、安定したEntitlement Key、Local / Free / Personal / Pro / Team / EnterpriseのDefault値を提供する。
- Local Document、Local Version Graph、Basic Diff、Branch、Basic Exportは全Planで有効にする。
- Version数ではなくCloud Storage Byte数を主な容量Limitにする。
- Resolution順はPlan Default、Subscription Override、Workspace Override、Enterprise Contract Overrideとする。
- Boolean FeatureとNumeric Limitを型で区別し、`can()`、`limit()`、`value()`で参照する。
- Price、Currency、Tax、Provider Price IDをCatalogへ含めない。

## Consequences

Stripe等のProviderを選ぶ前にBackendとFrontendが同じ安定Keyを利用できる。価格改定とFeature Authorityを分離できる。Catalog値は現時点のProduct仮説であり、Market調査後にCatalog Versionを更新できる。
