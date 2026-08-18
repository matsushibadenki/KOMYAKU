# ADR-024: Production Configuration and Structured Logging

- Status: Accepted
- Date: 2026-08-18

## Decision

- Productionは`NODE_ENV=production`を明示し、Server、PostgreSQL、Object Storage、CORS、Idempotency Secretを全て明示設定する。
- Local Database、HTTP Object Storage、開発Credential、開発用Secret、HTTP CORS Origin、`AI_TRAINING_DEFAULT=allow`を起動前に拒否する。
- Public Authentication有効時はHTTPSのPublic App Originと完全なSMTP設定を必須とする。
- Logは1 Event 1 JSON Lineとし、Timestamp、Level、Service、Environment、Instance ID、Event名を含める。
- URL Pathを記録しない。Authorization、Cookie、Password、Secret、Token、Body、Payload、Content、Document、Email Fieldは再帰的にRedactする。
- MalformedなLegacy Log入力をそのまま出力しない。
- `LOG_LEVEL`でDebug、Info、Warn、Errorの閾値を設定する。

## Consequences

誤った開発設定でProduction Processを起動しにくくなり、Replicaを跨いだJSON Log集約が可能になる。機密内容を含む自由文Errorは通常Logへ渡さず、安全なError Codeを使用する。Production Secretの生成、保管、RotationはDeployment PlatformのSecret Managerが担当する。
