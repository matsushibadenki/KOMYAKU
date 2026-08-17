# KOMYAKU 料金戦略とPlan仮説

- Status: Draft for validation
- Updated: 2026-08-13

## 1. 料金思想

> **書くことと履歴を残すことは無料。クラウド、共同作業、高度解析に課金する。**

KOMYAKUは広告を採用しない。本文を広告Targetingへ利用せず、無料Userにも実用的なVersion Graph、Diff、Branch、Restore、Exportを提供する。

無料層を機能しない試用版にしない。長編小説1本や継続的な研究ノートを通常運用できることをFree Cloudの受入基準にする。

## 2. Product Mode

| Mode | 料金 | Account | 保存先 | 中心機能 |
|---|---:|---|---|---|
| KOMYAKU Local | 無料 | 不要 | Local SQLite / Filesystem | Local版履歴、Graph、Diff、Branch、Restore、Export |
| KOMYAKU Cloud | Plan別 | 必要 | Local + Cloud | Sync、Backup、Web、Team、AI、高度解析 |

Local版の中核機能はDevice容量の範囲で無制限とし、Cloud認証障害やSubscription状態で停止させない。

Conversation LogのLocal Import、基本管理、検索、Exportも無料Core候補とする。User自身のAPI KeyまたはLocal Modelを使うAI Handoffは、KOMYAKU側のManaged AI Creditとは分離する。

## 3. 初期Plan仮説

| Plan | 価格仮説 | Storage目安 | 対象 | 主な価値 |
|---|---:|---:|---|---|
| Free Cloud | 無料 | 1GB | 個人の通常利用 | Sync、Web、基本履歴、基本Export |
| Personal | 月額500〜900円 | 50GB | 作家・研究者・個人 | 長期検索、高度Diff、AI補助、高度Export |
| Pro | 月額1,000〜2,000円 | 200GB | Heavy User | 大量Version、高度検索、Git、DOCX/EPUB/PDF、強化Backup |
| Team | 1 User月額1,500〜3,000円 | 検証後決定 | 出版社・研究室・Team | Shared Workspace、Review、Permission、Audit |
| Enterprise | 個別契約 | 個別 | 組織 | SSO/SAML/SCIM、Retention、Compliance、SLA、専用Backup |

価格、容量、AI枠は市場調査と実測原価前の仮説である。税、通貨、地域別価格、年払いDiscount、決済手数料を含む最終価格ではない。

## 4. 課金対象

優先する課金軸：

1. Cloud Storage
2. Team SeatまたはWorkspace
3. AI API Usage
4. 高度履歴検索とSemantic Diff
5. 高度ExportとGit連携
6. Long-term Archiveと専用Backup
7. Developer API Usage
8. Managed AI HandoffとTeam共有AI Connection

Version数は主要な課金軸にしない。SnapshotはStorageへ計上できるが、「版を保存する」操作自体を萎縮させない。

## 5. Storage計測

Userへ表示するUsageは次の合計とする。

```text
compressed snapshot objects
+ original attachment bytes
+ retained generated artifacts
+ trash during retention
```

Database index、通常Replication、標準Backupの内部Copyは別途加算しない。内訳は再計算可能にし、少なくともDocument Snapshot、画像、PDF、その他Asset、Export、Trashに分類して表示する。

## 6. Quota超過とDowngrade

- 70%、90%、100%など段階的に通知可能にする。
- 100%到達後もLocal編集とLocal Version作成を継続できる。
- 新しいCloud UploadとSyncは保留してよい。
- 既存Cloud Documentの閲覧、Download、Exportを維持する。
- Plan Downgradeや支払い失敗で即時削除しない。
- Grace Periodと複数回通知を設ける。
- Data PurgeはSubscription変更とは別のRetention手続きにする。
- Userが容量を減らすかUpgradeするとSync Queueを再開する。

## 7. Long-term Archive

追加Option候補：

- 10-year Archive
- Immutable Archive
- 独立Regionまたは独立AccountへのCopy
- 定期Hash検証
- Restore試験と証跡
- Retention Lock

Standard BackupはService復旧用であり、Long-term Archiveの商品保証と混同しない。

## 8. 将来の収益構造

```text
個人
├ Free Local
├ Free Cloud
└ Personal / Pro

チーム
├ Team
└ Publisher / Research

企業
├ Enterprise
├ Compliance
└ Long-term Archive

開発者
└ API
```

APIではVersion保存Operation、Storage、転送量を独立してMeter可能にする。

## 9. 検証が必要な項目

- Free Cloud 1GBで長編小説・研究ノートが十分運用できるか
- Snapshot圧縮率と重複排除率
- 画像・PDFの平均容量とBandwidth
- Backup、Email、Log、MonitoringのUserあたり原価
- Personal / Proの支払意思
- TeamをSeat課金とWorkspace課金のどちらにするか
- AI Creditの原価変動と上限設計
- BYOK、Local Model、Managed AI CreditのUXと責任境界
- Provider別Import Adapterの保守Cost
- Archiveの保存年数、保証、法務、価格
