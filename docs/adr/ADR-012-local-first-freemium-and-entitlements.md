# ADR-012: Local-first FreemiumとEntitlement設計

- Status: Accepted
- Date: 2026-08-13

## Context

KOMYAKUは長期間使うほどVersion履歴の価値が増える。Version数を厳しく制限すると中心価値を損ない、無料UserをCloudへ強制すると運営CostとVendor Lock-inへの不安が増える。一方、Cloud Storage、添付、Backup、Bandwidth、AI、Email、Monitoringには継続Costが発生する。

## Decision

- KOMYAKU LocalをAccount不要・無料とし、Device容量の範囲で中核履歴機能を利用可能にする。
- CloudをFree、Personal、Pro、Team、Enterpriseへ分ける。
- 基本Version Graph、Diff、Branch、Restore、基本Exportを無料Coreに含める。
- 主要QuotaをVersion数ではなくCloud Storage容量にする。
- 初期容量仮説をFree 1GB、Personal 50GB、Pro 200GBとする。
- 広告モデルを採用せず、Document本文を広告Targetingへ利用しない。
- Plan名を機能判定へ直接使わず、安定したEntitlement Keyを解決する。
- Local CoreをCloud Entitlement Serviceから分離する。
- Quota超過、Downgrade、支払い失敗で既存Versionを即時削除しない。
- Privacy、AI学習拒否、基本ExportをPaywallの内側へ置かない。
- Long-term Archive、Team、Enterprise、Developer APIを将来の収益軸として設計する。
- 価格は市場調査前の仮説として扱い、Domain LogicへHard-codeしない。

## Consequences

KOMYAKUの「ユーザーの文章を人質にしない」という思想と収益性を両立しやすい。無料Local UserのServer Costはほぼ発生しない。一方で、LocalとCloudの一貫したUX、Quota Reservation、Usage Reconciliation、Downgrade時の保全、Payment Provider Adapterが必要になる。
