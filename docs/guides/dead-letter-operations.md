# Dead-letter Operations

## 日本語

Dead Letter管理のRepositoryとServiceは実装済みだが、管理者認可が完成するまでHTTP Endpointは公開しない。再投入にはJob UUID、Operator ID、1〜1,000文字の理由、1〜10の追加試行数が必要になる。操作はJobを`queued`へ戻し、既存Attemptを消さずに上限を増やし、同じTransactionで`operator_audit_events`へ記録する。

PayloadやDocument本文は一覧へ出さない。原因を調査せずに一括再投入しない。Storage障害など外部Dependencyを復旧し、Job Typeと安全なError Codeを確認してから、正確なJobだけを再投入する。現時点ではApplication Serviceを内部Operator Toolから呼ぶための基盤であり、Databaseを直接更新する運用は許可しない。

## English

The dead-letter repository and service are implemented, but no HTTP endpoint is exposed until operator authorization exists. A retry requires the exact job UUID, an operator identity, a reason between 1 and 1,000 characters, and one to ten additional attempts. The transaction requeues the job, preserves prior attempts, increases the attempt ceiling, and writes an `operator_audit_events` record atomically.

Listings exclude payload and document content. Do not bulk-retry jobs without diagnosing the cause. Restore external dependencies, inspect the job type and safe error code, then retry only the intended job. This is currently an internal service boundary for a future authenticated operator tool; direct database updates are not an accepted procedure.

## 简体中文

Dead Letter Repository 和 Service 已实现，但在管理员授权模型完成前不会开放 HTTP 接口。重新投入必须提供准确的 Job UUID、操作员身份、1 至 1,000 个字符的原因，以及 1 至 10 次附加尝试。该事务会把 Job 恢复为`queued`、保留既有 Attempt、增加最大尝试次数，并原子写入`operator_audit_events`。

列表不会返回 Payload 或文档正文。不要在未查明原因时批量重试。应先恢复外部依赖，确认 Job Type 和安全 Error Code，再只重新投入目标 Job。目前这是供未来认证操作员工具调用的内部 Service 边界，不允许通过直接修改数据库来操作。
