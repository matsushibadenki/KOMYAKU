# ADR-013: Modular Monolithと水平分散への準備

- Status: Accepted
- Date: 2026-08-13

## Context

初期のKOMYAKUは単一Serverで十分だが、Document、Version、Asset、Diff、Export、Search、AI、Billingが増えると、APIとBackground Jobを複数Processおよび複数Serverへ分散する必要がある。初期からMicroservice化すると運用Complexityが過大になる一方、Process MemoryやLocal Filesystemへ依存すると後から水平分散しにくい。

## Decision

- 初期は単一DeployableのModular Monolithとする。
- APIをStatelessにし、Session、Job、Idempotency、Usage等の永続状態を共有Storeへ置く。
- SnapshotとAssetの正本をS3-compatible Object Storageへ置く。
- 初期非同期処理はPostgreSQL Transactional OutboxとSingle Process Workerを利用する。
- Queue、Worker、SchedulerをInterface境界で分離し、将来外部Brokerと複数Workerへ交換可能にする。
- Jobはat-least-once deliveryとIdempotent Handlerを前提にする。
- `document_id`または`workspace_id`をPartition Keyとして使用する。
- Liveness、Readiness、Graceful Shutdownを初期Serverから実装する。
- Database MigrationはExpand / Migrate / Contract方式とする。
- Multi-region Active-Activeは別ADRなしに導入しない。

## Consequences

初期運用を単純に保ちながら、API Replica、Worker Replica、Queue、Read Replicaへ段階的に移行できる。一方で、単体運用時からIdempotency、Outbox、Lease、Repository境界を守る必要があり、Memoryだけで済む実装より初期Code量は増える。
