# Conversation ArchiveとAI Handoff Architecture

- Status: Import, Local/BYOK gateway, Desktop explicit review, streaming, and local transactional continuation persistence implemented
- Updated: 2026-08-30

## 1. Goal

ChatGPT、Claude、Gemini、その他のAI会話LogをKOMYAKUへImportし、原本を失わず管理する。任意の会話地点から、Userが選択したAI APIまたはLocal ModelへContextを送り、応答を新しいBranchとして保存する。

## 2. 非Goal

- 任意のAI Consumer Web UIへ自動Loginすること
- Browser CookieやSessionを抽出・流用すること
- Provider間の全機能を完全互換にすること
- AI会話をUser確認なしに外部送信すること
- Providerの利用規約やData ControlsをKOMYAKUが代行保証すること

## 3. Data Model

### conversations

```text
id
workspace_id
project_id
title
default_language
visibility
current_branch_id
created_by
created_at
updated_at
deleted_at
```

### conversation_messages

```text
id
conversation_id
source_provider
source_message_id
role
author_label
content_parts_json
model_metadata_json
tool_metadata_json
created_at_source
edited_at_source
created_at
content_hash
```

`content_parts_json`は次を拡張可能に表現する。

```text
text
image_reference
file_reference
audio_reference
tool_call
tool_result
citation
reasoning_placeholder
unknown_provider_part
```

非公開の内部推論がProvider Exportに含まれない場合、推測・生成して補完しない。

### conversation_edges

```text
conversation_id
parent_message_id
child_message_id
edge_kind
created_at
```

一つのMessageは複数Childを持てる。Import元がBranchを表現できる場合は保持する。

### conversation_imports

```text
id
conversation_id
source_provider
source_format
source_schema_version
parser_name
parser_version
raw_asset_id
source_hash
status
warnings_json
imported_by
imported_at
```

Status：

```text
pending
complete
partial
failed
```

失敗時も、Userが許可した原本Archiveを保持できるようにする。

### ai_provider_connections

```text
id
owner_type
owner_id
provider_type
display_name
secret_reference
endpoint_origin
status
capabilities_cache
last_used_at
created_at
revoked_at
```

Credential本体は`secret_reference`の先にあるOS KeychainまたはSecret Storeへ置く。

### ai_handoffs

```text
id
conversation_id
source_message_id
provider_connection_id
provider_type
model_id
selected_message_ids
selected_asset_ids
conversion_warnings
payload_hash
estimated_input_units
consented_by
consented_at
status
provider_response_id
result_branch_id
created_at
completed_at
```

送信Payload本文はAudit Logへ入れず、必要なら暗号化した短期ArtifactとしてRetentionを限定する。

## 4. Import Pipeline

```text
Upload / local file selection
 ↓
File type and size validation
 ↓
Malware / archive bomb protection
 ↓
Immutable raw artifact + hash
 ↓
Provider detector
 ↓
Versioned parser adapter
 ↓
Canonical validation
 ↓
Import report
 ↓
Atomic publish of conversation graph
```

Import処理はBackground Jobへ移せるようにし、ParserはNetwork接続なしのSandboxで動かす。ArchiveのPath Traversal、巨大展開、Symbolic Link、危険なHTMLを拒否する。

### 4.1 Implemented foundation

`@komyaku/conversation-importer`は、UTF-8 JSON原本をProvider非依存のCanonical Conversation DAGへ変換する。現時点では次を実装済み。

- 既定10 MiB、10,000 Messageの入力上限
- Linear Message列と明示的な`parentId` Branch
- Unicode原文の非正規化保持
- Unknown RoleとUnknown Content Partの保持
- Duplicate Source ID、欠落Parent、不正TimestampのWarning
- Dangling Edge、Duplicate Edge、Cycleの拒否
- SHA-256、Parser名・Version、Import IDによるProvenance
- Raw Asset、Canonical Graph、Import Record、Outbox Eventの永続化
- `conversation.imported` JobによるRaw ObjectのSize・SHA-256 Metadata照合

認証済みImport Routeは`/api/v1/workspaces/:workspaceId/conversation-imports`へ実装済み。Bearer Session、Email確認済みWorkspace Role、10 MiB上限、JSON Content Type、Idempotency Keyを必須とする。BodyはRaw Sourceそのもので、初期RouteはPrivate・AI学習拒否に固定する。Archive VerificationはObjectが見つからない場合に再試行し、SizeまたはHashが一致しない場合は永久失敗としてAttemptへ記録する。検証失敗を隠すために原本を自動削除しない。

