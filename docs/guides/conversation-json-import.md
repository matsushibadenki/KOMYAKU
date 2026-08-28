# Generic JSON Conversation Import

## 日本語

### 対応形式

Top-level Array、または`messages`を持つObjectを受け付ける。

```json
{
  "title": "研究相談",
  "defaultLanguage": "ja",
  "schemaVersion": "1",
  "messages": [
    { "id": "m1", "parentId": null, "role": "user", "content": "質問" },
    { "id": "m2", "parentId": "m1", "role": "assistant", "content": "回答" }
  ]
}
```

`parentId`を省略したMessageは直前のMessageへ接続する。`parentId: null`はRootを示す。同じParentを指定すればBranchになる。`content`はString、Part Array、またはProvider固有Objectを受け付ける。未知Partは`unknown_provider_part`として原形を保持する。

### 保護と制限

- 既定上限は10 MiB、10,000 Message
- UTF-8 JSONのみ
- 原文StringをUnicode正規化しない
- Cycleと存在しないMessageへの内部EdgeはCanonical Validationで拒否
- 欠落Parent、重複Source ID、不正Timestampは`partial` Warning
- AI学習Policyは既定`deny`
- Raw Sourceは解析前にImmutable Archiveへ保存

### Cloud API

認証Routeを有効化したServerでは次を利用できる。

```text
POST /api/v1/workspaces/:workspaceId/conversation-imports
GET  /api/v1/workspaces/:workspaceId/conversation-imports/:importId
```

POST BodyにはEnvelopeを追加せず、Export JSONそのものを送る。`Authorization: Bearer <session-token>`、`Idempotency-Key: <8〜200文字>`、`Content-Type: application/json`が必須。Providerは既定で自動検出する。必要なら`X-KOMYAKU-Source-Provider: generic|chatgpt|claude|gemini`で明示できる。同じ処理を再送するときはKeyとBodyを両方同一にする。応答の`conversationId`は互換用の先頭ID、`conversationIds`はBundle内の全IDである。初期APIではImport結果を常にPrivate、AI学習拒否として作成する。Email確認済みOwner、Admin、Editorだけが作成できる。認証なしのEndpointは提供しない。

Provider Adapter基盤はChatGPT mapping、Claude `chat_messages`、structured Gemini `conversations[].entries`、Google Takeout My ActivityのFlat Entryに対応する。`detectConversationExportProvider`は明確な形だけを判別し、不明なJSONを推測しない。Provider Bundle全体のRaw BytesとSHA-256を各Canonical Conversationのprovenanceへ記録する。My Activityは会話所属を復元できないため、HTMLを実行・Text化せず未知Partとして保持し、必ず`partial` Warningを返す。

Fixtureは`packages/conversation-importer/test/fixtures`の合成データを正本とし、実User ExportをRepositoryへCommitしない。Cloudでは1つのRaw Archive、Import Record、複数Conversation、Message、Edge、Outbox Eventを単一Transactionで保存する。Package APIと互換性規則は`docs/formats/provider-conversation-exports.md`を参照する。

DesktopのConversation Archive画面ではJSONを選択すると、端末内だけでProvider、会話数、Message数、Raw Byte Size、SHA-256、先頭5会話を確認できる。PreviewにMessage本文は含めない。`partial`の場合はLocalizeされた注意事項への明示同意が必要である。Cloudへ保存する場合はLoginし、Serverが返した利用可能Workspaceを選び、Byte数と会話数を確認して送信する。Previewに使用した同一Raw Bytesを送信し、読み直した別内容へ差し替えない。PasswordとSession TokenはMemoryだけに保持し、App終了後は再接続する。

## English

The generic importer accepts either a top-level message array or an object containing `messages`. Omit `parentId` for an implicit linear link, use `null` for a root, or point multiple messages to the same parent to preserve branches. Exact UTF-8 source bytes are archived before parsing. The default limits are 10 MiB and 10,000 messages. Unknown roles and content parts are preserved; cycles are rejected; recoverable issues produce a `partial` import. AI training remains denied by default.

