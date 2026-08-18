# ADR-026: Controlled Operator CLI and Retention

- Status: Accepted
- Date: 2026-08-18

## Decision

- Operator Roleを持つPublic APIが完成するまでは、Database Credentialを持つ管理環境のCLIだけを提供する。
- Dead Letter一覧はPayloadを返さず、最大100件、Opaque CursorでPaginationする。
- Retryは正確なJob UUID、`OPERATOR_ID`、理由、追加試行数を必須とし、Auditと同一Transactionで行う。
- Retention CLIは既定をDry-runとし、`--apply`、`OPERATOR_ID`、`RETENTION_REASON`を全て指定した場合だけ削除する。
- Expired Idempotency Key、90日超のCompleted JobとAttempt、7年超のOperator Auditを既定候補とする。
- Failed / Dead Letter Jobは自動削除しない。
- Retention Apply自体もOperator Auditへ記録する。

## Consequences

管理Endpointを無認証で露出せずに初期運用できる。削除候補を事前確認でき、未解決障害の証拠を保持する。将来のOperator APIは同じServiceとAudit規則を利用する。