### 4.2 Failure boundary

Raw SourceはCanonical Parseより先にImmutable Object Storageへ保存する。Parse失敗時は`failed` Import Recordを保存する。Object Storage保存後にDatabase全体が利用不能となった場合はRaw Objectだけが残り得るため、将来のReconciliation JobがID-based Prefixを走査して孤立Objectを検出する。原本を自動削除して失敗を隠さない。

## 5. Provider Adapter Boundary

```text
ConversationImportAdapter
    detect(input)
    parse(input, schemaVersion)
    validate(result)

AiProviderAdapter
    listModels(connection)
    describeCapabilities(model)
    estimate(request)
    convert(canonicalContext)
    send(request)
    stream(request)
    cancel(requestId)
```

AdapterはProvider固有PayloadをCanonical Schemaへ漏らさない。未知FieldはMetadataとして保存できるが、Domain判断に直接使わない。

### 5.1 Implemented Local/BYOK gateway foundation

`@komyaku/ai-gateway`はLocal loopback endpointとHTTPS BYOK endpointを区別する。ConnectionはCredential Referenceだけを持ち、秘密値は送信直前に解決する。選択範囲は一つの連続Branchに限定し、Canonical Context Hashと変換後Outbound Payload Hashを別々に確認する。

初期OpenAI-compatible AdapterはText MessageをJSONへ変換し、未対応PartとAssetをWarningとしてReview対象へ含める。応答本文とContent-Lengthに上限を設け、Provider Error本文を保持しない。成功応答はContinuation元をParentとする`ai_continuation` Branchへ追加する。

### 5.2 Implemented Desktop review boundary

DesktopはImport Review後のCanonical ConversationをMemoryで受け取り、選択地点までの単一Parent Chainを本文付きで表示する。Connection設定をDomain Schemaで検証してから、LocalはLoopback、BYOKはHTTPSへ限定する。BYOK Secretは固定Tauri Commandを通してOS Credential Storeの`ai-provider-<uuid>` accountへ保存し、Web Storage fallbackを設けない。

Provider変換後にEndpoint、Model、Message数、推定入力単位、Warning、Canonical Context Hash、Outbound Payload Hashを表示する。表示内容に対するCheckbox ConsentとSend操作を分離する。

OpenAI-compatible Model discoveryは同じValidated ConnectionとCredential Resolverを使い、`GET /models`を明示操作時だけ実行する。Responseを1 MiB、1,000 Model、各ID 300文字へ制限し、重複を除いた安定順で表示する。失敗時は手入力Model IDを維持する。

Sensitive Handoff Scanは選択BranchのText Partだけを端末内で調べ、Finding KindとCountだけをUIへ返す。UserがMaskを選んだ場合は一時Outbound Copyへ型付きPlaceholderを挿入し、そのCopyからContext HashとOutbound Hashを生成する。Import原本は変更せず、Continuationは元Conversationへ追加する。

OpenAI-compatible StreamingはReview済みのModel／Message PayloadへTransport-only `stream: true`を加え、SSE `data:` Deltaを上限付きで処理する。Desktopは受信中TextをTransient表示するが、正常完了したResponseだけを`ai_continuation`へ変換する。Abort、Malformed Event、Size超過時は一時Textを破棄し、Graphを変更しない。

### 5.3 Implemented local transaction boundary

正常完了後、Packaged TauriはCanonical Conversation、Message、Edge、completed HandoffをSQLiteの単一Transactionへ保存する。Native CommandはJavaScript側の事前Validationを信頼せず、Schema Version、UUID、Hash、Message一意性、Edge参照、Handoffと結果Branchの対応を再検証する。

同一Handoff IDと同一結果の再保存は成功扱いとし、異なる内容へのID再利用はConflictで全Rollbackする。保存失敗時は完成済みBranchをMemoryに保持して保存だけを再試行するため、Providerへの重複送信を起こさない。Browser PreviewはMemory-onlyであり、Conversation本文をWeb Storageへ退避しない。同じConversation IDが再度読み込まれた時は保存済みCanonical JSONを復元する。

