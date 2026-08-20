# Operator Maintenance

## 日本語

Dead Letter一覧は読み取り専用で取得できる。

```sh
bun run --filter @komyaku/server jobs:dead-letters list --limit 50
```

`nextCursor`がある場合は`--cursor`へ渡す。Payloadや本文は表示されない。RetryはDependency復旧と原因確認後、正確なJobだけに実行する。

```sh
OPERATOR_ID=operator@example.com bun run --filter @komyaku/server jobs:dead-letters retry JOB_UUID --reason "Storage restored" --additional-attempts 3
```

Retentionは必ずDry-runから始める。

```sh
bun run --filter @komyaku/server maintenance:retention
```

削除を適用するには`--apply`に加えてOperatorと理由が必要になる。

```sh
OPERATOR_ID=operator@example.com RETENTION_REASON="Approved scheduled retention" \
  bun run --filter @komyaku/server maintenance:retention --apply
```

未解決のFailed / Dead Letter JobはRetentionで削除されない。Databaseを直接更新してRetryや削除を行わない。

Assetの孤立Object走査、参照ゼロ隔離、期限到来後のGCは`docs/guides/asset-lifecycle-maintenance.md`に従う。未知Objectの初回発見では削除されない。本番の定期Purgeは、公開Version、Archive、法的保持、Backup/Restore Policyを接続するまで無効のままにする。

AssetのFormat検査と認証済みDownloadは`docs/guides/asset-inspection-and-delivery.md`に従う。Baseline検査をAntivirusの代替として扱わない。

## English

Use `jobs:dead-letters list` for payload-free, cursor-paginated inspection. Retry only an exact reviewed job with `OPERATOR_ID`, `--reason`, and bounded additional attempts. Run `maintenance:retention` without flags first; it is dry-run by default. Applying deletion requires `--apply`, `OPERATOR_ID`, and `RETENTION_REASON`. Unresolved failed and dead-letter jobs are never removed automatically. Do not bypass these controls with direct database updates.

Follow `docs/guides/asset-lifecycle-maintenance.md` for orphan reconciliation, reference-zero quarantine, and expired GC. Discovery never deletes an unknown object. Keep scheduled production purge disabled until publication, archive, legal-hold, and backup/restore policies are connected.

Follow `docs/guides/asset-inspection-and-delivery.md` for format inspection and authenticated downloads. Do not treat the baseline inspection as antivirus.

## 简体中文

使用`jobs:dead-letters list`查看不包含 Payload 的游标分页列表。仅在确认原因后，提供`OPERATOR_ID`、`--reason`和有限附加次数来重试准确 Job。先运行不带参数的`maintenance:retention`，其默认仅为 Dry-run。实际删除必须同时提供`--apply`、`OPERATOR_ID`和`RETENTION_REASON`。未解决的 Failed / Dead Letter Job 不会自动删除。禁止绕过这些控制直接修改数据库。

孤立对象扫描、零引用隔离和到期GC必须遵循`docs/guides/asset-lifecycle-maintenance.md`。首次发现未知对象时绝不删除。在发布版本、归档、法律保留以及备份恢复策略接入前，生产环境的定时Purge必须保持禁用。

Asset格式检查与认证下载必须遵循`docs/guides/asset-inspection-and-delivery.md`。不得将Baseline检查视为杀毒方案。
