# ADR-011: AI学習利用の既定拒否

- Status: Accepted
- Date: 2026-08-13

## Context

KOMYAKUが扱う本文、Draft、Version、別案には、未公開作品や機密情報が含まれる。公開Documentについても、公開とAIモデル学習への提供は同じ同意ではない。

## Decision

- `ai_training_policy`は`deny`または`allow`とし、既定値を`deny`とする。
- `deny`では、外部AI学習DatasetへDocumentを能動的に提供しない。
- 公開WebにはAI Crawler向け`robots.txt`と拒否意思を示すHTTP Headerを付与する。
- Crawler指示は遵守を保証しないため、技術的限界を明記する。
- 将来のAI機能利用同意と、Providerによるモデル学習への利用同意を分離する。
- 外部AI Providerへ本文を送信する前に、送信先、目的、範囲、保存条件を表示して明示的な同意を得る。
- 特定のConversation Handoffへの一回限りの推論同意は、Providerによる学習許可または将来の包括的送信許可として扱わない。
- KOMYAKUの設定と、CodexやChatGPT等のAccount-level Data Controlsは別の設定として扱う。

## Consequences

公開Documentを含め、ユーザーの拒否意思を既定で尊重できる。一方で、Crawler指示に従わない第三者による収集を完全には防げないため、アクセス制御、規約、監視を組み合わせる必要がある。
