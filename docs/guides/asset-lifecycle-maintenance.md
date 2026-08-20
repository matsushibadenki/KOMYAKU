# Asset Lifecycle Maintenance

Status: implemented operator foundation; production scheduling remains disabled

## 日本語

Asset maintenanceは、必ずmigration適用後、専用Operator identityと変更理由を指定して実行する。最初のReconciliationはWorkspace単位でObject Storageを100件ずつ走査する。未知Objectは30日間の隔離候補として記録されるだけで、この操作では削除されない。

```sh
OPERATOR_ID=operator@example.com \
ASSET_MAINTENANCE_REASON="Scheduled orphan reconciliation" \
bun run --filter @komyaku/server maintenance:assets --action reconcile --workspace WORKSPACE_UUID
```

参照ゼロAssetを隔離する。既定では作成から1日以上経過したAssetだけを対象にし、さらに30日の回復期間を設定する。

```sh
OPERATOR_ID=operator@example.com \
ASSET_MAINTENANCE_REASON="Approved reference-zero quarantine" \
bun run --filter @komyaku/server maintenance:assets --action quarantine
```

期限到来済み候補の物理削除は次の明示操作だけで行う。これは取り消せないため、本番では公開Version、Archive、法的保持、Backup/Restore要件を接続するまで定期実行してはならない。

```sh
OPERATOR_ID=operator@example.com \
ASSET_MAINTENANCE_REASON="Approved expired Asset purge" \
bun run --filter @komyaku/server maintenance:assets --action purge
```

調整用環境変数は`ASSET_INACTIVE_DAYS`、`ASSET_QUARANTINE_DAYS`、`ASSET_PURGE_RETRY_MINUTES`、`ASSET_MAINTENANCE_BATCH_SIZE`である。ProviderのError本文はDBやAuditへ保存しない。Objectを手動削除したり、DBのLifecycle stateを直接変更しない。

## English

Run Asset maintenance only after migrations, with a dedicated Operator identity and a reason. Reconciliation scans one Workspace in bounded 100-object pages. It records unknown canonical objects with a 30-day quarantine deadline and never deletes during discovery. Reference-zero quarantine defaults to a one-day inactivity delay plus a 30-day recovery window. Physical deletion requires the explicit `purge` action shown above.

Do not schedule production purge until published-Version, archive, legal-hold, and backup/restore policies are connected. Tune only with `ASSET_INACTIVE_DAYS`, `ASSET_QUARANTINE_DAYS`, `ASSET_PURGE_RETRY_MINUTES`, and `ASSET_MAINTENANCE_BATCH_SIZE`. Never manually delete objects or directly edit lifecycle state.

## 简体中文

Asset 维护只能在完成数据库迁移后运行，并且必须提供专用 Operator 身份和操作原因。Reconciliation 按每页100个对象扫描指定 Workspace；首次发现未知规范对象时只记录30天隔离期，不会立即删除。零引用 Asset 默认先等待1天，再进入30天恢复期。物理删除只能通过上述明确的`purge`操作执行。

在发布版本、归档、法律保留以及备份恢复策略接入前，不得在生产环境定时执行清理。仅使用`ASSET_INACTIVE_DAYS`、`ASSET_QUARANTINE_DAYS`、`ASSET_PURGE_RETRY_MINUTES`和`ASSET_MAINTENANCE_BATCH_SIZE`调整策略。禁止手动删除对象或直接修改生命周期状态。
