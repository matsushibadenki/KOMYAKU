# ADR-020: PostgreSQL Outbox Dispatcher

- Status: Accepted
- Date: 2026-08-18

## Context

KOMYAKUはBusiness Transactionと同じTransactionで`outbox_events`を作成しているが、Commit済みEventをDurable Jobへ配送する処理が未実装だった。単体Serverから複数API / Workerへ移行した場合も、Process MemoryやSticky Sessionへ依存せず、同じEventを安全に配送する必要がある。

## Decision

- 初期DispatcherはPostgreSQLを正本とする。
- `single`と`worker` Deployment ModeでDispatcherを起動し、`api` Modeでは起動しない。
- Claimは`FOR UPDATE SKIP LOCKED`を使い、期限付きLease Ownerを記録する。
- Crash等で`processing`のままLeaseが失効したEventは別Workerが再取得できる。
- Outbox EventからJobを作成し、Outboxを`published`へ変更する処理は同じPostgreSQL Transactionで行う。
- JobのIdempotency Keyは`outbox:<event_id>`とし、Unique Constraintで重複Jobを防ぐ。
- 一時的な失敗は指数Backoffで再試行し、最大試行回数を超えたEventは`failed`へ移す。
- LogへEvent Payloadを出さず、Event ID、Error Name、再試行可否だけを記録する。
- Job PayloadへDocument本文を直接含めない。既存Domain Eventと同様にResource IDと最小Metadataだけを使う。
- Email Verification / Password ResetのRaw TokenはOutboxやJobへ保存しない。通知のDurable化は暗号鍵管理と再発行Policyを含む別Decisionで扱う。

## Configuration

```text
JOB_BACKEND=postgres-outbox
OUTBOX_BATCH_SIZE=25
OUTBOX_LEASE_SECONDS=30
OUTBOX_POLL_INTERVAL_MS=1000
OUTBOX_MAX_ATTEMPTS=10
```

Lease時間は通常のOutbox-to-Job Transactionより十分長くする。Batch SizeやPoll間隔を増減する前に、Database Load、Queue遅延、Lease失効数を計測する。

## Consequences

初期の単体ServerでもDurable Workを失わず、後からAPIとWorkerを別Processへ分離できる。配送保証はAt-least-onceだが、Job作成はDatabase Constraintで冪等になる。Jobを実際に実行するHandler、Dead-letter運用、Admin再送、外部Mutation用Idempotency Middlewareは後続工程で実装する。
