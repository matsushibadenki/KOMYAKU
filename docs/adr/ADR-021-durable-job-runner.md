# ADR-021: Durable Job Runner and Archive Verification

- Status: Accepted
- Date: 2026-08-18

## Context

Outbox DispatcherはDomain Eventを`jobs`へ安全に配送できるが、Jobを実行してAttempt履歴と結果を確定するWorkerが必要である。未知のJob Typeを誤って完了させず、Worker停止、Object Storage障害、破損Metadataを区別する必要がある。

## Decision

- `single`と`worker` ModeでJob Runnerを実行し、`api` Modeでは実行しない。
- RunnerはHandlerが登録されたJob TypeだけをClaimする。未登録Jobは`queued`のまま保持する。
- ClaimにはPostgreSQL Row Lock、`SKIP LOCKED`、期限付きLeaseを使用する。
- 各実行を`job_attempts`へ記録し、成功、再試行、永久失敗を区別する。
- 一時障害は指数Backoffで再試行する。明示的な永久Errorは`failed`、試行上限到達は`dead_letter`へ移す。
- Worker停止でLeaseが切れたAttemptは`lease_expired`として閉じる。最終試行のLease切れは自動的にDead Letterへ移し、`processing`へ残し続けない。
- Error MessageやPayloadを通常Logへ出さず、Job ID、Type、安全なError Code、Outcomeだけを記録する。
- 最初のHandlerとして`conversation.imported`を登録し、Database上のRaw Asset MetadataとObject StorageのContent Length、`content-sha256`を照合する。
- Object Storageへ一時的に接続できない場合は再試行する。Database Record欠落、Size不一致、Hash不一致、不正Payloadは永久失敗とする。
- 検証失敗時にRaw Objectを自動削除または上書きしない。

## Configuration

```text
JOB_BATCH_SIZE=10
JOB_LEASE_SECONDS=60
JOB_POLL_INTERVAL_MS=1000
```

Job Leaseは通常のHandler実行時間より長くする。長時間Jobには将来Heartbeatを追加し、Leaseを無制限に長くしない。

## Consequences

単体ServerでArchive Verificationを実行でき、将来同じHandlerを複数Workerへ水平分散できる。未登録の`identity.personal_account_created` Jobは意図が確定するまでQueueへ保持される。Dead Letterの閲覧・手動再投入、長時間Job Heartbeat、管理者通知は後続工程とする。
