# ADR-014: Conversation ArchiveとAI Handoff

- Status: Accepted
- Date: 2026-08-13

## Context

AIとの会話はProviderごとに分断され、長期管理、検索、分岐、移行が難しい。KOMYAKUのDocument Evolution Graphを会話へ適用すれば、過去Logを保存し、任意地点から別AIへ引き継ぐことができる。一方、Provider Schema差、Credential、個人情報、Prompt Injection、Context Window、利用規約、推論Costを安全に扱う必要がある。

## Decision

- Provider固有のExport原本をImmutable Artifactとして保存する。
- 原本とProvider非依存Canonical Conversationを分離する。
- MessageをGraphとして保存し、会話Branchを保持する。
- ImporterとAI ProviderをVersioned Adapterで分離する。
- 対応対象はOfficial API、User-configured compatible endpoint、Local Model、Approved Connectorとする。
- Consumer Web UIへのCredential流用や自動投稿をCore機能にしない。
- 外部送信前にMessage、Attachment、Provider、Model、変換損失、推定Costを表示して明示確認を得る。
- Imported ConversationをUntrusted Dataとして扱い、内部命令として実行しない。
- Provider CredentialをOS KeychainまたはSecret Storeへ保存する。
- 応答は元会話を上書きせず、新しいBranchとして保存する。
- AI Handoff同意とAI学習許可を分離する。
- Local Import、基本管理、Exportを無料Core候補とし、Managed AI UsageをMeter可能にする。

## Consequences

Provider Lock-inを弱め、会話の時間構造を長期保存できる。複数AIから同じ会話地点を分岐させて比較できる。一方、ProviderごとのImport ParserとCapability変換、秘密情報検出、Credential管理、Cost Preview、規約変更への追従が必要になる。
