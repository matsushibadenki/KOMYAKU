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

## English

Use `jobs:dead-letters list` for payload-free, cursor-paginated inspection. Retry only an exact reviewed job with `OPERATOR_ID`, `--reason`, and bounded additional attempts. Run `maintenance:retention` without flags first; it is dry-run by default. Applying deletion requires `--apply`, `OPERATOR_ID`, and `RETENTION_REASON`. Unresolved failed and dead-letter jobs are never removed automatically. Do not bypass these controls with direct database updates.

## 简体中文

使用`jobs:dead-letters list`查看不包含 Payload 的游标分页列表。仅在确认原因后，提供`OPERATOR_ID`、`--reason`和有限附加次数来重试准确 Job。先运行不带参数的`maintenance:retention`，其默认仅为 Dry-run。实际删除必须同时提供`--apply`、`OPERATOR_ID`和`RETENTION_REASON`。未解决的 Failed / Dead Letter Job 不会自动删除。禁止绕过这些控制直接修改数据库。