The provider adapters support ChatGPT mappings, Claude `chat_messages`, structured Gemini entries, and flat Gemini My Activity records. Detection only accepts recognizable shapes. Every resulting conversation refers to the original bundle hash. Flat My Activity cannot prove thread membership, so safe HTML remains an inert unknown part and the result is partial. Fixtures are synthetic; never commit a real user export. Cloud persistence commits the complete multi-conversation bundle and its outbox event in one database transaction.

When authentication routes are enabled, send the source JSON itself to `POST /api/v1/workspaces/:workspaceId/conversation-imports` with a bearer session, `Content-Type: application/json`, and an `Idempotency-Key` of 8–200 characters. Detection is automatic; optionally send `X-KOMYAKU-Source-Provider: generic|chatgpt|claude|gemini`. Repeat both the same key and exact body after a timeout. The response keeps `conversationId` as the first ID for compatibility and exposes every ID in `conversationIds`. Read status from `GET /api/v1/workspaces/:workspaceId/conversation-imports/:importId`. Only verified owners, admins, and editors may create imports. New imports are always private with AI training denied. No unauthenticated import endpoint exists.

The Desktop Conversation Archive view reviews a selected JSON file entirely on-device. It shows provider, counts, byte size, SHA-256, and at most five conversation titles without putting message bodies in the preview model. A partial result requires explicit acknowledgment of localized recovery notes. For Cloud storage, sign in, choose a workspace returned by the authenticated server, and confirm the byte and conversation counts. The exact in-memory bytes used for review are submitted. Passwords and session tokens remain memory-only, so reconnect after closing the app.

## 简体中文

通用导入器接受顶层消息数组，或包含 `messages` 的对象。省略 `parentId` 时会连接到上一条消息，设为 `null` 表示根消息，多条消息指向同一父消息可保留分支。系统会在解析前以不可变方式保存原始 UTF-8 字节。默认限制为 10 MiB 和 10,000 条消息。未知角色和内容片段会被保留，循环关系会被拒绝，可恢复的问题会生成 `partial` 导入结果。AI 训练策略默认仍为拒绝。

Provider Adapter现已支持ChatGPT mapping、Claude `chat_messages`、结构化Gemini entries以及扁平的Gemini My Activity记录。系统只识别明确格式，每个Canonical Conversation都记录原始Bundle的Hash。My Activity无法证明会话归属，因此Safe HTML会作为不可执行的未知Part保存，并返回`partial`。Fixture全部使用合成数据，禁止提交真实用户导出。Cloud会在单个数据库事务中保存完整的多会话Bundle及其Outbox Event。

启用认证路由后，可将原始 JSON 本身发送至`POST /api/v1/workspaces/:workspaceId/conversation-imports`，并提供 Bearer Session、`Content-Type: application/json`及 8–200 个字符的`Idempotency-Key`。默认自动检测Provider，也可发送`X-KOMYAKU-Source-Provider: generic|chatgpt|claude|gemini`。超时重试时必须保持 Key 和 Body 完全一致。响应中的`conversationId`是兼容用首个ID，`conversationIds`包含全部ID。可通过GET接口读取状态。只有已验证邮箱的 Owner、Admin 和 Editor 可以创建导入；新导入始终为 Private 且拒绝 AI 训练。不会提供未认证的导入接口。

Desktop的Conversation Archive界面会完全在本设备上审阅所选JSON。Preview只显示Provider、数量、字节大小、SHA-256以及最多五个会话标题，不包含消息正文。`partial`结果必须明确确认本地化恢复说明。如需保存到Cloud，请登录、选择Server返回的已授权Workspace，并确认字节数和会话数。系统发送与审阅时完全相同的Memory Bytes。密码和Session Token仅保存在Memory中，关闭应用后需要重新连接。
