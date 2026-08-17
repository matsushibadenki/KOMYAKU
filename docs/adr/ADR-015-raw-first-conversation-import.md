# ADR-015: Raw-first Conversation Import

- Status: Accepted
- Date: 2026-08-14

## Context

Provider Export形式は予告なく変わり得る。Canonical Parserだけを信頼すると、未知Field、Branch、Attachment参照、Timestampなどを変換時に失い、後から新しいParserで復元できない。反対に、Database TransactionとObject Storage Writeを一つのAtomic Transactionにはできない。

## Decision

- UserのWorkspace Import権限をObject Write前に必ず検証する。
- 入力の正確なByte列を、Import IDだけから構成したKeyへImmutable保存する。
- Raw SourceのSHA-256をAsset、Import Provenance、Canonical Messageへ関連付ける。
- Parse成功時はAsset Metadata、Conversation DAG、Import Record、Outbox Eventを一つのPostgreSQL TransactionでCommitする。
- Parse失敗時もAsset Metadataと`failed` Import Recordを保存する。
- Object Write後のDatabase障害で生じる孤立Objectは、削除ではなくReconciliation対象とする。
- Importした本文はUntrusted Dataであり、内部命令として実行しない。
- 公開HTTP RouteはIdentityとAuthorizationが完成するまで追加しない。

## Consequences

Parser更新後に原本から再Importでき、監査時にCanonical Dataと原本Hashを照合できる。Object StorageとPostgreSQL間の完全なAtomicityは得られないため、孤立Objectの検出JobとRetention Policyが必要になる。
