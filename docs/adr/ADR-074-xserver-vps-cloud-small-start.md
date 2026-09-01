# ADR-074: XServer VPS Cloud small-start topology

- Status: Accepted
- Date: 2026-09-01

## Context

KOMYAKUはLocal-firstを保ちながら、Cloud同期、認証、共同作業、Asset、Archiveを段階的に提供する。初期利用者が少ない段階で複数App Server、Load Balancer、大容量NFSを先行契約すると固定費と運用面が過剰になる一方、ApplicationとDatabaseを同じOSへ同居させると将来の水平分割と復旧が難しくなる。

XServer VPS CloudはVPS、Managed PostgreSQL、L4 Load Balancer、NFSを`main-network`で接続できる。公式仕様上、Managed DBとNFSはInternetおよび`main-network`以外から接続できない。NFSには利用者が任意に復元できるBackup機能がない。また、現在のKOMYAKU ServerはAsset保存にS3互換API、Range Read、Signed URL、Content-addressed keyを要求しており、NFS MountをそのままObject Storageとして利用できない。

## Decision

初期Productionは次の単一App構成とする。

- XServer VPS Cloud 4GB / 4 vCPU / NVMe 50GBをApp VPS 1台として利用する。
- XServer Managed PostgreSQL 10GB / 2GB Memory / 1 vCPUを利用する。
- DBの日次・最大7日Backup optionを有効にする。
- Assetと`.komyaku` Archiveは、HTTPSのS3互換Object Storageを別途利用する。NFSをS3互換として偽装しない。
- NFS、L4 Load Balancer、追加IP、帯域拡張は初期契約に含めない。
- API、短時間Job Worker、Notification Outbox Workerは同じVPS内の別Processとして開始する。Process単位のHealth Check、Resource Limit、Graceful Shutdownを維持する。
- 独立性が高いAI処理、重いFormat変換、Crawler、長時間Batchは後日通常VPSへ分離し、HTTPS APIまたはJob Queueを介してCloud側と通信する。通常VPSからManaged PostgreSQLへ直接接続しない。

2026-09-01取得の税込公式価格では、1か月契約のApp VPSが月額2,480円、Managed PostgreSQL 10GBが1,441円、DB Backupが220円で、XServer側の固定費は月額4,141円となる。Object Storage、Domain、SMTP、Monitoring、外部Backupの費用は含まない。12か月契約のApp VPS表示額は月額換算2,068円だが、Production-like検証と初期運用が安定するまでは1か月契約を選び、Campaign延長を事業計画へ算入しない。

## Scale transitions

次のいずれかが継続した場合、計測結果に基づいて拡張する。

1. App CPU 70%超、Memory 75%超、またはAPI p95 latencyのSLO違反が15分以上継続する場合は、まず8GB VPSへ垂直拡張する。
2. App障害時の停止時間を許容できなくなった場合、同一構成のApp VPSを2台にし、Standard L4 Load Balancerを追加する。ApplicationはStatelessを維持し、Session、Idempotency、Job LeaseはPostgreSQLへ置く。
3. DB容量70%、接続数70%、CPU 60%の継続、またはBackup/Restore時間がRTOを超える場合は30GB DBへ拡張する。Storage縮小ができない前提で早すぎる拡張を避ける。
4. 複数App VPSが共有するPOSIX Data、生成途中の大型Artifact、内部Cacheの共有が必要になった場合だけNFS 30GBから導入する。Canonical Assetの唯一のCopyや唯一のBackupにはしない。
5. AI、変換、CrawlerがAPIのLatencyまたはMemoryを圧迫した場合、通常VPS Workerへ分離する。Job PayloadはOpaque IDと必要最小限の短期取得権限を使い、本文やTokenを通常Logへ出さない。

## Consequences

初期費用を抑えながらDatabase運用をApplication OSから分離でき、App VPSを追加するときもSchemaやSession Modelを変更せずに済む。NFSを後回しにするためXServer Cloud内だけで全Storageを完結しないが、現行のS3境界とAsset Delivery要件を維持できる。

DBの7日Backupだけでは長期保存、誤削除、災害復旧を十分に満たさない。暗号化した論理BackupとObject Storage inventoryを別障害Domainへ保存し、定期Restore演習を行う必要がある。NFSを導入しても、この外部Backup要件は変わらない。

## Sources checked

- XServer VPS Cloud pricing, accessed 2026-09-01: https://vpscloud.xserver.ne.jp/price/
- Feature and network specifications: https://vpscloud.xserver.ne.jp/functions/
- Managed DB specifications: https://vpscloud.xserver.ne.jp/functions/db_server/
- NFS specifications and backup limitation: https://vpscloud.xserver.ne.jp/functions/nfs/
- L4 Load Balancer specifications: https://vpscloud.xserver.ne.jp/functions/load_balancer/