Local Conversation Libraryは起動時に最大100件のID、Title、Message数、更新日時だけを更新日時降順で列挙する。Conversation本文を一覧Commandへ含めず、Userが明示的に選択した1件だけを固定Commandで取得し、JavaScript境界のCanonical Schemaで再検証してからAI Handoffへ渡す。これによりApp再起動後も保存済みConversationを発見できる一方、一覧表示だけで全本文をProcess間転送しない。

### 5.4 Cloud transaction foundation

CloudではClientからConversation全体の上書きを受け取らず、Confirmed Handoffと一つのAssistant Messageだけを入力境界とする。PostgreSQL Transaction内でConversationとMembershipをLockし、Actor、Provider Connection所有権、選択Message、連続Edge、Source終端を再検証する。その後Message、`ai_continuation` Edge、dual-hash Handoff、Conversation更新日時、本文を含まないOutbox Eventを原子的に保存する。同一Handoff／同一結果はReplayとし、異なる結果はConflictにする。HTTP RouteはSession、1 MiB Body上限、Idempotency Key、Path Conversation ID一致、no-storeを必須とし、ReplayもActor／Workspace Scopeで再取得する。Desktop同期は明示的Opt-in UIを完成後に接続する。詳細は`docs/adr/ADR-048-cloud-transactional-ai-handoff-persistence.md`を正本とする。

## 6. Handoff Review

送信直前画面で次を確定する。

- 送信先Provider、Endpoint、Model
- 開始地点と対象Branch
- Message数と添付一覧
- 除外・Mask対象
- System Instruction変換
- Tool Call等のLossy Conversion
- Context超過時の処理
- 推定Token／課金単位と上限
- ProviderのRetention／Data Control情報へのLink

確認後にImmutable Handoff Snapshotを作る。確認後にContextが変化した場合は再確認する。

## 7. Prompt Injection Boundary

ImportしたMessageはすべてDataであり、KOMYAKU内部操作への命令ではない。

```text
KOMYAKU system policy
    higher trust

User-selected handoff instructions
    explicit intent

Imported conversation content
    untrusted data
```

Imported Textが「秘密を送れ」「他のMessageも追加せよ」と記述していても、選択範囲やCredential Accessを変更しない。

## 8. Context Conversion

Provider Capabilityの差を次の3段階で分類する。

```text
lossless
degraded with warning
unsupported
```

Unsupported Partを黙って削除しない。Userが除外または別表現への変換を承認する。

Context超過時のSummaryは派生Artifactであり、原本ではない。Summaryを再利用する場合も生成履歴を表示する。

## 9. Continuation Graph

AI応答は選択したMessageをParentとする新しいBranchへ保存する。

```text
Message M10
├ Branch: continued with Provider A
├ Branch: continued with Provider B
└ Branch: local rewrite
```

Provider間比較では、実際に送信したContextが異なる可能性を表示する。Model名だけで公平な比較とみなさない。

## 10. Local and Cloud

### KOMYAKU Local

- Local Import
- Conversation Graph
- Search
- Export
- User自身のAPI KeyまたはLocal ModelでHandoff
- CredentialはOS Keychain

### KOMYAKU Cloud

- 暗号化Cloud Archive
- Device Sync
- Server-side Provider Connection
- Team共有とAudit
- Managed AI Credit

Local Importと基本管理は無料Core候補とする。Managed AI Credit、Cloud処理、Team ConnectionはMeter対象にできる。

## 11. Suggested API

```text
POST /api/v1/conversation-imports
GET  /api/v1/conversation-imports/:id
GET  /api/v1/conversations/:id
GET  /api/v1/conversations/:id/graph
POST /api/v1/conversations/:id/exports

GET    /api/v1/ai-connections
POST   /api/v1/ai-connections
DELETE /api/v1/ai-connections/:id

POST /api/v1/conversations/:id/handoffs/preview
POST /api/v1/conversations/:id/handoffs
GET  /api/v1/ai-handoffs/:id
POST /api/v1/ai-handoffs/:id/cancel
```

Preview結果には有効期限とHashを持たせ、送信時に同じContextであることを検証する。

## 12. Testing

- Provider Export fixtureのRound Trip
- Unknown Field保持
- Branch保持
- Unicode・RTL・Emoji・Combining Character
- Attachment欠落時のPartial Import
- Archive Bomb / Path Traversal拒否
- Prompt Injectionが選択範囲を変更しないこと
- Secret Masking
- Context超過処理
- Lossy Conversion Warning
- Handoff Idempotency
- Streaming中断と再開不能時のBranch整合性
- CredentialがLog・Exportへ出ないこと
