# ADR-022: Mutation Idempotency and Audited Dead-letter Operations

- Status: Accepted
- Date: 2026-08-18

## Context

Network RetryやClient再送により、同じMutationが複数回実行される可能性がある。また、永久失敗または試行上限へ達したJobを再投入する操作は強い権限を必要とし、誰がなぜ実行したかを残さなければならない。

## Decision

- Mutation Idempotencyの正本は既存`idempotency_keys` Tableとする。
- `Idempotency-Key`原文を保存せず、Operation Scopeと結合してHMAC-SHA-256化する。
- Requestは正規化せず、受信した完全なByte列をSHA-256化する。同じKeyで異なるRequest Hashを受けた場合は拒否する。
- 同じKeyの処理中Requestには`idempotency_in_progress`、完了済みRequestには保存済みStatusとResource Referenceを返す。
- Response BodyやSession TokenをIdempotency Tableへ保存しない。保存するのはStatus Codeと非秘密のResource Referenceだけとする。
- HTTP Middlewareは明示的にMountしたMutationだけへ適用する。RegisterやLoginなど秘密Tokenを返すRouteへ自動適用しない。
- `IDEMPOTENCY_SECRET`は32文字以上とし、ProductionではSecret Managerから注入する。
- Dead Letter一覧にPayload本文を含めず、ID、Type、Partition、Status、Attempt数、時刻だけを返す。
- 再投入は正確なJob ID、Operator ID、理由、追加試行数を必須とする。
- Job再投入と`operator_audit_events`追加を同じPostgreSQL Transactionで行う。
- Attempt履歴を消去せず、`max_attempts`を追加試行数だけ増やす。
- Operator認可モデルが未完成のため、Dead Letter操作をPublic HTTPへ公開しない。RepositoryとService境界のみを実装する。

## Consequences

将来の会話Import、Version作成、Export要求などを安全に再送できる。認証Responseの秘密を永続化する危険を避けられる。Dead Letterは監査なしに再投入できない。次段階ではWorkspaceまたはSystem Operator権限、認証済み管理API/CLI、一覧Pagination、Retentionを追加する。
